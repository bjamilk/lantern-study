/**
 * Paystack webhook receiver.
 *
 * Purpose
 * - The single ingress for Paystack's server-to-server event callbacks. It does
 *   no business logic itself: it recovers the raw request bytes, hands them plus
 *   the signature header to `services/marketplacePayments.handleWebhook`, and
 *   maps the outcome onto a status code Paystack's retry machinery reads
 *   correctly.
 *
 * Exports
 * - Default router, plus `initializePaystackWebhookRoutes(supabase)` which
 *   `server.ts` calls during boot to inject the service-role Supabase client.
 *
 * Mount path
 * - `/webhooks/paystack` AND `/api/v1/webhooks/paystack` — the same router is
 *   mounted twice because the Cloudflare same-origin proxy prefixes one form
 *   and the direct API host uses the other. Both must stay live.
 *
 * Auth mode
 * - Public. No JWT, no cookie, no CSRF. Authentication is HMAC-SHA512 over the
 *   exact request bytes, verified inside `handleWebhook` with `timingSafeEqual`
 *   behind a length pre-check (unequal lengths make `timingSafeEqual` throw).
 *   It fails closed twice over: a missing `x-paystack-signature` header is
 *   rejected, and so is an unset `PAYSTACK_SECRET_KEY` — an unconfigured
 *   deployment accepts nothing rather than everything.
 *
 * Rate-limit tier
 * - Deliberately exempt. `server.ts` wraps the anonymous IP limiter in a check
 *   against `isWebhookRateLimitExempt(req.path)` so both mount paths skip it:
 *   Paystack retries from a small IP pool and would 429 itself out of
 *   delivering a payment. The signature is the gate.
 *
 * Ownership predicate
 * - None here. The event body names the order; `marketplacePayments` resolves
 *   and authorises it against its own records.
 *
 * Error-mapping convention
 * - 200 on success, 401 only for a rejected signature, 503 when the Supabase
 *   client was never injected, 500 for everything else. See the catch below for
 *   why the "everything else" bucket must be a 5xx.
 *
 * Raw-body requirement
 * - An HMAC over raw bytes cannot survive a parser that re-serializes the JSON.
 *   `server.ts`'s body-parser dispatcher tests these two pathnames FIRST and
 *   routes them to `jsonWebhook`, the only parser carrying a `verify` hook that
 *   captures `req.rawBody`. If a generic parser ever runs first, `req.rawBody`
 *   is unset, the fallback below re-serializes the parsed body, and signatures
 *   then match only by luck.
 *
 * What it touches
 * - Paystack (inbound events only; no outbound call from this file) and, via
 *   `marketplacePayments`, the order and payout tables. Webhook dedupe is
 *   two-phase — a row is claimed on arrival and stamped `processed_at` only
 *   after processing succeeds — so the 500 below leads to a genuine reprocess
 *   on retry rather than a silent no-op.
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import type { DataLayer } from '../services/data';
import { logger } from '../utils/logger';

const router = Router();

let dataLayer: DataLayer | null = null;

// The readiness check the handler makes before it does anything: the webhook
// answers 503 rather than 500 when the layer has not been injected yet.
const layerOrNull = () => dataLayer;

export function initializePaystackWebhookRoutes(layer: DataLayer): void {
  dataLayer = layer;
}

/**
 * Paystack webhooks — no JWT. Signature verified with HMAC SHA512.
 * Mounted at POST /webhooks/paystack (and /api/v1/webhooks/paystack).
 */
router.post(
  '/',
  asyncHandler(async (req: any, res: any) => {
    if (!layerOrNull()) {
      return res.status(503).json({ success: false, error: 'Service unavailable' });
    }

    // `req.rawBody` is what the webhook parser captured. The two fallbacks are
    // last resorts for a misrouted request: re-serializing the parsed body
    // produces different bytes than Paystack signed, so a signature failure
    // here usually means the parser dispatch in server.ts stopped matching.
    const rawBody: string | Buffer =
      req.rawBody != null
        ? req.rawBody
        : Buffer.isBuffer(req.body)
          ? req.body
          : JSON.stringify(req.body ?? {});

    const signature =
      (typeof req.headers['x-paystack-signature'] === 'string'
        ? req.headers['x-paystack-signature']
        : undefined) || undefined;

    try {
      const { getMarketplacePaymentsService } = await import('../services/marketplacePayments');
      const result = await getMarketplacePaymentsService(dataLayer!).handleWebhook(
        rawBody,
        signature
      );
      res.status(200).json({ success: true, ...result });
      // This branch used to answer 400 with the raw `err.message`. A transient
      // failure of ours — a database blip, a timeout — was therefore reported
      // to Paystack as a malformed event and echoed our internals into their
      // dashboard logs. Paystack's retry is the only thing standing between a
      // transient failure and a permanently lost payment.
    } catch (err: any) {
      if (err?.statusCode === 401) {
        logger.warn('Paystack webhook signature rejected');
        return res.status(401).json({ success: false, error: 'Invalid signature' });
      }
      // Anything else is OUR failure to process a genuine, signed event. A 4xx
      // tells Paystack the event is bad and retries stop, stranding a paid
      // order; a 5xx makes Paystack retry until we succeed. The body is a
      // fixed string so an internal message never leaks to the caller.
      logger.error('Paystack webhook processing failed', err);
      res.status(500).json({ success: false, error: 'Webhook processing failed' });
    }
  })
);

export default router;

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import type { SupabaseService } from '../services/supabase';
import { logger } from '../utils/logger';

const router = Router();

let supabaseService: SupabaseService | null = null;

export function initializePaystackWebhookRoutes(supabase: SupabaseService): void {
  supabaseService = supabase;
}

/**
 * Paystack webhooks — no JWT. Signature verified with HMAC SHA512.
 * Mounted at POST /webhooks/paystack (and /api/v1/webhooks/paystack).
 */
router.post(
  '/',
  asyncHandler(async (req: any, res: any) => {
    if (!supabaseService) {
      return res.status(503).json({ success: false, error: 'Service unavailable' });
    }

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
      const result = await getMarketplacePaymentsService(supabaseService).handleWebhook(
        rawBody,
        signature
      );
      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      const status = err?.statusCode === 401 ? 401 : 400;
      if (status === 401) {
        logger.warn('Paystack webhook signature rejected');
      } else {
        logger.error('Paystack webhook processing failed', err);
      }
      res.status(status).json({
        success: false,
        error: status === 401 ? 'Invalid signature' : err?.message || 'Webhook error',
      });
    }
  })
);

export default router;

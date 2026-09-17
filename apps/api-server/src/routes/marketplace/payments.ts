/**
 * Paystack marketplace payments and seller payouts.
 *
 * Checkout configuration the clients read to decide whether to show in-app
 * payment, charge verification, the seller's earnings ledger, and the payout
 * profile (bank account) that `assertSellerCanReceivePayout` checks before any
 * checkout session is created. All of it delegates to
 * services/marketplacePayments.ts and services/paystack.ts. Inbound Paystack
 * webhooks are handled in routes/paystackWebhook.ts, outside this mount.
 *
 * Fee shape (GET /payments/config): the buyer pays the list price on hand-over
 * items and Lantern takes its share out of the seller's payout; digital products
 * add an optional buyer surcharge plus a creator commission. Every rate comes
 * from the @lantern/shared/marketplace resolvers over env vars, never from the
 * request.
 */
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { authMiddleware } from '../../middleware/auth';
import { requireAuthUserId } from '../../utils/requestAuth';
import { dataLayer } from './context';
import { respondMarketplaceError } from './errors';
const router = Router();
// ============================================================
// PAYSTACK MARKETPLACE PAYMENTS AND SELLER PAYOUTS
//
// Checkout configuration the clients read to decide whether to show in-app
// payment, charge verification, the seller's earnings ledger, and the payout
// profile (bank account) that `assertSellerCanReceivePayout` checks before any
// checkout session is created. All of it delegates to
// services/marketplacePayments.ts and services/paystack.ts. Inbound Paystack
// webhooks are handled in routes/paystackWebhook.ts, outside this mount.
//
// Fee shape (GET /payments/config): the buyer pays the list price on hand-over
// items and Lantern takes its share out of the seller's payout; digital products
// add an optional buyer surcharge plus a creator commission. Every rate comes
// from the @lantern/shared/marketplace resolvers over env vars, never from the
// request.
// ============================================================

// ---- Paystack marketplace payments ----


router.get(
  '/payments/config',
  authMiddleware,
  asyncHandler(async (_req: any, res: any) => {
    const { marketplacePaystackEnabled } = await import('../../services/marketplacePayments');
    const { getPaystackPublicKey } = await import('../../services/paystack');
    const {
      resolveMarketplaceServiceFeeBps,
      resolveMarketplaceDigitalBuyerFeeBps,
      resolveMarketplaceCreatorFeeBps,
      resolveMarketplacePhysicalCommissionBps,
    } = await import('@lantern/shared/marketplace');
    res.json({
      success: true,
      data: {
        paystackEnabled: marketplacePaystackEnabled(),
        publicKey: marketplacePaystackEnabled() ? getPaystackPublicKey() : null,
        serviceFeeBps: resolveMarketplaceServiceFeeBps(process.env.MARKETPLACE_SERVICE_FEE_BPS),
        // Digital fee model (Phase 2 · I): buyer surcharge on digital (default 0)
        // and the creator commission taken from the payout (default 1500 = 15%).
        digitalBuyerFeeBps: resolveMarketplaceDigitalBuyerFeeBps(process.env.MARKETPLACE_DIGITAL_BUYER_FEE_BPS),
        creatorFeeBps: resolveMarketplaceCreatorFeeBps(process.env.MARKETPLACE_CREATOR_FEE_BPS),
        // Hand-over items: buyer pays list price (serviceFeeBps above is 0 by
        // default now); Lantern keeps this share of the seller's payout.
        physicalCommissionBps: resolveMarketplacePhysicalCommissionBps(process.env.MARKETPLACE_PHYSICAL_COMMISSION_BPS),
      },
    });
  })
);

// GET /api/v1/marketplace/seller/payments - the seller's earnings ledger (Phase 2 · I)
router.get(
  '/seller/payments',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = requireAuthUserId(req, res);
    if (!userId) return;
    const { getMarketplacePaymentsService } = await import('../../services/marketplacePayments');
    const page = req.query?.page ? Number(req.query.page) : 1;
    const data = await getMarketplacePaymentsService(dataLayer).getSellerPayments(
      userId,
      Number.isFinite(page) && page > 0 ? page : 1
    );
    res.json({ success: true, data });
  })
);

// FIXED (F7b): catch-all 400 — see the comment above GET /orders/:id.
// This is the worst instance: a failed verify tells the buyer their reference is
// invalid when the charge may have gone through.
router.post(
  '/payments/:reference/verify',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplacePaymentsService } = await import('../../services/marketplacePayments');
    try {
      const result = await getMarketplacePaymentsService(dataLayer).verifyPaymentByReference(
        req.params.reference,
        req.user.id
      );
      res.json({ success: true, data: result });
    } catch (err: any) {
      if (!respondMarketplaceError(res, err, 400)) throw err;
    }
  })
);

// Resume / start Paystack checkout for an unpaid order (buyer only)
// FIXED (F7b): catch-all 400 — see the comment above GET /orders/:id.
router.post(
  '/orders/:id/checkout',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const userId = req.user.id;
    const { getMarketplacePaymentsService, marketplacePaystackEnabled } = await import(
      '../../services/marketplacePayments'
    );
    if (!marketplacePaystackEnabled()) {
      return res.status(400).json({ success: false, error: 'Paystack checkout is not enabled' });
    }
    try {
      const email =
        (typeof req.user?.email === 'string' && req.user.email) ||
        (await dataLayer.users.getAuthUserEmail(userId)) || '';
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'A verified email is required for Paystack checkout',
        });
      }
      const session = await getMarketplacePaymentsService(dataLayer).getCheckoutSessionForOrder(
        req.params.id,
        userId,
        email
      );
      res.json({ success: true, data: session });
    } catch (err: any) {
      if (!respondMarketplaceError(res, err, 400)) throw err;
    }
  })
);

router.get(
  '/seller/payout-profile',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplacePaymentsService } = await import('../../services/marketplacePayments');
    const profile = await getMarketplacePaymentsService(dataLayer).getSellerPayoutProfile(
      req.user.id
    );
    res.json({ success: true, data: profile });
  })
);

// FIXED (F7b): catch-all 400 — see the comment above GET /orders/:id.
// A Paystack resolve-account outage here reads as "your bank details are wrong".
router.post(
  '/seller/payout-profile',
  authMiddleware,
  asyncHandler(async (req: any, res: any) => {
    const { getMarketplacePaymentsService } = await import('../../services/marketplacePayments');
    try {
      const profile = await getMarketplacePaymentsService(dataLayer).upsertSellerPayoutProfile(
        req.user.id,
        {
          accountNumber: req.body?.accountNumber,
          bankCode: req.body?.bankCode,
        }
      );
      res.json({ success: true, data: profile });
    } catch (err: any) {
      if (!respondMarketplaceError(res, err, 400)) throw err;
    }
  })
);

// FIXED (F7b): catch-all 400 — see the comment above GET /orders/:id.
router.get(
  '/seller/banks',
  authMiddleware,
  asyncHandler(async (_req: any, res: any) => {
    const { listPaystackBanks, isPaystackConfigured } = await import('../../services/paystack');
    if (!isPaystackConfigured()) {
      return res.json({ success: true, data: [] });
    }
    try {
      const banks = await listPaystackBanks();
      res.json({ success: true, data: banks });
    } catch (err: any) {
      if (!respondMarketplaceError(res, err, 400)) throw err;
    }
  })
);

export default router;

-- The hand-over fee moved into the price on 2026-09-02: the buyer pays the
-- listed amount, Lantern keeps 5% of it (platform_fee_kobo), and the seller
-- receives 95% (seller_payout_kobo). No column or CHECK changes — the split
-- constraint from 20260823122000 already holds for this model — only the
-- catalog comment, which still described the old "item + 5% on top" charge.
COMMENT ON TABLE public.marketplace_payments IS
  'Paystack marketplace charges: buyer pays the listed price; platform_fee_kobo (5% hand-over, 15% digital) is retained and seller_payout_kobo is transferred on confirm_received.';
COMMENT ON COLUMN public.marketplace_payments.service_fee_kobo IS
  'Buyer-side surcharge added on top of item_amount_kobo. 0 since 2026-09-02 (MARKETPLACE_SERVICE_FEE_BPS defaults to 0); rows before that date carry the retired 5% surcharge.';
COMMENT ON COLUMN public.marketplace_payments.platform_fee_kobo IS
  'Lantern''s commission taken from the seller payout: 5% on hand-over listings since 2026-09-02 (0 before), creator fee on digital listings.';

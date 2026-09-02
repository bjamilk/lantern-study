-- The hand-over fee moved into the price on 2026-09-02: the buyer pays the
-- listed amount, Lantern keeps 5% of it (platform_fee_kobo), and the seller
-- receives 95% (seller_payout_kobo). No column or CHECK changes — the split
-- constraint from 20260823122000 already holds for this model — only the
-- catalog comment, which still described the old "item + 5% on top" charge.
COMMENT ON TABLE public.marketplace_payments IS
  'Paystack marketplace charges: buyer pays the listed price; platform_fee_kobo (5% hand-over, 15% digital) is retained and seller_payout_kobo is transferred on confirm_received.';

-- Prevent concurrent buy-now / offer-accept from creating duplicate open orders.
-- Only one non-terminal order may exist per listing at a time.

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_orders_one_open_per_listing
  ON public.marketplace_orders (listing_id)
  WHERE status IN (
    'pending_payment',
    'paid',
    'ready_for_pickup',
    'buyer_confirmed',
    'disputed'
  );

-- At most one order per accepted offer (idempotent accept retries).
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_orders_unique_offer_id
  ON public.marketplace_orders (offer_id)
  WHERE offer_id IS NOT NULL;

COMMENT ON INDEX public.idx_marketplace_orders_one_open_per_listing IS
  'Enforces a single open marketplace order per listing (race-safe buy-now / accept).';

COMMENT ON INDEX public.idx_marketplace_orders_unique_offer_id IS
  'Ensures offer accept creates at most one order per offer.';

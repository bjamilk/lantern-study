-- Phase 2 I — Fee model: record the platform commission / seller payout split
-- on every marketplace payment.
--
-- Digital listings (question banks, study packs) take a 15% creator commission
-- out of the seller's payout (buyer pays list price); physical listings keep
-- today's maths (buyer pays list + 5% service fee, seller receives the full
-- item). Both are now recorded explicitly so payouts, refunds and the seller
-- ledger read from stored numbers instead of re-deriving them.
--
-- Hand-apply AFTER 20260823120000_study_packs.sql (order among the 20260823*
-- files is not otherwise constrained).

ALTER TABLE public.marketplace_payments
  ADD COLUMN IF NOT EXISTS platform_fee_kobo integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seller_payout_kobo integer;

-- Backfill existing rows: before this change the seller received the whole item
-- amount and the platform took nothing from the payout.
UPDATE public.marketplace_payments
  SET seller_payout_kobo = item_amount_kobo
  WHERE seller_payout_kobo IS NULL;

-- Migrations are applied BEFORE the API that writes these columns deploys, so
-- for that window the live API still inserts payments without seller_payout_kobo.
-- Fill it from the other columns on insert/update rather than rejecting the row
-- (a NOT NULL with no default would break checkout during every deploy).
CREATE OR REPLACE FUNCTION public.marketplace_payments_fill_split()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.platform_fee_kobo IS NULL THEN
    NEW.platform_fee_kobo := 0;
  END IF;
  IF NEW.seller_payout_kobo IS NULL THEN
    NEW.seller_payout_kobo := NEW.item_amount_kobo - NEW.platform_fee_kobo;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_payments_fill_split_trg ON public.marketplace_payments;
CREATE TRIGGER marketplace_payments_fill_split_trg
  BEFORE INSERT OR UPDATE ON public.marketplace_payments
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_payments_fill_split();

ALTER TABLE public.marketplace_payments
  ALTER COLUMN seller_payout_kobo SET NOT NULL;

-- The total the buyer is charged is still item + buyer surcharge; additionally
-- the seller payout plus the platform commission must reconstruct the item.
ALTER TABLE public.marketplace_payments
  DROP CONSTRAINT IF EXISTS marketplace_payments_total_matches;
ALTER TABLE public.marketplace_payments
  ADD CONSTRAINT marketplace_payments_total_matches
  CHECK (
    total_charged_kobo = item_amount_kobo + service_fee_kobo
    AND seller_payout_kobo + platform_fee_kobo = item_amount_kobo
  );

COMMENT ON COLUMN public.marketplace_payments.platform_fee_kobo IS
  'Platform commission taken from the seller payout (digital listings; 0 for physical).';
COMMENT ON COLUMN public.marketplace_payments.seller_payout_kobo IS
  'Amount paid out to the seller = item_amount_kobo - platform_fee_kobo.';

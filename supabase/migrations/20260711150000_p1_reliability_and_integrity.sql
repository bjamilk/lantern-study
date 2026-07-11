-- P1: Atomic vote counts, marketplace idempotency constraints, budget transaction lockdown.

-- ---------------------------------------------------------------------------
-- 1. Keep message vote counts in sync via trigger (atomic recount)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_message_vote_counts_from_vote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  msg_id UUID;
BEGIN
  msg_id := COALESCE(NEW.message_id, OLD.message_id);
  IF msg_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.messages
  SET
    upvotes = (
      SELECT COUNT(*)::integer
      FROM public.question_votes
      WHERE message_id = msg_id AND vote_type = 'up'
    ),
    downvotes = (
      SELECT COUNT(*)::integer
      FROM public.question_votes
      WHERE message_id = msg_id AND vote_type = 'down'
    )
  WHERE id = msg_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS question_votes_sync_message_counts ON public.question_votes;
CREATE TRIGGER question_votes_sync_message_counts
  AFTER INSERT OR UPDATE OR DELETE ON public.question_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_message_vote_counts_from_vote();

-- ---------------------------------------------------------------------------
-- 2. One pending offer per buyer per listing
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_offers_one_pending_per_buyer
  ON public.marketplace_offers (listing_id, buyer_id)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. One review per user per listing
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_reviews_listing_reviewer
  ON public.marketplace_reviews (listing_id, reviewer_id);

-- ---------------------------------------------------------------------------
-- 4. Budget transactions: server-only writes
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS budget_transactions_insert ON public.budget_transactions;
DROP POLICY IF EXISTS budget_transactions_update ON public.budget_transactions;
DROP POLICY IF EXISTS budget_transactions_delete ON public.budget_transactions;
DROP POLICY IF EXISTS "Users can insert own budget transactions" ON public.budget_transactions;
DROP POLICY IF EXISTS "Users can update own budget transactions" ON public.budget_transactions;
DROP POLICY IF EXISTS "Users can delete own budget transactions" ON public.budget_transactions;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.budget_transactions FROM authenticated, anon;
GRANT SELECT ON TABLE public.budget_transactions TO authenticated;

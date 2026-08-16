-- Per-bank leaderboards: one best-score row per (bank, user).
--
-- Scores come from offline sessions run against a purchased/downloaded bank,
-- so they arrive late and out of order. The upsert keeps the best score and
-- counts every attempt, which makes replays idempotent-ish without needing a
-- per-attempt history table.

CREATE TABLE IF NOT EXISTS public.marketplace_question_bank_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  best_score_pct numeric(5,2) NOT NULL CHECK (best_score_pct >= 0 AND best_score_pct <= 100),
  best_correct integer NOT NULL CHECK (best_correct >= 0),
  best_total integer NOT NULL CHECK (best_total > 0),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  first_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  best_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (listing_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_qbank_scores_board
  ON public.marketplace_question_bank_scores(listing_id, best_score_pct DESC, best_at ASC);

ALTER TABLE public.marketplace_question_bank_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_question_bank_scores FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.marketplace_question_bank_scores TO service_role;
-- Writes go through the API (which verifies entitlement); users may read their own row.
CREATE POLICY "Users can view their own question bank scores"
  ON public.marketplace_question_bank_scores FOR SELECT
  USING (auth.uid() = user_id);
GRANT SELECT ON public.marketplace_question_bank_scores TO authenticated;

/**
 * Record an attempt, keeping the best result. Ties do not move best_at, so the
 * leaderboard's tiebreak (earliest to reach the score) stays stable.
 */
CREATE OR REPLACE FUNCTION public.marketplace_record_question_bank_score(
  p_listing_id uuid,
  p_user_id uuid,
  p_correct integer,
  p_total integer
)
RETURNS TABLE (
  best_score_pct numeric,
  best_correct integer,
  best_total integer,
  attempts integer,
  improved boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pct numeric(5,2);
  v_existing public.marketplace_question_bank_scores%ROWTYPE;
  v_improved boolean := false;
BEGIN
  IF p_total IS NULL OR p_total <= 0 THEN
    RAISE EXCEPTION 'Invalid question total';
  END IF;
  IF p_correct IS NULL OR p_correct < 0 OR p_correct > p_total THEN
    RAISE EXCEPTION 'Invalid correct count';
  END IF;

  v_pct := ROUND((p_correct::numeric / p_total::numeric) * 100, 2);

  SELECT * INTO v_existing
  FROM public.marketplace_question_bank_scores
  WHERE listing_id = p_listing_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.marketplace_question_bank_scores (
      listing_id, user_id, best_score_pct, best_correct, best_total, attempts
    ) VALUES (
      p_listing_id, p_user_id, v_pct, p_correct, p_total, 1
    );
    v_improved := true;
  ELSE
    IF v_pct > v_existing.best_score_pct THEN
      UPDATE public.marketplace_question_bank_scores
      SET best_score_pct = v_pct,
          best_correct = p_correct,
          best_total = p_total,
          attempts = v_existing.attempts + 1,
          best_at = NOW(),
          updated_at = NOW()
      WHERE id = v_existing.id;
      v_improved := true;
    ELSE
      UPDATE public.marketplace_question_bank_scores
      SET attempts = v_existing.attempts + 1,
          updated_at = NOW()
      WHERE id = v_existing.id;
    END IF;
  END IF;

  RETURN QUERY
  SELECT s.best_score_pct, s.best_correct, s.best_total, s.attempts, v_improved
  FROM public.marketplace_question_bank_scores s
  WHERE s.listing_id = p_listing_id AND s.user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_record_question_bank_score(uuid, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_record_question_bank_score(uuid, uuid, integer, integer) TO service_role;

COMMENT ON TABLE public.marketplace_question_bank_scores IS
  'Best score per user per marketplace question bank; powers per-bank leaderboards.';

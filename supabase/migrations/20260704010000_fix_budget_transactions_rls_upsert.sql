-- Fix budget_transactions RLS so authenticated upserts work.
-- PostgREST upsert (ON CONFLICT) requires UPDATE WITH CHECK in addition to USING.

DROP POLICY IF EXISTS "Users can view own transactions" ON public.budget_transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.budget_transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.budget_transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.budget_transactions;

CREATE POLICY "Users can view own transactions" ON public.budget_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions" ON public.budget_transactions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions" ON public.budget_transactions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions" ON public.budget_transactions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

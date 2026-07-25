-- Dedupe ledger for hiring-pipeline reminders.
--
-- The reminder sweep runs every 15 minutes, so any "is this due?" rule based on
-- time alone would resend the same nudge on every pass. One row per delivered
-- reminder, with a unique constraint doing the enforcing, means a duplicate is
-- rejected by the database rather than depending on the sweep reading its own
-- writes in time.
--
-- The alternative — scanning the notifications table for a matching payload,
-- as job alerts do — gets slower as history grows and cannot express "this
-- exact round, once".

CREATE TABLE IF NOT EXISTS public.job_reminders_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- `{subject}:{id}:{lead}m`, e.g. `interview:<uuid>:60m`. The lead time is
  -- part of the key so the day-before and hour-before rounds are independent.
  reminder_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_reminders_sent_unique UNIQUE (user_id, reminder_key)
);

-- Supports pruning old rows once the events they refer to are long gone.
CREATE INDEX IF NOT EXISTS idx_job_reminders_sent_created
  ON public.job_reminders_sent(created_at);

ALTER TABLE public.job_reminders_sent ENABLE ROW LEVEL SECURITY;

-- Bookkeeping for the sweep, not user-facing data. No client reads or writes;
-- the API service role owns this table entirely.
REVOKE ALL ON TABLE public.job_reminders_sent FROM authenticated, anon;

-- Restore at-most-once delivery for challenge invitations. A retry may replay
-- the pending resource, but it must not create another challenge or notification.

-- Preserve the newest pending invite when historical duplicate requests exist.
WITH ranked_pending AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY group_id, challenger_id, opponent_id
      ORDER BY created_at DESC, id DESC
    ) AS duplicate_rank
  FROM public.group_challenges
  WHERE status = 'pending'
)
UPDATE public.group_challenges AS challenge
SET status = 'cancelled'
FROM ranked_pending
WHERE challenge.id = ranked_pending.id
  AND ranked_pending.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_challenges_one_pending_invite
  ON public.group_challenges (group_id, challenger_id, opponent_id)
  WHERE status = 'pending';

-- A challenge retry can reach notification creation concurrently with the
-- original request. Keep one notification row for each recipient/challenge.
WITH ranked_notifications AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, type, data ->> 'challengeId'
      ORDER BY date ASC, id ASC
    ) AS duplicate_rank
  FROM public.notifications
  WHERE type = 'challenge_invite'
    AND NULLIF(data ->> 'challengeId', '') IS NOT NULL
)
DELETE FROM public.notifications AS notification
USING ranked_notifications
WHERE notification.id = ranked_notifications.id
  AND ranked_notifications.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_challenge_invite_once
  ON public.notifications (user_id, ((data ->> 'challengeId')))
  WHERE type = 'challenge_invite'
    AND NULLIF(data ->> 'challengeId', '') IS NOT NULL;

COMMENT ON INDEX public.idx_group_challenges_one_pending_invite IS
  'Prevents concurrent or retried requests from creating duplicate pending challenge invitations.';

COMMENT ON INDEX public.idx_notifications_challenge_invite_once IS
  'Provides an idempotency boundary for one challenge-invite notification per recipient and challenge.';

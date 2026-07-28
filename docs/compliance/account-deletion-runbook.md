# Account Deletion Runbook

**Last updated:** July 27, 2026

## User-initiated deletion

Settings → Delete account offers two choices (web and mobile).

### A) Pause (30-day grace) — default

1. Client calls `POST /api/v1/users/:userId/deactivate` (self only).
2. API sets `profiles.deactivated_at`, `profiles.deletion_scheduled_at` (= now + 30 days), and `settings.account_status = 'deactivated'`.
3. Auth middleware returns `403 ACCOUNT_DEACTIVATED` for most routes; export / reactivate / delete-immediate / logout remain allowed.
4. Client signs out locally. User can sign back in and **reactivate** (`POST .../reactivate`) before the scheduled date.

### B) Delete permanently now

1. User types `DELETE` and enters password.
2. Client calls `POST /api/v1/users/:userId/delete-immediate` with password.
3. API verifies password, then runs [`deleteUserAccountFully`](../../apps/api-server/src/services/userDataLifecycle.ts) (see below).
4. Client signs out locally.

Legacy / admin: `DELETE /api/v1/users/:userId` also hard-deletes (admin actions logged as `user_delete`).

## Grace-period hard delete (scheduled)

After `deletion_scheduled_at`, [`purgeScheduledAccountDeletions`](../../apps/api-server/src/services/accountLifecycle.ts) hard-deletes overdue accounts via `deleteUserAccountFully`.

It runs as part of [`runDataRetentionPurge`](../../apps/api-server/src/services/dataRetention.ts):

| Mode | How |
|------|-----|
| BullMQ enabled (production) | Worker daily cron `cron.dataRetention` (`0 3 * * *`) |
| BullMQ disabled | In-process timer when `ENABLE_DATA_RETENTION_JOBS=true` |

## Hard delete steps (`deleteUserAccountFully`)

1. Purge storage objects (flashcard-images, marketplace-images, question-images, note-files, profile-avatars prefixes).
2. Remove DM threads where the user is a participant (+ `dm_read_status`).
3. `auth.admin.deleteUser(userId)` — cascades `profiles` and FK-linked rows.
4. Invalidate Redis/cache and AI usage counters.

## Database cascade (via `profiles` / `auth.users`)

Most tables reference `profiles(id) ON DELETE CASCADE` (decks, messages, notes, marketplace, etc.).

## Manual cleanup exceptions

| Item | Handling |
|------|----------|
| `dm_threads` | Explicit purge (JSONB participants, no FK) |
| Storage files | Explicit purge before auth delete (best-effort) |
| `admin_audit_log` | Retained; may contain target user ID |
| Anonymized aggregates | May persist without PII |

## Verification checklist

- [ ] Pause: most API calls return `ACCOUNT_DEACTIVATED`; export/reactivate still work
- [ ] Reactivate: schedule cleared; normal API access restored
- [ ] Immediate delete: user cannot authenticate; profile row absent
- [ ] Storage prefixes empty (best-effort)
- [ ] Export endpoint returns 404 for deleted user
- [ ] After grace date: retention cron removes paused overdue accounts

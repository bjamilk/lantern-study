# Account Deletion Runbook

**Last updated:** June 13, 2026

## User-initiated deletion

1. User confirms in Settings → Delete account (web or mobile).
2. Client calls `DELETE /api/v1/users/:userId` (self only unless platform admin).
3. API executes [`deleteUserAccountFully`](../../apps/api-server/src/services/userDataLifecycle.ts):
   - Purge storage objects (flashcard-images, marketplace-images, question-images prefixes).
   - Remove DM threads where user is a participant.
   - `auth.admin.deleteUser(userId)` — cascades `profiles` and FK-linked rows.
   - Invalidate Redis/cache and AI usage counters.
4. Client signs out locally.

## Admin-initiated deletion

Same API path; actor must be platform admin. Action logged to `admin_audit_log` (`user_delete`).

## Database cascade (via `profiles` / `auth.users`)

Most tables reference `profiles(id) ON DELETE CASCADE` (decks, messages, notes, marketplace, etc.).

## Manual cleanup exceptions

| Item | Handling |
|------|----------|
| `dm_threads` | Explicit purge (JSONB participants, no FK) |
| Storage files | Explicit purge before auth delete |
| `admin_audit_log` | Retained; may contain target user ID |
| Anonymized aggregates | May persist without PII |

## Verification checklist

- [ ] User cannot authenticate after deletion
- [ ] Profile row absent
- [ ] Storage prefixes empty
- [ ] Export endpoint returns 404 for deleted user

## Optional grace period

Not implemented in v1. To add: soft-delete flag + scheduled job calling `deleteUserAccountFully` after N days.

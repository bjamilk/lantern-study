# Data Retention Schedule

**Last updated:** August 22, 2026

| Data type | Retention | Purge mechanism |
|-----------|-----------|-----------------|
| Account & study data | Until user deletes account (or pause grace ends) | `deleteUserAccountFully` |
| Learning activity (`learning_events`: card reviews, question answers, notes opened/created, AI generations, question-bank downloads/scores, group questions posted; `concepts` / `concept_links`) | **Kept while the account exists; deleted with the account** (`profiles` ON DELETE CASCADE). Product data, NOT consent-gated and NOT on the 90-day purge — `runDataRetentionPurge` must never touch it. Included in the GDPR export (`learningEvents`, `conceptLinks`). | `deleteUserAccountFully` (cascade) |
| Paused accounts (grace) | 30 days after deactivate | `purgeScheduledAccountDeletions` via `runDataRetentionPurge` |
| AI inference logs | 90 days | `purgeExpiredAIInferenceLogs()` |
| AI analytics (companion) | 90 days | Same job |
| Product analytics events | 90 days | `purgeExpiredProductEvents()` |
| Server request logs | 30–90 days | Log rotation (hosting) |
| Admin audit log | 24 months | Manual / future cron |

## How the daily job runs

Shared entrypoint: `runDataRetentionPurge()` in `apps/api-server/src/services/dataRetention.ts`.

- **Production (BullMQ):** worker schedules `cron.dataRetention` daily at 03:00 UTC. Set `ENABLE_DATA_RETENTION_JOBS=true` on the worker (deploy script does this).
- **Without BullMQ:** API process starts an in-process daily timer when `ENABLE_DATA_RETENTION_JOBS=true`.

SQL alternative (Supabase pg_cron) for AI logs only:

```sql
SELECT cron.schedule('purge-ai-inference-logs', '0 3 * * *', $$
  DELETE FROM public.ai_inference_log WHERE created_at < NOW() - INTERVAL '90 days';
$$);
```

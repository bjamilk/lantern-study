# Data Retention Schedule

**Last updated:** June 13, 2026

| Data type | Retention | Purge mechanism |
|-----------|-----------|-----------------|
| Account & study data | Until user deletes account | `deleteUserAccountFully` |
| AI inference logs | 90 days | `purgeExpiredAIInferenceLogs()` |
| AI analytics (companion) | 90 days | Same job |
| Server request logs | 30–90 days | Log rotation (hosting) |
| Admin audit log | 24 months | Manual / future cron |
| Deleted account grace | N/A (immediate v1) | — |

Enable automated purge: set `ENABLE_DATA_RETENTION_JOBS=true` on API server.

SQL alternative (Supabase pg_cron):

```sql
SELECT cron.schedule('purge-ai-inference-logs', '0 3 * * *', $$
  DELETE FROM public.ai_inference_log WHERE created_at < NOW() - INTERVAL '90 days';
$$);
```

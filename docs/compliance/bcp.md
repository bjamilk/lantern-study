# Business Continuity Plan (Summary)

**Last updated:** June 13, 2026

## Critical components

| Component | Provider | Recovery |
|-----------|----------|----------|
| Database & Auth | Supabase | Point-in-time recovery via Supabase dashboard |
| API server | Self-hosted / container | Redeploy from CI artifact; env from secrets manager |
| Redis (optional) | ElastiCache / managed | Failover to in-memory cache (degraded mode) |
| Static web | CDN / hosting | Redeploy `build:web` artifact |

## RTO / RPO targets (operational readiness)

| Metric | Target |
|--------|--------|
| RPO (data loss) | ≤ 24 hours (Supabase backup cadence) |
| RTO (API restore) | ≤ 4 hours |

## Degraded modes

- **Redis down:** API uses LRU memory cache (single instance)
- **AI providers down:** User sees error; core study features work offline-capable where implemented
- **Supabase outage:** Read-only/offline bundles on mobile where available

## Testing

- Quarterly: restore Supabase backup to staging
- After each production deploy: `/health` and `/ready` smoke check

See [PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md) for infrastructure setup.

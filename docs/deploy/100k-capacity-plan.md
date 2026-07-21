# ~100k concurrent capacity plan

This is a **blueprint**, not an automatic upgrade of live free/starter services. Apply via Render dashboard / `render.scale.yaml` when ready to pay for always-on replicas.

## Current production ceilings (single process)

| Guard | Value | Source |
|-------|-------|--------|
| HTTP max connections / API process | 512 | `HTTP_MAX_CONNECTIONS` / `httpServer.ts` |
| AI inflight / process | 16 | `AI_MAX_INFLIGHT` / `concurrencyGate.ts` |
| Companion SSE streams / process | 32 | `COMPANION_STREAM_MAX` |
| BullMQ AI worker concurrency | 4 | `AI_WORKER_CONCURRENCY` in `render.yaml` |
| File / export workers | 1 / 1 | worker env |
| Auth user RL | 1200 / 15m | Redis-backed |
| AI daily quota / user | 100 | `AI_DAILY_LIMIT` |
| Topology today | 1× free API + 1× starter worker + free Gotenberg | `render.yaml` |

A single Node process cannot hold 100k concurrent connections. Free Render also cold-starts.

## Target topology

```
Clients → CDN (Cloudflare Pages)
       → N× always-on API replicas (Render standard+)
       → Shared Redis (rate limits + BullMQ)
       → M× BullMQ workers (AI / files / exports)
       → Supabase (Auth + Postgres pooler + Storage)
       → Gotenberg (always-on) or managed PDF service
```

### Worked example (order-of-magnitude)

Assume average concurrent user holds ~0.05–0.2 idle HTTP keep-alive slots and rare bursts of AI/SSE.

| Layer | Sizing rule of thumb |
|-------|----------------------|
| API replicas | `ceil(100_000 × active_conn_fraction / HTTP_MAX_CONNECTIONS)` → start **~40–80** replicas at 512 conn if 20–40% of concurrent users hold a socket; raise `HTTP_MAX_CONNECTIONS` only with larger instance RAM |
| Redis | Managed (Upstash / Redis Cloud) with connection pool ≥ `N_api + M_workers + headroom`; required for shared RL |
| Postgres | Supabase **pooler** (transaction mode) for API; size compute for peak QPS + Realtime; watch `pg_stat_activity` |
| BullMQ workers | Size `M` so `M × AI_WORKER_CONCURRENCY ≤ provider RPM` and ≤ global AI budget; keep heavy AI **off** the HTTP process |
| Realtime | Prefer API fan-out / short polling for hot paths; Cap Supabase Realtime channels; avoid per-user broadcasts at 100k |
| AI quota | Global + per-user limits already env-driven; at 100k, enforce queue backpressure (503 + `Retry-After`) when workers saturated |

### Rollout stages

1. **Stage A — Always-on API + Redis** (eliminate cold start; 2–4 API replicas).
2. **Stage B — Worker scale** (raise `AI_WORKER_CONCURRENCY`, add workers; sync AI off web path).
3. **Stage C — Horizontal API** (10+ replicas, load test HTTP/RL/DB).
4. **Stage D — DB/Realtime/Storage** (pooler, indexes, storage via API only).
5. **Stage E — Full 100k drill** (k6/Gatling soak; tune load-shed heap/RSS).

## Scale blueprint file

See repo-root [`render.scale.yaml`](../../render.scale.yaml). Do **not** apply blindly over free production without confirming Redis, secrets, and billing.

## Related

- [API hosting](./03-api-hosting.md)
- Env catalog: `apps/api-server/.env.example`

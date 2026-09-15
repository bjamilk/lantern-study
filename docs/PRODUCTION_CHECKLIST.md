# Production Deployment Checklist

## ✅ Implemented by AI Agent (Ready to Use)

### Security
- [x] **Rate Limiting** - `apps/api-server/src/middleware/security.ts`
  - General: 100 requests/minute
  - Auth endpoints: 10 requests/15 minutes
  - Expensive operations: 20 requests/minute
  - Messages: 60 requests/minute

- [x] **Security Headers** - Helmet with CSP, HSTS, XSS protection
- [x] **CORS Configuration** - Production-ready with whitelist
- [x] **Input Sanitization** - XSS prevention middleware
- [x] **Request ID Tracking** - UUID per request for debugging

### Validation
- [x] **Joi Schemas** - `apps/api-server/src/validators/schemas.ts`
  - User registration/login/update
  - Groups, messages, flashcards
  - Tests, notifications, marketplace

### Error Handling
- [x] **Custom Error Classes** - `apps/api-server/src/middleware/productionErrorHandler.ts`
  - AppError, NotFoundError, UnauthorizedError
  - ForbiddenError, ValidationError, ConflictError
  - RateLimitError, BadRequestError

- [x] **Global Error Handler** - Consistent error responses
- [x] **Async Error Wrapper** - Automatic try/catch

### Logging
- [x] **Structured Logger** - `apps/api-server/src/services/logger.ts`
  - Log levels (debug, info, warn, error)
  - JSON format for production
  - Sensitive data redaction
  - Request logging middleware

### Caching
- [x] **LRU Cache** - `apps/api-server/src/services/productionCache.ts`
  - 10,000 entry capacity
  - Automatic TTL expiration
  - Hit/miss statistics
  - Rate limit support

### Performance
- [x] **DataLoader Pattern** - `apps/api-server/src/services/dataLoaders.ts`
  - N+1 query prevention
  - Batch loading for users, groups, members
  - Request-scoped caching

- [x] **Database Indexes** - `supabase/migrations/20260118000000_add_production_indexes.sql`
  - Composite indexes for common queries
  - Partial indexes for optimization
  - Full-text search indexes

### Monitoring
- [x] **Health Check Endpoints** - `apps/api-server/src/routes/health.ts`
  - `GET /health` - Load balancer probe
  - `GET /ready` - Detailed readiness check
  - `GET /metrics` - System metrics

### Configuration
- [x] **Production Config** - `apps/api-server/src/config/production.ts`
  - Environment validation
  - Graceful shutdown handlers
  - Middleware application helpers

---

## ⚠️ Requires External Setup

### Infrastructure (Cloud Provider Needed)

#### Redis Cache (Distributed Caching)
**Why needed:** In-memory cache doesn't scale across multiple server instances
**Options:**
- AWS ElastiCache
- Google Cloud Memorystore
- Azure Cache for Redis
- Upstash (serverless Redis)

**Setup:**
```bash
# Add to .env
REDIS_ENABLED=true
REDIS_URL=redis://your-redis-host:6379
REDIS_PASSWORD=your-password
ENABLE_DATA_RETENTION_JOBS=true
ENABLE_MARKETPLACE_JOBS=true
AI_LOG_RETENTION_DAYS=90
OPERATIONAL_ACCESS_TOKEN=generate-a-long-random-token
```

#### Load Balancer
**Why needed:** Distribute traffic across multiple server instances
**Options:**
- AWS Application Load Balancer (ALB)
- Google Cloud Load Balancing
- Cloudflare Load Balancing
- nginx (self-hosted)

#### Container Orchestration
**Why needed:** Auto-scaling based on load
**Options:**
- Kubernetes (AWS EKS, Google GKE, Azure AKS)
- Docker Swarm
- AWS ECS
- Railway/Render/Fly.io (simpler options)

### CDN & Edge (Third-Party Service)

#### CDN for Static Assets
**Why needed:** Reduce latency for global users
**Options:**
- Cloudflare
- AWS CloudFront
- Fastly
- Vercel Edge Network

### Database (Supabase Configuration)

#### Read Replicas
**Why needed:** Handle read-heavy workloads at scale
**Setup:** Enable in Supabase Pro plan dashboard

#### Connection Pooling
**Why needed:** Prevent database connection exhaustion
**Setup:** Supabase includes PgBouncer, configure `poolMode` in connection string

**Apply indexes:**
```bash
# Run the migration
npx supabase db push
```

### Monitoring & Observability (Third-Party Services)

#### Error Tracking
**Options:**
- Sentry (recommended)
- Bugsnag
- Rollbar

**Setup:**
```bash
npm install @sentry/node
```

```typescript
// In server.ts
import * as Sentry from '@sentry/node';
Sentry.init({ dsn: process.env.SENTRY_DSN });
```

#### APM (Application Performance Monitoring)
**Options:**
- DataDog
- New Relic
- Elastic APM
- Grafana Cloud

#### Log Aggregation
**Options:**
- LogRocket
- Papertrail
- Loggly
- ELK Stack

### SSL/TLS (Required for Production)
**Options:**
- Let's Encrypt (free, auto-renewal)
- Cloudflare (automatic with their CDN)
- AWS Certificate Manager

### Backup & Disaster Recovery
**Setup:**
- Enable Point-in-Time Recovery in Supabase
- Configure automated backups
- Set up backup retention policy

---

## 📋 Pre-Launch Checklist

### Environment
- [ ] Set `NODE_ENV=production`
- [ ] Configure all environment variables
- [ ] Remove development-only code/logs
- [ ] Set `STRICT_AUTH=true`

### Security
- [ ] Rotate all API keys and secrets
- [ ] Enable MFA for admin accounts
- [ ] Review RLS policies in Supabase
- [ ] Run security audit: `npm audit`

### Performance
- [ ] Run database migration for indexes
- [ ] Test under load (artillery, k6)
- [ ] Configure connection pooling

### Monitoring
- [ ] Set up error tracking (Sentry)
- [ ] Configure alerting thresholds
- [ ] Set up uptime monitoring

### Backup
- [ ] Enable automated backups
- [ ] Test restore procedure
- [ ] Document recovery process

---

## 🔢 Scaling Estimates for 100,000 Concurrent Users

| Component | Minimum Recommendation |
|-----------|----------------------|
| API Servers | 8-12 instances (2 vCPU, 4GB RAM each) |
| Database | Supabase Pro with read replicas |
| Redis Cache | 2GB minimum, cluster mode for HA |
| CDN | Required for static assets |
| WebSocket | Consider dedicated server/service |

### Cost Estimates (Monthly)
- **API Servers**: $200-500/mo (depends on provider)
- **Supabase Pro**: $25/mo + usage
- **Redis**: $50-200/mo
- **CDN**: $0-100/mo (depends on traffic)
- **Monitoring**: $50-300/mo

---

## 📁 Files Created

```
apps/api-server/src/
├── config/
│   └── production.ts          # Production config & helpers
├── middleware/
│   ├── security.ts            # Rate limiting, CORS, headers
│   └── productionErrorHandler.ts  # Error classes & handlers
├── routes/
│   └── health.ts              # Health check endpoints
├── services/
│   ├── logger.ts              # Structured logging
│   ├── productionCache.ts     # LRU cache with TTL
│   └── dataLoaders.ts         # N+1 query prevention
└── validators/
    └── schemas.ts             # Joi validation schemas

supabase/migrations/
└── 20260118000000_add_production_indexes.sql  # Database indexes
```

---

## Compliance (Operational Readiness)

Governance and product artifacts for GDPR / EU AI Act / SOC2 readiness (not formal certification):

| Artifact | Location |
|----------|----------|
| Privacy Policy, Terms, Cookies | Web: `/privacy`, `/terms`, `/cookies` — source: `packages/shared/src/legal/` |
| RoPA | [docs/compliance/ropa.md](compliance/ropa.md) |
| Subprocessors & data flow | [docs/compliance/subprocessors.md](compliance/subprocessors.md) |
| Account deletion runbook | [docs/compliance/account-deletion-runbook.md](compliance/account-deletion-runbook.md) |
| AI System Card | [docs/compliance/ai-system-card.md](compliance/ai-system-card.md) |
| Incident response | [docs/compliance/incident-response.md](compliance/incident-response.md) |
| BCP summary | [docs/compliance/bcp.md](compliance/bcp.md) |
| Control matrix | [docs/compliance/control-matrix.md](compliance/control-matrix.md) |
| Retention schedule | [docs/compliance/retention-schedule.md](compliance/retention-schedule.md) |

**Product controls:**

- [x] Full account deletion — `apps/api-server/src/services/userDataLifecycle.ts`
- [x] Data export — `GET /api/v1/users/:userId/export`
- [x] AI disclaimers — `components/AIDisclaimer.tsx`, mobile counterpart
- [x] AI inference logging — migration `20260613140100_ai_inference_log.sql`
- [x] Profile visibility RLS — migration `20260613140000_compliance_privacy.sql`
- [x] CI `npm audit` — `.github/workflows/ci.yml`
- [x] Retention jobs — set `ENABLE_DATA_RETENTION_JOBS=true` on API server
- [x] Marketplace saved-search alerts & review reminders — set `ENABLE_MARKETPLACE_JOBS=true` on API server; apply migrations `20260615140000_marketplace_orders.sql`, `20260615150000_marketplace_promotions.sql`, `20260615160000_marketplace_search_promotions.sql`

**Before marketing as compliant:** external legal review of policies; collect vendor DPAs.

### Notes — PDF & PowerPoint uploads
- [x] Signed URL refresh for `note-files` attachments (`GET /api/v1/notes/:noteId/attachments/:attachmentId/url`)
- [x] Server-side PDF upload + text extraction (`POST /api/v1/notes/upload-pdf`)
- [x] PowerPoint upload with text extraction (`POST /api/v1/notes/upload-presentation`)
- [x] **Gotenberg for PPTX → PDF preview** — `lantern-study-gotenberg` service in `render.yaml`; API uses `GOTENBERG_URL` (`hostport` from service).
- [x] Apply migration `20260615120000_note_presentation_attachments.sql` (presentation attachment + source types)

---

## 🚀 Quick Start for Production

1. **Install dependencies** (done):
   ```bash
   npm install joi express-rate-limit
   ```

2. **Apply database indexes**:
   ```bash
   npx supabase db push
   ```

3. **Configure environment**:
   ```bash
   cp apps/api-server/.env.example apps/api-server/.env
   # Edit .env with production values
   ```

4. **Build for production**:
   ```bash
   npm run build
   ```

5. **Start with PM2**:
   ```bash
   pm2 start ecosystem.config.js --env production
   ```

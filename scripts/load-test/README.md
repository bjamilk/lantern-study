# Load testing

Requires [k6](https://k6.io/docs/get-started/installation/).

```bash
# Health + readiness probe load test
k6 run scripts/load-test/health.js

# Against a deployed API
API_URL=https://api.yourdomain.com k6 run scripts/load-test/health.js
```

Target SLOs (soft launch): p95 < 500ms on `/health`, error rate < 1%.

For 200k concurrent users, extend with authenticated scenario scripts and Realtime fan-out tests before launch.

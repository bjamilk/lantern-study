# Incident Response Runbook

**Last updated:** June 13, 2026

## 1. Detect

- Sentry alerts (if enabled)
- User reports (support@lanternstudy.app)
- Admin audit anomalies
- Supabase / hosting provider notices

## 2. Triage (≤ 1 hour)

| Severity | Examples | Response |
|----------|----------|----------|
| P1 | Active breach, mass data leak | All-hands, contain immediately |
| P2 | Vulnerability exploit attempt | Patch / block within 24h |
| P3 | Policy violation, spam | Standard moderation |

Assign **Incident Lead** and document in shared channel.

## 3. Contain

- Revoke compromised tokens / rotate API keys
- Disable affected feature flags
- Block abusive IPs (rate limit / WAF)
- Preserve logs — do not delete evidence

## 4. Assess (GDPR Art. 33)

Determine if personal data breach likely to result in risk to individuals.

- **High risk:** Notify supervisory authority within **72 hours**
- **High risk to individuals:** Notify affected users without undue delay

Consult legal counsel for notification wording.

## 5. Recover

- Deploy fix, verify via health checks
- Restore from Supabase backup if data corruption
- Re-enable services incrementally

## 6. Postmortem (within 5 business days)

- Timeline, root cause, impact, action items
- Update control matrix and this runbook

## Contacts (template)

| Role | Contact |
|------|---------|
| Incident Lead | founder@lanternstudy.app |
| Engineering | engineering@lanternstudy.app |
| Legal | (external counsel) |

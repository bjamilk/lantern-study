# Compliance Control Matrix (Readiness Tracker)

**Last updated:** June 13, 2026  
**Target:** ≥80% implemented or partial-with-plan for P0/P1 controls

| ID | Framework | Control | Status | Evidence |
|----|-----------|---------|--------|----------|
| C01 | GDPR Art. 13/14 | Privacy Policy published | Implemented | `/privacy`, `packages/shared/src/legal/` |
| C02 | GDPR Art. 17 | Account deletion | Implemented | `userDataLifecycle.ts`, Settings UI |
| C03 | GDPR Art. 15/20 | Data export | Implemented | `GET /users/:id/export` |
| C04 | GDPR Art. 30 | RoPA | Implemented | `docs/compliance/ropa.md` |
| C05 | GDPR Art. 28 | Subprocessor register | Partial | `subprocessors.md` — DPAs not all signed |
| C06 | EU AI Act | AI transparency labels | Implemented | `AIDisclaimer` components |
| C07 | EU AI Act | AI inference logging | Implemented | `ai_inference_log` migration |
| C08 | SOC2 CC6 | Access control / auth | Implemented | `auth.ts`, RLS migrations |
| C09 | SOC2 CC7 | Rate limits & monitoring | Implemented | `rateLimit.ts`, `health.ts` |
| C10 | SOC2 CC7 | Admin audit log | Implemented | `admin_audit.ts` |
| C11 | ISO A.12 | Dependency scanning | Implemented | CI `npm audit` job |
| C12 | ISO A.16 | Incident response | Implemented | `incident-response.md` |
| C13 | ISO A.17 | BCP summary | Implemented | `bcp.md` |
| C14 | Privacy | Profile visibility enforcement | Implemented | `20260613140000_compliance_privacy.sql` |
| C15 | Ops | Data retention jobs | Partial | `dataRetention.ts` — enable via env |
| C16 | Legal | Counsel review of policies | Gap | Schedule external review |

**Owner:** Engineering + Founder/Ops  
**Review cadence:** Quarterly or after major feature releases

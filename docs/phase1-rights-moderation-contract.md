# Phase 1 · E — Rights attestation, content reports, takedown/appeal, strikes, policy docs: implementation contract

Status: **server + shared half shipped** (2026-08-22) — migration `20260822140000` (hand-apply BEFORE deploying the API: listing create + question-bank publish write the new columns directly), **plus the 2026-08-22 review hardening:** `content_reports` is service-role only (no authenticated INSERT/SELECT grant or policy — report through `POST /reports`); `20260822120000` exempts GoTrue / FK cascades (`session_user = 'supabase_auth_admin'`, `pg_trigger_depth() > 1`) so account deletion no longer fails on a moderated listing; `supabase/migrations/20260822170000_phase1_hardening.sql` (apply LAST) hides `rights_*` / `moderation_flags` / `takedown_*` / `appeal_*` from anon+authenticated via column-level SELECT grants, revokes direct client INSERT/UPDATE/DELETE on `marketplace_listings`, and gives `strip_privileged_profile_settings` a service-role guard so `settings.suspended_until` actually persists (suspensions were silently reverted before); `packages/shared/src/moderation/*` + legal/contact/types/endpoints, `apps/api-server` routes/services/tests (§§1–3, §6 API side). **Web (§4) and mobile (§5) are still queued**: both publish modals must now send `attestation: true` (+ `aiAssisted`, `sourcesCited`), listing create/edit must send `attestation` for academic categories, `updateQuestionBankContent` must pass `{ attestation: true }`, and clients must handle the 403 `ACCOUNT_SUSPENDED` code; `components/LegalPage.tsx` `LEGAL_DESCRIPTIONS` needs the two new ids (use `LEGAL_DOCUMENT_DESCRIPTIONS` from shared). Parent plan: `docs/PLAN-2026-08-22-knowledge-network.md` §4 E. Already shipped from E: the listing moderation lock (`packages/shared/src/marketplace/lifecycle.ts`, API guards in `SupabaseService.updateListingStatus` / `updateMarketplaceListing`, trigger migration `20260822120000`, read-only moderated state on web + mobile My Listings). This slice finishes E.

## 1. Database — `supabase/migrations/20260822140000_rights_and_moderation.sql` (hand-applied; after `20260822130000`; REQUIRED before the API deploy; `20260822170000_phase1_hardening.sql` hardens it)

```sql
-- 1a. Rights + takedown state on listings
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS rights_status text NOT NULL DEFAULT 'unattested'
    CHECK (rights_status IN ('unattested','attested','under_review','takedown','cleared')),
  ADD COLUMN IF NOT EXISTS rights_attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS rights_attestation_version text,
  ADD COLUMN IF NOT EXISTS moderation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,  -- soft content-filter hits
  ADD COLUMN IF NOT EXISTS takedown_reason text,
  ADD COLUMN IF NOT EXISTS takedown_at timestamptz,
  ADD COLUMN IF NOT EXISTS takedown_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS appeal_status text NOT NULL DEFAULT 'none'
    CHECK (appeal_status IN ('none','requested','upheld','reversed')),
  ADD COLUMN IF NOT EXISTS appeal_note text,
  ADD COLUMN IF NOT EXISTS appealed_at timestamptz,
  ADD COLUMN IF NOT EXISTS appeal_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS appeal_decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 1b. Provenance on digital content
ALTER TABLE public.marketplace_question_banks
  ADD COLUMN IF NOT EXISTS rights_attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS rights_attestation_version text,
  ADD COLUMN IF NOT EXISTS ai_assisted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sources_cited jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS originality_score numeric;      -- reserved; not computed yet
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS removed_by_admin_at timestamptz;  -- decks already have it (20260608100000)

-- 1c. Generic content reports (supersedes marketplace_reports / job_reports for NEW reports; old rows are backfilled)
CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('listing','question_bank','note','deck','user','group','message','dm_message','job_posting')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('scam','spam','inappropriate','copyright','leaked_exam','plagiarism','harassment','prohibited_item','wrong_category','discriminatory','other')),
  details text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','under_review','resolved','dismissed')),
  admin_note text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  legacy_source text,            -- 'marketplace_reports' | 'job_reports' for backfilled rows
  legacy_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS content_reports_status_idx ON public.content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS content_reports_target_idx ON public.content_reports (target_type, target_id);
-- Backfill: INSERT ... SELECT from marketplace_reports (target_type 'listing') and job_reports ('job_posting'),
-- mapping status/admin_note/resolved_*; ON CONFLICT DO NOTHING. Keep the old tables (read-only from now on).
-- RLS: reporter INSERT (reporter_id = auth.uid()) + SELECT own; service_role ALL.

-- 1d. Strikes
CREATE TABLE IF NOT EXISTS public.moderation_strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  report_id uuid REFERENCES public.content_reports(id) ON DELETE SET NULL,
  severity smallint NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 3),
  reason text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days')
);
CREATE INDEX IF NOT EXISTS moderation_strikes_user_idx ON public.moderation_strikes (user_id, expires_at);
-- RLS: service_role only (users see their strike count via the API, not the table).
```

Suspension state lives in the already-reserved privileged key `profiles.settings.suspended_until` (ISO string) + `settings.moderation_flags` (`apps/api-server/src/utils/sanitizeSettings.ts:17-19`, trigger `20260625120000:56`) — no new column.

## 2. Shared (packages/shared)

- `src/moderation/index.ts` (new, export from root + `./moderation` subpath): `CONTENT_REPORT_TARGET_TYPES`, `CONTENT_REPORT_REASONS` with labels (`REPORT_REASON_LABELS`), `reasonsForTarget(targetType)` (e.g. listing: scam, spam, inappropriate, copyright, leaked_exam, plagiarism, prohibited_item, wrong_category, other; user: harassment, spam, scam, inappropriate, other; message/dm: harassment, spam, inappropriate, other), `RIGHTS_ATTESTATION_VERSION = '2026-08-22-v1'`, `RIGHTS_ATTESTATION_TEXT` (the sentence both publish flows show), `ACADEMIC_LISTING_CATEGORIES = ['pq_bank','lecture_notes','project_thesis','textbooks']` (check the real category ids in the listing category constants), `isAcademicListing({ listingKind, category })`.
- `src/moderation/contentFilter.ts` modelled on `src/jobs/scamPlaybook.ts`: `CONTENT_BLOCK_PATTERNS` (hard block: leaked / unreleased exam papers — "leaked", "leak(ed)? exam", "unreleased", "this semester'?s exam", "expo" as exam-malpractice slang, "exam answers before", "upcoming exam questions"), `CONTENT_FLAG_PATTERNS` (advisory: "lecturer'?s slides", "textbook pdf", "solution manual", "copyrighted", "scanned textbook"), `textFailsContentCheck(text)`, `textContentFlags(text)`; unit tests. **Past questions are legitimate** (the `pq_bank` category exists) — patterns must not match "past questions" / "past papers".
- `src/legal.ts`: `LegalDocumentId` += `'prohibited' | 'seller-terms'`; `PROHIBITED_CONTENT_MD` (prohibited content + academic-integrity policy: no leaked/unreleased exams or assessments, no impersonation of lecturers/institutions, no harassment, no scams, copyrighted material only with rights, how to report, consequences = strikes/suspension/removal, appeals) and `SELLER_TERMS_MD` (seller & creator terms: rights warranty at publish, takedown on complaint, counter-notice/appeal, repeat-infringer = 3 active strikes → suspension, payouts subject to disputes, Lantern's commission as configured) — both clearly marked "draft for counsel review", referenced from `TERMS_OF_SERVICE_MD` "Your content"/"Marketplace" sections, and added to `LEGAL_DOCUMENTS`/route maps that `LegalPage.tsx` and mobile `LegalDocumentScreen` use. `src/contactForm.ts`: add `'copyright'` category ("Copyright / content complaint").
- Types: `ContentReport`, `ModerationStrike`, listing fields `rightsStatus`, `takedownReason`, `appealStatus` on `MarketplaceListing` (+ snake_case mirrors where the type carries both).
- `src/api/endpoints.ts`: `reportContent({ targetType, targetId, reason, details })`, `appealListingTakedown(listingId, note)`, `fetchMyModerationState()` (strikes count + suspendedUntil), admin: `fetchAdminReports({ status, targetType, page })`, `resolveAdminReport(id, { action, note })`, `fetchAdminAppeals()`, `decideListingAppeal(listingId, { decision, note })`, `addStrike(userId, { reason, severity, reportId })`.

## 3. API

| Route | Behaviour |
|---|---|
| `POST /reports` (auth, `publicWriteRateLimit`) `{ targetType, targetId, reason, details? }` | Validates reason ∈ `reasonsForTarget`; target existence check per type (listing/question_bank → listing exists; note/deck/group/user/job_posting exist; message/dm_message exist); 409 on duplicate (reporter,target). Writes `content_reports`. Returns `{ id, status }`. |
| `POST /marketplace/listings/:id/reports` (existing) | Now writes `content_reports` (target_type 'listing') via the same service; keeps the legacy reason normaliser (`utils/marketplaceReportReason.ts`) for old clients; stops writing `marketplace_reports`. Same for `POST /jobs-board/postings/:id/reports` → 'job_posting'. |
| `GET /admin/reports?status&targetType&page` | Reads `content_reports` (joined: reporter username, target summary — listing title/seller; note title/owner; deck name/owner; user username; group name; message snippet; job title). Replaces the old marketplace-only query; `GET /admin/jobs/reports` may stay as a thin filter. |
| `PUT /admin/reports/:id` `{ action: 'dismiss' \| 'under_review' \| 'warn' \| 'remove_content' \| 'strike', note?, severity? }` | `dismiss`/`under_review` set status; `warn` → notification to the target's owner with `force: true` (createNotification otherwise honours mutes) + status resolved; `remove_content` → listing: status `removed_by_admin`, `rights_status 'takedown'`, `takedown_reason = note \| reason label`, `takedown_at/by`, notify seller force:true, status resolved · question_bank: same on its listing · note: `removed_by_admin_at = now()` (and the note stops being returned by GET /notes for non-admins) · deck: `removed_by_admin_at` (exists) · group: archive (existing admin path) · message/dm_message/user/job_posting: NOT auto-removed in v1 — return 400 "use the dedicated tool" and keep the report under_review; `strike` → insert `moderation_strikes` (severity default 1) for the target owner + resolve report; after insert, if active strikes ≥ 3 → set `settings.suspended_until = now()+14d` (service role, merge into settings without touching other keys) and notify force:true. All actions audit-logged (`logAdminAction`). |
| `PATCH /admin/users/:id/status` (existing) | Accept `'suspended'` with `until` (ISO, ≤ 365d) → sets `suspended_until`; `'active'` clears `is_banned` AND `suspended_until`. |
| Enforcement | `isUserBanned` (`services/adminAudit.ts:68-86`) and `rejectIfBanned` (`middleware/auth.ts:115`) treat `suspended_until > now()` as blocked with 403 `{ error: 'Account suspended until <date>' , code: 'ACCOUNT_SUSPENDED' }` (no global sign-out). `GET /users/me/moderation` → `{ activeStrikes, suspendedUntil }`. |
| `POST /marketplace/question-banks/publish` | Body gains `attestation: true` (required → 400 "You must confirm you have the rights to share this content"), `aiAssisted?: boolean`, `sourcesCited?: string[]` (≤ 20, each ≤ 200 chars). Writes `rights_attested_at/version`, `ai_assisted`, `sources_cited` on the bank and `rights_status='attested'` + `rights_attested_at/version` on the listing. Update-content (`POST /question-banks/:id/update-content`) re-requires `attestation: true`. |
| `POST /marketplace/listings` and `PUT /marketplace/listings/:id` | If `isAcademicListing({ listingKind, category })` → require `attestation: true` on create (400 otherwise); write rights fields. Run the content filter on title+description for **all** listings: block tier → 400 with the pattern's message; flag tier → store hits in `moderation_flags` and auto-insert a `content_reports` row (reporter = listing owner is wrong — use a fixed system reporter: `reporter_id = owner`, `reason 'leaked_exam'|'copyright'`, `status 'under_review'`, `details 'auto-flag: <pattern>'`; if UNIQUE conflicts, skip). |
| `POST /marketplace/listings/:id/appeal` `{ note }` (owner only) | Only when status ∈ {removed_by_admin, suspended_by_admin} and `appeal_status = 'none'`; sets `appeal_status 'requested'`, `appeal_note`, `appealed_at`; notifies admins? (v1: appears in the admin queue). 409 if already appealed. |
| `GET /admin/appeals`, `PUT /admin/marketplace/listings/:id/appeal` `{ decision: 'upheld'\|'reversed', note? }` | `reversed` → status `active`, `rights_status 'cleared'`, clears takedown fields, notifies seller force:true; `upheld` → notifies seller. Audit-logged. |
| `GET /marketplace/listings/:id` (owner view) and `GET /marketplace/my-listings` | Include `rights_status`, `takedown_reason`, `takedown_at`, `appeal_status`, `appeal_note` for the owner/admin only (strip for other viewers). |

## 4. Web

- Publish question bank modal (`components/marketplace/PublishQuestionBankModal.tsx`): send `attestation`, add "This pack was AI-assisted" toggle (`aiAssisted`) and an optional "Sources" textarea (one per line → `sourcesCited`); link the attestation text to `/legal/seller-terms`.
- `CreateMarketplaceListingModal` / `EditMarketplaceListingModal`: rights checkbox for academic categories (same text), blocked-content 400 message surfaced inline.
- `MyListingsScreen`: moderated row shows `takedown_reason` when present and an **Appeal** button (one-shot, opens a small modal for the note → `appealListingTakedown`); shows "Appeal submitted/upheld/reversed" state.
- Report entry points (menu item "Report…") opening a shared `ReportContentModal` (reason select from `reasonsForTarget`, details): listing detail (replace the old reasons), seller profile (target user), note (shared note view / `NotesScreen` row menu), deck (`DeckDetailScreen` for shared decks), group info (`GroupInfoModal`), group message (`MessageItem` "Report" → replaces the "flag as similar" label? — NO: keep "Flag as similar" (it is a duplicate-question signal) and ADD "Report"), DM header (`ChatWindow`).
- Admin: `components/admin/AdminReports.tsx` → generic queue with target-type filter, target summary, actions (dismiss / under review / warn / remove content / strike with severity); new `AdminAppeals` tab or section in `AdminMarketplace`; `UserDetailDrawer` shows strikes + suspend-until control.
- Legal: `LegalPage` nav + routes `/legal/prohibited` and `/legal/seller-terms` (check how `/privacy` `/terms` `/cookies` are routed in `index.tsx:51-53` / `utils/appRoutes.ts` and mirror); contact form gets the `copyright` category.
- Account suspended: when the API returns `ACCOUNT_SUSPENDED`, show a blocking banner/modal (reuse `AccountPausedBanner` styling) with the date and support email.

## 5. Mobile

- `settings/PublishQuestionBankModal.tsx`: same fields as web. `CreateListingScreen` / `EditListingScreen`: add the rights checkbox (mobile had none) for academic categories.
- `MyListingsScreen`: takedown reason + Appeal (Alert prompt for the note).
- Report entry points: listing detail (replace reasons), `SellerProfileScreen`, `DirectMessageScreen` header menu, `GroupChatScreen` message long-press "Report" (keep "Report message → flag as similar" as a separate "Flag duplicate"), `GroupInfoModal`, notes list row.
- Legal screen list gains the two documents; suspended-account handling mirrors web.

## 6. Tests & gates

Shared: content filter (block vs flag vs allowed "past questions"), `reasonsForTarget`, legal doc ids. API (prototype+stub pattern): report dedupe 409, remove_content on a listing sets takedown fields + removed_by_admin, strike auto-suspend at 3, `rejectIfBanned` with `suspended_until` in the past vs future, publish without attestation → 400, academic listing without attestation → 400, content filter block → 400, appeal state machine. Gates: `apps/api-server` tsc + jest; root `npm run build`; `apps/mobile` tsc. Never stash/checkout; don't commit.

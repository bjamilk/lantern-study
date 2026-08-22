# Phase 1 knowledge-network — go-live runbook

One tick-through to take Phase 1 (`docs/PLAN-2026-08-22-knowledge-network.md`, `docs/phase1-*-contract.md`) from the uncommitted working tree to live. Detail lives in `docs/RELEASING.md`; this is the checklist + the verify queries + the smoke test.

**The one hard rule:** apply the 7 migrations **before** the API redeploys. The API build writes `course_id` / `rights_*` / `moderation_flags` unconditionally (no missing-column fallback), so an API deploy against a DB without those columns breaks listing/question-bank publish and every create route. The API auto-deploys from `main` on Render, so *apply SQL first, push second*.

---

## Step 0 — pre-flight
- [ ] You're in `~/Desktop/lantern-study` (lowercase — the real repo), not `~/Desktop/Lanternstudy`.
- [ ] Gates green locally (already verified this session): `cd apps/api-server && npx tsc --noEmit && npx jest`; `npm run build`; `cd apps/mobile && npx tsc --noEmit`.
- [ ] Take a Supabase backup / note the point-in-time (each migration has a rollback block at its foot, but a backup is the real safety net).

## Step 1 — apply the 7 migrations (Supabase SQL editor, in order)
Paste each file's contents and run. Each is idempotent (safe to re-run a partial apply).

1. [ ] `supabase/migrations/20260822120000_marketplace_listings_moderation_lock.sql`
2. [ ] `supabase/migrations/20260822121000_marketplace_release_escrow_moderation_safe.sql`
3. [ ] `supabase/migrations/20260822130000_academic_identity_and_courses.sql`
4. [ ] `supabase/migrations/20260822140000_rights_and_moderation.sql`
5. [ ] `supabase/migrations/20260822150000_learning_events_and_concepts.sql`
6. [ ] `supabase/migrations/20260822160000_library_search_indexes.sql`
7. [ ] `supabase/migrations/20260822170000_phase1_hardening.sql` (**must be last** — re-grants columns `140000` adds and backfills from `130000`)

### Verify (run after all 7 — every row should return the expected value)
```sql
-- tables/objects exist
select to_regclass('public.courses')                as courses,
       to_regclass('public.user_courses')           as user_courses,
       to_regclass('public.content_reports')        as content_reports,
       to_regclass('public.moderation_strikes')     as moderation_strikes,
       to_regclass('public.learning_events')        as learning_events,
       to_regclass('public.concepts')               as concepts,
       to_regclass('public.concept_links')          as concept_links,
       to_regclass('public.institutions')           as institutions_view;

-- new columns landed
select count(*) as profile_academic_cols
  from information_schema.columns
 where table_name='profiles'
   and column_name in ('institution_id','faculty','programme','study_level','entry_year','expected_graduation_year');  -- expect 6

select count(*) as listing_rights_cols
  from information_schema.columns
 where table_name='marketplace_listings'
   and column_name in ('rights_status','moderation_flags','takedown_reason','appeal_status');  -- expect 4

-- course_id fanned out onto the 8 artefact tables (expect 8)
select count(distinct table_name) as course_id_tables
  from information_schema.columns
 where column_name='course_id'
   and table_name in ('notes','note_folders','decks','groups','test_sessions',
                      'offline_bundles','marketplace_listings','marketplace_question_banks');

-- 170000 hardening landed: content_reports is service-role only, and the
-- moderation-lock trigger exists on marketplace_listings
select count(*) as content_reports_client_grants
  from information_schema.role_table_grants
 where table_name='content_reports' and grantee in ('anon','authenticated');  -- expect 0

select tgname from pg_trigger
 where tgrelid='public.marketplace_listings'::regclass
   and tgname like 'marketplace_listings_guard_moderated%';  -- expect 2 (update + delete)

-- institutions view hides sentinels + inactive campuses
select bool_and(kind <> 'other' and active) as institutions_clean from public.institutions;  -- expect t
```
If any check is wrong, do **not** proceed to deploy — re-run the missing migration or roll back and tell me.

## Step 2 — deploy
Migrations are applied, so the API is safe to redeploy.
- [ ] **Commit + push** the Phase 1 branch to `main` → Render auto-deploys the API. (245 files: 150 modified, 95 new. I can prepare a clean commit + message on your word — I haven't committed anything.)
- [ ] **Deploy web manually** — Pages is NOT git-connected: `npm run build:web` then `wrangler pages deploy` per `DEVELOPMENT.md`. Confirm the built bundle hash matches `dist` (a failed `build:web` leaves a stale `dist`).
- [ ] API health marker: `curl -s https://lantern-study-api.onrender.com/health` shows the new commit.
- [ ] Web SW id bumped: `curl -s https://lanternstudy.com/sw.js | grep -oE 'lantern-[a-z0-9]+-[a-z0-9]+'`.

## Step 3 — smoke test (prod, signed in)
- [ ] **Academic**: sign in → profile-setup prompts University → Programme → Level → Courses; pick a course; it saves (Settings → Academic shows it). A student with no listed school can still finish (institution optional, "My institution isn't listed").
- [ ] **Course filing**: create a note and a deck filed under a course; Library shows the course tree with counts; the course chip filters Notes/Flashcards; `/library/search` finds them.
- [ ] **Archive**: Settings → Academic → "Archive this semester", then add a course for the same year → the archived enrolments are still there (the data-loss fix).
- [ ] **Rights**: publish a question bank — the rights checkbox is required; a title like "Leaked … exam answers" is refused; a normal "… Past Questions" title publishes.
- [ ] **Moderation**: report a listing/user/message; as admin, resolve it and issue a strike; suspend a test account → it sees the "Account suspended until …" banner (not signed out) and recovers when the suspension lapses.
- [ ] **No leaks**: open a listing you don't own → its response carries no `rights_status` / `takedown_reason` / `appeal_note` (owner-only).

## Rollback
Each migration file ends with a commented rollback block. `170000` and `140000` should be rolled back before the tables/columns they depend on. Prefer a point-in-time restore for anything beyond a single-migration issue.

## After go-live
- Then Phase 2 (creator loop): Study Packs + AI product factory + **creator-side 15% commission (buyer pays list price)** + creator profiles/follows — designed in `docs/phase2-creator-loop-contract.md`, not yet built.

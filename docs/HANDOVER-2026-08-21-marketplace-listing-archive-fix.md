# Handover — Marketplace listing archive-500 fix

**Date:** 2026-08-21
**Branch:** `main` · **HEAD:** `57c0223` (the fix sits **uncommitted** on top — see §5)
**Scope:** DB migration + regression test only. No web/mobile/API-code changes.

Closes the open §4 item from the prior root handover:
_"`DELETE` marketplace listing 500s when the listing has historical inquiry/offer
records + a cancelled order (should archive gracefully) — its own task was in progress."_

---

## 1. The defect

`deleteMarketplaceListingSafely` (`apps/api-server/src/services/supabase.ts:9533`)
does the right thing in three tiers:

| Listing state | Behaviour |
|---|---|
| Any **open** order (paid/pending/etc.) | refuse — **409** |
| Only **terminal** orders (completed/cancelled) | **archive** — `UPDATE … status = 'archived'` (keeps order receipts / payment evidence) |
| **No** orders | hard-delete |

That archive branch (line 9560, shipped in `7baaa77`) writes `status = 'archived'`.
But `marketplace_listings_status_check` was last defined as
`('active','inactive','sold','reserved')` in
`20260731140000_listing_reserved_on_order.sql` and **never widened to include
`'archived'`**. So the archive `UPDATE` violated the check constraint and the
`DELETE` endpoint returned **500** for any listing with a terminal order (the
inquiry/offer rows are incidental — the cancelled/completed order is what forced
the archive path).

A DB-mocked unit test can't catch this: the mock accepts any status. The gap was
purely between the service and the live constraint.

---

## 2. The fix (two files, this session)

1. **New migration** — `supabase/migrations/20260821130000_marketplace_listings_allow_archived.sql`
   Drops and re-adds `marketplace_listings_status_check` as the **full status
   vocabulary the app writes**:
   `('active','inactive','sold','reserved','archived','suspended_by_admin','removed_by_admin')`.
   `'archived'` is a **system-managed terminal state**, set only by the
   delete/archive flow. `PUT /listings/:id/status` still restricts sellers to
   active/inactive/sold, and every browse/search query filters `status = 'active'`,
   so archived/sold/admin-actioned listings drop out of discovery while their
   history is preserved.

   > **Why the two admin statuses are included** (caught by a multi-agent verify
   > pass): `routes/admin.ts` writes `removed_by_admin` (lines 534, 728) and
   > `suspended_by_admin` (line 562) to `marketplace_listings.status`, and the
   > shared type (`packages/shared/src/types/index.ts`) lists both — yet **no**
   > listing CHECK constraint ever included them. A migration that widened only to
   > `'archived'` would therefore (a) **fail its own ADD** if any listing were
   > already admin-removed/suspended, and (b) **break admin moderation** afterward
   > (the next admin remove/suspend UPDATE would violate the new constraint). The
   > constraint is now a true superset of every status any code path persists.

2. **Regression guard** — `apps/api-server/src/services/supabase.listingDelete.test.ts`
   Added a `marketplace_listings status constraint` suite that reads **all**
   migration SQL, extracts the **last** `marketplace_listings_status_check`
   definition (migrations apply in filename order), and asserts it permits every
   status the service writes — including `'archived'`. This is the check a
   DB-mock unit test structurally cannot make; it fails loudly if anyone later
   redefines the constraint without `'archived'`.

**Tests:** `cd apps/api-server && npx jest src/services/supabase.listingDelete.test.ts`
→ **4/4 pass** (the three tier tests + the new constraint guard).
> Note: api-server runs **Jest**, not vitest — `npm test` = `jest`. Running this
> file under `vitest` fails with "describe is not defined" (no globals config);
> that's a wrong-runner artifact, not a real failure.

---

## 3. NOT LIVE until the migration is hand-applied ⚠️

This repo **hand-applies** migrations (Supabase SQL editor) — there is no
auto-migrate step. **The 500 persists in production until `20260821130000` is run.**

Apply the body of
`supabase/migrations/20260821130000_marketplace_listings_allow_archived.sql`
in the Supabase SQL editor for project `tiizkjhbrnaibaagmurl`, then verify:

```sql
-- 1. First confirm no existing row already violates the new set (belt-and-braces
--    — if any admin-actioned rows exist, they are already covered by the superset):
SELECT status, count(*) FROM public.marketplace_listings GROUP BY status;
-- every value returned must be in the 7-item set below.

-- 2. After applying, confirm the constraint:
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'marketplace_listings_status_check';
-- expect: CHECK (status IN ('active','inactive','sold','reserved','archived',
--                           'suspended_by_admin','removed_by_admin'))
```

Then exercise the real path: `DELETE` a listing that has a cancelled/completed
order → expect **200** with `{ outcome: "archived" }`, and confirm the listing
disappears from browse/search but its order rows remain.

The related **FK RESTRICT** migration `20260821120000` was already hand-applied
2026-08-20 (per the prior root handover); this archived-status widening is the
missing companion to it.

---

## 4. Still outstanding (unchanged from prior handover)

- **Chat overhaul → mobile**: live on web, not in released APK `v1.0.26`; needs a
  new build + on-device money-flow verify.
- **Two pre-gate junk jobs postings** need admin removal.
- **Digital study bundles** inert until migration `20260818…` hand-applied.
- Deferred: collaborative-note last-write-wins, folder-assignment corruption,
  imported-content search cap, Anki history chips. `JOB_EMPLOYER_BULK_STATUSES`
  drift. iOS distribution not wired to releases.

---

## 5. State of the tree

```
 M apps/api-server/src/services/supabase.listingDelete.test.ts   (regression guard, full vocabulary)
 M packages/shared/src/types/index.ts                            ('archived' added to listing status union)
?? supabase/migrations/20260821130000_marketplace_listings_allow_archived.sql
```

**Uncommitted.** Per repo rule (§7 of root HANDOVER) I did not commit — do so when
ready with an explicit path add, e.g.:

```bash
cd ~/Desktop/lantern-study
git add supabase/migrations/20260821130000_marketplace_listings_allow_archived.sql \
        apps/api-server/src/services/supabase.listingDelete.test.ts \
        packages/shared/src/types/index.ts
git commit -m "Marketplace: widen listing status constraint to full vocabulary (archive + admin states) so terminal-order deletes and admin moderation don't 500"
```

No web/mobile deploy needed — this is DB + test only. The one required action to
make the fix take effect is hand-applying the migration (§3).

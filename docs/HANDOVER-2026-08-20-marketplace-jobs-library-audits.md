# Handover — 2026-08-20: Jobs, Goods & Library audits shipped, plus 1.0.26 mobile

Everything below is committed on `main` and **pushed**. Deploy state at handover:

- **API → Render: `f5f1e9a`** (`curl -s https://lantern-study-api.onrender.com/health`
  → commit + AI key presence). A later docs/script commit (`2b059b6`) is
  redeploying but changes no API behavior.
- **Web → Cloudflare Pages: `index-DEBeG8J_.js`** (manual deploy — Pages is NOT
  git-connected). Verify by bundle hash on lanternstudy.com, never by the build
  log. `npm run build:web && npx wrangler pages deploy apps/web/dist
  --project-name lantern-study --branch main`.
- **Mobile: 1.0.26 PUBLISHED** — Android APK is live as the GitHub release
  `v1.0.26` and the site's download link now serves it. iOS built for the
  simulator only (no distributable).
- Suites at handover, all green: API **453**, shared **496**, web **51**,
  mobile **53**. Root `tsc` has a large pre-existing baseline — diff the set,
  never chase zero. apps/web BUILD tsc (`noUncheckedIndexedAccess`) is stricter
  than root tsc — see the deploy trap below.

This session ran three full **section audits** (Jobs, Goods, Library), each as a
35-agent map→find→adversarially-verify workflow plus live driving on prod + the
Android emulator, then fanned fixes out to parallel per-file agents. Then it
implemented the deferred backlogs from all three, and cut the 1.0.26 mobile
release. Commit range: `d1cb354..2b059b6` (34 commits). Per-audit detail lives in
memory: [[lantern-study-jobs-audit]], [[lantern-study-goods-audit]],
[[lantern-study-library-audit]].

## Jobs (Explore → Jobs)

26 verified findings fixed. Highlights: a shared **template-boilerplate publish
gate** (`describeJobTemplateLeftovers`) so `Internship — [team / function]` can't
be posted; **deadline enforcement** on cards/detail/API; ATS webhook URL **no
longer leaks** on public payloads + SSRF validation; employer status-update
**whitelist** (withdrawn/interested/chatting are candidate-owned); "interested"
now reads "Application sent"; board mutation failures no longer wipe the list;
stale-fetch guards; a popup-blocked external apply now has a link fallback.
Backlog then shipped: **mobile browse gained the full filter set** (all 8 types +
pay/compensation/location/sort — minPay and closing-sort were unreachable),
mobile employer/company/applicant-profile tools at web parity, applicant-modal
focus trap, unified status timeline + source label, and **web jobs search syncs
to the URL** (`?q=&type=&sort=…`, restores on refresh).

## Goods (Explore → marketplace)

26 verified findings fixed. **Security/data-loss:** only the seller may mark an
inquiry `purchased` (buyers could self-mint verified reviews); DELETE listing no
longer cascade-deletes paid orders (open→409, terminal→archive) — backed by the
**hand-applied** FK RESTRICT migration `20260821120000` (done 2026-08-20);
mass-assignment strip closed a free-boost hole; buy-now/cart/coupon errors return
real 4xx instead of masked 500s. **UX:** new web **Favorites screen**
(favorites were write-only), sold-out CTA gating, honest fees from
`/payments/config`, seller controls on abandoned `pending_payment` orders,
compact listing cards, and a **working condition filter** (routed through the
fallback query — no RPC migration — with `condition` surfaced on the compact
payload for the card chip). Offer expiry is enforced server-side and accepted
offers carry a party-scoped `order {id,status,paymentId}` for Pay-now/View-order.

## Library (Notes + Flashcards)

26 verified findings fixed. The theme was **silent work loss**: Import & Study
generated flashcards/quizzes and saved nothing (three surfaces); quiz regenerate
500'd on a broken jsonb `.eq({})` CAS; offline grades died to dead localStorage
subscriptions AND a head-of-line-blocking sync queue; comments/transcription ate
work. The widest-blast-radius fix: **`isNewFlashcard` no longer misclassifies a
lapsed card as new** (grading Again resets repetitions to 0; it now also requires
no nextReviewDate), so lapsed cards stop dropping out of the review queue. Also:
OCR credit-denial reverts to `needs_ocr` instead of faking progress forever;
Study Hub's "Study N cards" launches real SRS review (was a non-recording quiz);
card-type edits fail loudly; conflict-detecting note autosave (was
last-write-wins); owner-only note folders; imported-note content is searchable
again; `markdownToPreviewText` strips raw markdown from previews. Backlog then
shipped **Anki-style review polish** on both clients: interval preview on each
grade button, undo-last-grade, and an end-of-session summary.

## Mobile 1.0.26 (built + published)

- Version bumped `1.0.25 → 1.0.26` in `apps/mobile/app.config.ts` with a real
  changelog, and the admin **feature registry** entry added (CI gate passes).
- Android APK built locally, zero EAS credits, per
  [[lantern-study-local-android-build]] (Node 20 + JDK 17, Metaspace raise;
  emulator killed first). 77 MB signed, versionCode 75. Installed on the
  emulator and **feature-verified** live (interval previews on the review
  screen). File: `apps/mobile/build-1.0.26.apk` (gitignored).
- **Published** as GitHub release `v1.0.26` in `bjamilk/lantern-study-releases`
  with asset `lantern-study.apk`, marked Latest; source repo tagged `v1.0.26`.
  The home-page download URL
  (`releases/latest/download/lantern-study.apk`) now resolves to it (verified).
- **iOS**: EAS-local needs fastlane (not installed) → built with prebuild +
  `xcodebuild -sdk iphonesimulator` instead. First pass made the **Dev** variant
  (default `APP_VARIANT=development`); rebuilt with `APP_VARIANT=preview` to get
  `com.lanternstudy.app` / "Lantern Study". BUILD SUCCEEDED, installed on the
  iPhone 17 Pro simulator, boots to the sign-in screen (clean prebuild signs the
  sim account out — expected). No distributable IPA (needs the Apple membership).
- New **`scripts/publish-android-release.sh`**: one command to publish a built
  APK — derives the version from app.config, stages the asset with the required
  `lantern-study.apk` name, marks Latest, appends the SHA to the notes, tags the
  source repo, verifies the link flipped, and refuses to double-publish.
  RELEASING.md points at it. This exists because the publish step was skippable
  (1.0.25 never shipped, leaving the download a version behind).

## Traps learned this session — read before shipping

1. **The web build can ship STALE and lie about it.** `apps/web` build is
   `tsc && vite build`; a strict-tsc failure (`noUncheckedIndexedAccess` is on
   in `tsconfig.base.json`) exits non-zero, and `wrangler pages deploy` then
   ships the PREVIOUS dist with "Deployment complete". Turbo can also cache-HIT
   and skip tsc entirely, hiding latent strict errors until a cache miss runs a
   real compile. Root `tsc` and vitest BOTH miss these (root treats them as
   baseline; vitest never typechecks). **Always** confirm `npm run build:web`
   printed `✓ built` with fresh hashes AND that the served bundle hash matches
   `apps/web/dist/index.html`. See [[lantern-study-web-deploy-traps]].
2. **Parallel agents in one working tree will collide.** An agent ran
   `git stash` to get a baseline and wiped every session's uncommitted edits.
   Rule for every delegated agent: NO checkout/restore/stash/clean/reset; commit
   finished slices early by explicit path; and when two agents share a contract,
   put the contract text in BOTH prompts (the store `deckLoadError` contract was
   only in the consumer's brief; the coordinator had to build the producer half).
3. **Measure before "fixing".** Three reported bugs were false alarms confirmed
   by measurement, not code-reading: offer-decline-as-withdrawn (both offer types
   already store `declined` distinctly), goods in-panel sort (already present),
   and the Explore "double-fetch" (dev-only React StrictMode — prod fires exactly
   1 request/mount, measured via `performance.getEntriesByType`). And the
   Aug-4 "Smart Notes deleted by autosave" lead was re-confirmed a false alarm
   (the panel renders from the `summary` field, which autosave never sends).

## Still outstanding

- **Two pre-gate junk postings on the live jobs board**: Ezeobi's
  "Internship — [team / function]" (a test account — needs admin removal) and
  Benjamin's own "Tutor needed for [PHM 101]". The gate blocks new ones; these
  predate it.
- `JOB_EMPLOYER_BULK_STATUSES` in shared still lists `chatting` though the API
  now rejects it (harmless drift).
- Deferred/unverified leads worth their own pass: collaborative note editing is
  whole-body last-write-wins (only conflict DETECTION was added, not merge);
  a report that editor-collaborators can corrupt the owner's folder assignment
  beyond what the owner-only guard covers; search can't find imported content
  past the 2000-char/note cap; grade buttons still lack the compact
  Anki-style history chips beyond the interval number.
- **iOS distribution** is not wired to the releases flow (Android-only). iOS
  ships via TestFlight/EAS with the Apple membership; the 1.0.26 iOS build here
  is simulator-only.

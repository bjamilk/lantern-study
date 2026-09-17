# Flipping `services/` off the facade (step 18, lane M2d)

`routes/` is flipped; 56 production files under `services/` and their suites took
`SupabaseService`. 37 of them are flipped; the other 19 cannot be, and the last
section says why.

## Census — 56 files, 169 facade call sites

Two shapes: a class with a `getXService(svc)` singleton getter (30), and free
functions taking `svc` first (26). Routes reach both through
`dataLayer.legacyService`; suites stub both with a FLAT bare object literal cast
`as any`/`as never`. No services suite uses `jest.spyOn(SupabaseService.prototype,
…)` or `jest.mock('./supabase')` — that pattern lives only in the ~50
`supabase.*.test.ts` suites, which this lane does not touch. So every suite change
is the #89 mock-REGROUP: the same `jest.fn()`s, under the owning namespace.

Facade surface actually used: `getClient` (46 files) plus 38 distinct methods,
**every one already bound in `createDataLayer`** (`createNotification` →
`notifications`, `sign*StorageUrl*` → `storageAcl`, `isPlatformAdmin` → `client`,
…). No domain had to be bound; this lane adds callers only.

## Shape it takes instead

`DataLayer`, injected through the constructor or first parameter it already has,
so `getX(legacyService())` becomes `getX(dataLayer)` and that call site's
`// TRANSITIONAL (M2a|M2b|M2c)` marker deletes itself. A narrower per-domain type
is not worth it: 46 of 56 files need `getClient()`, which is on `DataLayer`
itself. Where a flipped service calls one that cannot flip, it passes
`legacyService` under a `// TRANSITIONAL (M2d)` marker.

## Order — callers before callees, or not at all

A flipped callee can only be reached by a caller that holds a `DataLayer`, so a
service may flip only once EVERY caller of it has flipped. The service→service
graph, with dynamic `await import()` edges included (a plain-import graph lies
here: `academicCourses` reaches `communities` only through a lazy import), gives
three sets. All three shipped in ONE pull request, one commit per set:

| set | files | domains |
| --- | --- | --- |
| 1 | 25 | no `services/` caller at all: jobsBoard (pilot), companion + AI (companionContext, companionImageAttachments, narrationService, presentationPreview, youtubeNote, messageReactions), study (challengeService, concepts, studySets, studyPackFactory, studyPresence), marketplace + money (marketplaceAlerts/Checkout/Courses/FavoriteMilestones, recurringBudget, referrals), accounts + admin (accountImport, adminData, apiKey, campusSummary, dataRetention, examReminders, retentionReminders) |
| 2 | 11 | called only from set 1: classSections, librarySearch, noteOcr, marketplaceAddresses, marketplaceCart, walletService, aiBonusUses, jobAlerts, jobReminders, accountLifecycle |
| 3 | 1 | notePages, whose four callers span sets 1 and 2 |

## The nineteen that cannot flip, and why

`services/supabase.ts` is not only flipped OFF by this lane — it is a CALLER in
it, and it can never hold a layer. Nine services are reached from the facade
side and are therefore frozen until the facade is deleted:

- called by the facade's own inline `deps` literals: `courseTopics`,
  `learningConnections`, `learningEvents`, `marketplaceFavoriteAlerts`,
  `marketplaceOrders`, `marketplaceSellerTools`, `userDataLifecycle`;
- reached through `deps.service` — the `SupabaseService` instance a data module
  is handed — in `data/offlineBundles.ts`, `data/gamification.ts` and
  `data/notes.ts`: `topicMastery`, `activityFeed`.

Ten more sit downstream of those nine or of each other: academicCourses,
communities, studyRooms, communityModeration, adminAudit, creators, moderation,
marketplaceCoupons/Payments/QuestionBanks/StudyPacks. 37 of 56 flipped.

All fifteen `dataLayerHost` deps therefore stay. The eight that delegate to a
`services/` singleton delegate to exactly the seven frozen ones; the other seven
(`legacyService`, the five facade-only bodies, the rating circuit breaker) need
bodies MOVED into `services/data/*`. Both are the facade-deletion lane's work,
not a flip, so a `() => DataLayer` thunk on `createDataLayerHost` would have had
no caller and was taken back out.

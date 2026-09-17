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

## What lane M3 Phase A changed in this picture

The facade-deletion lane starts by removing the reasons the nineteen are
frozen, not by flipping them.

- The five bodies that never left the facade, plus `parseMessageContent`,
  `normalizeOfferRecord` and the two marketplace notification composers, moved
  into `data/mappers.ts`, `data/marketplace.ts` and `data/tests.ts`. The
  rating-column circuit breaker moved as a factory: one breaker per LAYER
  instead of one per facade instance.
- `deps.service` is gone from `data/offlineBundles.ts`, `data/gamification.ts`
  and `data/notes.ts`. The five collaborator calls it existed for are narrow
  arrows the layer builds, each still lazily importing its service when CALLED.
  `data/tests.ts` keeps `service` (it hands the whole facade to
  `recordTestSessionAnswers`); that one goes with the class.
- `dataLayerHost` is down from fifteen deps to seven: `legacyService` and the
  six services that take the facade whole.
- `topicMastery` is FLIPPED (the pilot). It took the facade and used one member
  of it, so it now takes `Pick<DataLayer, 'getClient'>`, which both the layer
  and the facade satisfy — flipped callers pass `dataLayer`, unflipped ones
  keep passing the facade, and nothing moves twice.

### Which of the remaining eighteen can flip the same cheap way

Nine reach ONLY `getClient()` and can take a one-member host today, in any
order: `academicCourses`, `studyRooms`, `communityModeration`, `creators`,
`marketplaceCoupons`, `courseTopics`, `learningConnections`, `learningEvents`,
plus `adminAudit` / `marketplaceFavoriteAlerts` / `userDataLifecycle`, which
reach the facade only to pass it on.

The rest reach namespaced members and therefore need the whole `DataLayer`,
which means every caller of theirs must hold one first: `communities`
(`getAllGroupUnreadCounts`, `isPlatformAdmin`, `listBlockedUserIds`),
`activityFeed` (`listBlockedUserIds`), `moderation` (`createNotification`),
`marketplacePayments`, `marketplaceQuestionBanks`, `marketplaceStudyPacks`,
`marketplaceOrders` and `marketplaceSellerTools`.


## Phase B, PR 1: all nineteen are flipped

No `services/*` module names `SupabaseService` as a value or a parameter type
any more. Three groups, three commits, in the order the dynamic-import-aware
graph allows:

| group | services | host |
| --- | --- | --- |
| leaves | courseTopics, learningConnections, learningEvents, marketplaceCoupons, adminAudit, userDataLifecycle | `DataClientHost` (`Pick<DataLayer, "getClient">`) |
| community | activityFeed, communityModeration, studyRooms, communities, academicCourses | `ActivityFeedHost`, `CommunityModerationHost`, `CommunitiesHost` |
| money | marketplaceOrders, marketplacePayments, marketplaceSellerTools, marketplaceQuestionBanks, marketplaceStudyPacks, marketplaceFavoriteAlerts, moderation, creators | `MarketplaceServiceHost` (+ `ModerationHost`) |

Two rules came out of it.

1. NARROW BEATS `DataLayer`. A host of one to three members per namespace can
   be built by a test as a plain object literal the compiler CHECKS. That is
   how the community suites lost their `as never` casts — and how the compiler
   found three stand-ins that answered no unread-count read at all.
2. A SHARED type where the graph is cyclic. The money services hand their own
   host to each other, so per-service aliases would reference each other in a
   cycle; one `MarketplaceServiceHost` states the union once.

Where a caller still holds the facade — four `deps` arrows inside
`services/supabase.ts` — it goes through a typed adapter
(`feedHostFromFlat`, `marketplaceHostFromFlat`) that regroups the flat spelling
under the namespaces. Never a cast: `data/dataLayer.noAnyCast.test.ts` fails
the build on an `any` over a handle, and that is the shape #92 shipped.

`DataLayerHost` is down to `{ legacyService }`.

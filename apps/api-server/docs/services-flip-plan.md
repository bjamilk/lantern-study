# Flipping `services/` off the facade (step 18, lane M2d)

`routes/` is flipped; 56 production files under `services/` and their suites still
take `SupabaseService`. This is the census, the shape they take instead, and the
order the flip has to happen in.

## Census — 56 files, 169 facade call sites, 2 shapes

| shape | count | how a route reaches it | how its suites stub it |
| --- | --- | --- | --- |
| class + `getXService(svc)` singleton getter | 30 | `getXService(dataLayer.legacyService)` | `new XService({…} as any/never)` — a FLAT bare stand-in |
| free functions taking `svc` first | 26 | `fn(dataLayer.legacyService, …)` | same flat literal passed per call |

No services suite uses `jest.spyOn(SupabaseService.prototype, …)` or
`jest.mock('./supabase')`; that pattern lives only in the ~50 `supabase.*.test.ts`
suites, which this lane does not touch. So every suite change is the #89
mock-REGROUP: the same `jest.fn()`s, moved under the namespace that owns them.

Facade surface actually used: `getClient` (46 files) plus 38 distinct methods.
**Every one of them is already bound in `createDataLayer`** — `createNotification`
→ `notifications`, `sendDirectMessage`/`listBlockedUserIds` → `directMessages`,
`getMarketplaceListingById` → `marketplace`, `getNote*`/`*NoteFile` → `notes`,
`sign*StorageUrl*` → `storageAcl`, `isPlatformAdmin` → `client`, and so on. No new
domain has to be bound; this lane adds callers only.

Heaviest: jobsBoard 14, marketplaceStudyPacks 12, challengeService 11,
marketplaceAlerts 9, marketplaceOrders/QuestionBanks 7, notePages 7.

## Shape it takes instead

`DataLayer`, injected through the constructor/first parameter it already has, so
`getCommunitiesService(legacyService())` becomes `getCommunitiesService(dataLayer)`
and the `// TRANSITIONAL (M2a|M2b|M2c)` markers in `routes/` delete themselves.
A narrower per-domain type is not worth it: 46 of 56 files need `getClient()`,
which is on `DataLayer` itself. Where a flipped service calls a NOT-yet-flipped
one it passes `this.data.legacyService` under a `// TRANSITIONAL (M2d)` marker —
the same escape `routes/` used.

## Order — callers before callees, or not at all

A flipped callee can only be reached by a caller that holds a `DataLayer`, so a
service may flip only once every `services/` caller of it has flipped. The
service→service graph (dynamic `await import()` edges included) gives three
layers, and the PRs are stacked in that order:

| PR | set | files | retires from `dataLayerHost` |
| --- | --- | --- | --- |
| 1 (this) | layer 1: no `services/` caller — jobsBoard (pilot), adminData, studySets, concepts, challengeService, companionContext, narrationService, referrals, marketplaceCheckout/Alerts/Courses/FavoriteAlerts/FavoriteMilestones, … 26 files | 26 | `notifyListingBackAvailable` |
| 2 | layers 2–3: classSections, librarySearch, noteOcr, notePages, topicMastery, walletService, courseTopics, userDataLifecycle, marketplaceCart/Addresses/SellerTools, accountLifecycle, aiBonusUses, jobAlerts, jobReminders | 15 | `resolveTopicForArtefact`, `consumeBoostCredit`, `deleteUserAccountFully`, `exportUserDataArchive` |
| 3 | the mutually-recursive core, which has to move as one: academicCourses, communities, studyRooms, communityModeration, activityFeed, adminAudit, creators, learningEvents, learningConnections, moderation, marketplaceOrders/Payments/Coupons/QuestionBanks/StudyPacks | 15 | `recordLearningConnection`, `createOrderFromBuyNow`, `createOrderFromOfferAccept` |

That is 8 of the 15 host deps. The other 7 — `legacyService` itself, the five
facade-only bodies (`normalizeMessageRecord`, `normalizeListingRecord(Async)`,
`signSimilarListingCards`, `calculateTestScore`, `generateTestQuestions`) and the
per-instance rating circuit breaker — need bodies MOVED into `services/data/*`,
which is a different lane, not a flip.

A lazy `dataLayerHost` wrapper needs the layer it is being built for, so from the
first retirement `createDataLayerHost(service, getLayer)` takes a `() => DataLayer`
thunk `server.ts` satisfies after `createDataLayer` returns.

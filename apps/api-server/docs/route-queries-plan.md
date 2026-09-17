# Raw queries still in route files (lane R2 census)

Re-measured at `0599c45e`, not taken from `data-layer-wiring.md`: **90** `getClient()`
occurrences under `src/routes/**` (non-test). One (`admin/index.ts:62`) is M4 banner prose,
so **89 real sites**: (a) inline query to move **63**, (b) client handed to a service that
takes one by design **15** (`withIdempotency`, `logAIInference`, `companionConversations`,
`hasGroupCommunitySurface` — these stay), (c) RPC **4**, (d) auth-admin **7**.

| route file | a/b/c/d | target module | functions |
| --- | --- | --- | --- |
| `marketplace/offers.ts` | 12/1/1/1 | `data/marketplace.ts` | `expireOffer`, `listOrdersForOffers`, `insertOffer`, `findPendingOffer`, `listOffersForParty`, `getOfferWithListing`, `getOfferById`, `updateOfferStatus`, `listOffersForListing`, `counterOffer` (rpc) |
| `aiCompanion.ts` | 7/4/0/0 | **new `data/aiCompanion.ts`** | DONE (2a): `listConversationMessages`, `listRecentConversationMessages`, `insertConversationMessages(ReturningIds)`, `setMessageFeedback`, `deleteConversation`, `recordAnalyticsEvent` |
| `users.ts` | 4/0/3/1 | `data/users.ts` + `data/budget.ts` | `updateProfile`, `getPushPrefs`, `searchUsers`, `isUsernameAvailable`; its 2 `user_budgets` sites join the budget module |
| `gamification.ts` | 7/1/0/0 | `data/gamification.ts` | DONE (2a): `getUserStreakRow`, `spendStreakFreeze`, `grantStreakFreeze`, `seedDailyQuests`, `listDailyQuests`, `getDailyQuest`, `updateDailyQuestProgress` |
| `budget.ts` | 8/0/0/0 | **new `data/budget.ts`** | DONE (PR 1, the pilot) |
| `marketplace/seller.ts` | 5/1/0/0 | `data/marketplace.ts` | `getSellerProfile`, `listSellerListings`, `listReviewsForListings`, `countFavorites`, `countInquiries` |
| `marketplace/listings.ts` | 4/1/0/0 | `data/marketplace.ts` | `getQuestionBankMeta`, `getStudyPackMeta`, `getBankEntitlement` |
| `marketplace/orders.ts` | 1/2/0/1 | `data/marketplace.ts` | `updateOrderFieldsAsParty(client, orderId, isSeller, userId, patch)` |
| `marketplace/discovery.ts` | 4/0/0/0 | `data/marketplace.ts` | `saved_searches` CRUD ×4 |
| `groups.ts` | 3/1/0/0 | `data/groups.ts` | `countActiveMembers`, `getMembershipRow` |
| `sitemap.ts` | 3/0/0/0 | **new `data/sitemap.ts`** | `listActiveCampusSlugs`, `listActiveListingsForSitemap`, `listActiveJobsAndCompanies` |
| `messages.ts` | 3/0/0/0 | `data/directMessages.ts` + **new `data/messageSearch.ts`** | L242 is ONE client over ~6 queries (the whole search implementation) |
| `tests.ts` | 1/0/0/0 | `data/tests.ts` | `getOwnedTestSession(client, sessionId, userId)` |
| `analytics.ts` | 1/0/0/0 | **new `data/productEvents.ts`** | `insertProductEvents` |
| `notes.ts` 2, `marketplace/cart.ts` 2, `auth.ts` 2, `marketplace/payments.ts` 1, `ai.ts` 1 | 0/4/0/4 | — | (b) and (d) only; nothing to move |

## Test coverage today

Only four of these files have a suite: `marketplace/offers.ts`
(`marketplace.offers.test.ts`, `marketplace.r5aFixes.test.ts` — both already drive the
router through a recording PostgREST double), `aiCompanion.ts` (`.citations`,
`.imageContext`, `.imageAttachments`), `users.ts` (`users.pushTokenStatus`,
`users.presenceHeartbeat`, and `users.budget.test.ts`, which only asserts route
registration and a regex). **`budget.ts`, `gamification.ts`, `sitemap.ts`, `analytics.ts`,
`groups.ts` and `marketplace/{seller,listings,discovery,orders}.ts` have no suite at all** —
for those the query-shape test, written against the untouched route, IS the net.

## PR grouping (4, after the split)

1. **PR 1** — census + pilot `budget.ts`. SHIPPED (#101).
2. **PR 2a** — `aiCompanion` + `gamification` (+ new `data/aiCompanion.ts`). PR 2 was
   split because the coverage rule below makes it too large for one review: 15 of the 19
   route files have no suite, so every handler needs response assertions as well as a
   query trace.
3. **PR 2b** — `users`, `tests`, `analytics`, `sitemap`, `groups`, `messages` search
   (+ `data/sitemap.ts`, `data/productEvents.ts`, `data/messageSearch.ts`).
4. **PR 3** — the marketplace family (offers, seller, listings, orders, discovery): one
   existing module, and the only two route suites that already exist.

## The rules these pull requests follow

- The frozen table inventory keeps its EQUALITY assertion. A table entering the data layer
  rides in the same commit as the query that brings it, with a one-line comment naming the
  route it came from.
- Every unscoped lookup — a query by row id with no owner predicate — is named in the pull
  request body, with the reason it is safe where it is called.
- For a handler with no existing suite, the recording-double test written BEFORE the move
  asserts the response (status and body) for the happy path and for the denied /
  not-found path, as well as the query trace.
- An ownership predicate is a REQUIRED parameter of the data function, never optional.
- (d) auth-admin sites move too, as typed functions in `data/users.ts`; the four Paystack
  buyer-email lookups share one `getAuthUserEmail(client, userId)`. (b) hand-offs stay.

## Finding: nine tables the frozen inventory has never seen

`supabase.tableInventory.test.ts` scans `services/data/**` only, so a table queried solely
from a route is absent from its frozen 57 — and it asserts set EQUALITY, so each move fails
it until the table is added: `user_budgets`, `ai_companion_messages`,
`ai_companion_conversations`, `ai_analytics`, `daily_quests`, `product_events`,
`job_postings`, `companies`, `marketplace_question_banks`, `marketplace_study_packs`.
`user_budgets` landed with PR 1; `ai_analytics`, `ai_companion_conversations`,
`ai_companion_messages` and `daily_quests` with PR 2a. The inventory is at 62.
No table is being ADDED to the product; each was always queried, just not from a scanned
directory. Each is added in the commit that moves its query, with the reason in the
message — an inventory-only commit is red either way, since the assertion is equality.

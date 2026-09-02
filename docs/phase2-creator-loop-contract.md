# Phase 2 — Creator loop: Study Packs, AI Study Product Factory, fee model, creator profiles + follows, buyer library: implementation contract

Status: **queued** (written 2026-08-22 while Phase 1 E-client slices finish). Parent plan: `docs/PLAN-2026-08-22-knowledge-network.md` §4 G–K. Builds on Phase 1 (courses/`course_id` everywhere, `learning_events`, moderation/attestation, library overview).

**Decisions applied (override any of these and the builders re-target):**
- **D1 fee model → configuration, not a fork.** Three env knobs resolved in `packages/shared/src/marketplace/fees.ts`: `MARKETPLACE_SERVICE_FEE_BPS` (buyer surcharge on *physical* listings; stays 500), `MARKETPLACE_DIGITAL_BUYER_FEE_BPS` (buyer surcharge on digital listings; **default 0** — students pay list price), `MARKETPLACE_CREATOR_FEE_BPS` (platform commission taken from the creator's payout on digital listings; **default 1500** = 15 %). Physical listings keep today's maths exactly. Changing the split is a Render env edit.
  - *Superseded 2026-09-02:* physical listings moved to the same shape as digital — the buyer pays the list price, and a fourth knob `MARKETPLACE_PHYSICAL_COMMISSION_BPS` (**default 500** = 5 %) is taken from the seller's payout. `MARKETPLACE_SERVICE_FEE_BPS` now **defaults to 0**; setting it adds a buyer surcharge *on top of* the commission, so leave it unset.
- **D5** Study Pack = new `listing_kind = 'study_pack'` (not a sub-kind of question banks). **D6** content stays per-buyer JSON (the question-bank model); revisit if a pack approaches 2 MB. **D7** public creator profile shows university/programme/level, bio, packs, rating, learners helped, followers — **never earnings**. **D8** Verified v1 = confirmed email + active payout profile; v2/v3 later.

## 1. G — Study Pack product

### 1a. Migration `20260823120000_study_packs.sql` (after `20260822160000`)
```sql
-- listing_kind gains 'study_pack'
ALTER TABLE public.marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_listing_kind_check;
ALTER TABLE public.marketplace_listings ADD CONSTRAINT marketplace_listings_listing_kind_check
  CHECK (listing_kind IN ('single','bundle','question_bank','study_pack'));

CREATE TABLE IF NOT EXISTS public.marketplace_study_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL UNIQUE REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  published_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  source_note_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  content jsonb NOT NULL,            -- { guide: { markdown, toc: [{title, anchor}] }, summaries: [{title, markdown}], flashcards: [{front, back, type?, tags?}], questions: [...question_data shape...], weakSections: [{title, reason}] }
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { guideWords, summaries, flashcards, questions }
  cover_url text,
  rights_attested_at timestamptz, rights_attestation_version text,
  ai_assisted boolean NOT NULL DEFAULT false, sources_cited jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: service_role only (content is the paid product).
-- Entitlements: REUSE marketplace_question_bank_entitlements (keys listing_id,user_id) —
ALTER TABLE public.marketplace_question_bank_entitlements
  ADD COLUMN IF NOT EXISTS delivered_refs jsonb NOT NULL DEFAULT '{}'::jsonb;  -- { bundleId, deckId, noteId, version }
-- Money RPCs: re-create marketplace_create_buy_now_order and marketplace_release_escrow from their CURRENT
-- definitions (20260818120000 for buy-now; 20260822121000 for release_escrow — keep its status predicates)
-- replacing every `listing_kind = 'question_bank'` test with `listing_kind IN ('question_bank','study_pack')`.
```

### 1b. API (module `apps/api-server/src/services/marketplaceStudyPacks.ts`, mirroring `marketplaceQuestionBanks.ts`)
| Route | Behaviour |
|---|---|
| `POST /marketplace/study-packs/publish` `{ title, description, price, campusId, location?, courseId?, content, attestation: true, aiAssisted?, sourcesCited?, draftId? }` | Validates content (≥1 of guide/summaries/flashcards/questions; ≤ 1000 questions, ≤ 1000 cards, ≤ 2 MB); paid → active payout profile required (`assertSellerCanReceivePayout`); creates listing (`listing_kind 'study_pack'`, category `'study_pack'`, `fulfillment_mode 'digital'`, rights fields) + pack row; returns `{ listingId, packId, version }`. When `draftId` is given, copies content/classification from `study_pack_drafts` and marks the draft `published`. |
| `GET /marketplace/listings/:id/study-pack/preview` (optionalAuth) | `{ title, counts, toc, summaryPreview (first summary, ≤ 600 chars), flashcardFronts (≤ 5), questions (3, answer-stripped via the existing allow-list sanitiser), owned, isSeller, version }`. |
| `POST /marketplace/listings/:id/study-pack/download` (free or owned) | Delivery (`deliverStudyPack`): questions → `offline_bundles` row `bundle_id = 'pack-<listingId>'` (upsert; deterministic like `qbank-`); flashcards → `importDeck` **once** (store `delivered_refs.deckId`; on update-pull: replace the deck's cards in place — add `replaceDeckCards(deckId, cards)` to the service); guide/summaries → one note **once** (`delivered_refs.noteId`; title = pack title, body = guide markdown + summaries, `source_type 'import'`, `course_id`); update-pull rewrites the note body. `grantEntitlement` idempotent. |
| `POST /marketplace/study-packs/restore`, `GET /marketplace/study-packs/mine`, `GET /marketplace/study-packs/updates`, `POST /marketplace/study-packs/:id/update-content` `{ content, attestation: true, ... }` | Same semantics as the question-bank equivalents (restore re-materialises all refs; updates = version > `version_at_download`; update-content bumps version with optimistic lock and re-requires attestation). |
| `GET /marketplace/listings/:id/full` | adds `studyPack: { counts, version, owned }` like `questionBank`. |
| `GET /marketplace/purchases` (auth) | Unified buyer library: `[{ listingId, kind: 'question_bank'|'study_pack', title, sellerId, sellerName, version, versionAtDownload, updateAvailable, deliveredRefs, courseId, purchasedAt }]` from entitlements joined to listings. |
| Guards | offer creation blocked for digital kinds (extend the existing question-bank block), cart add/checkout rejects digital kinds server-side (`marketplaceCart.ts` — today only the clients hide it), `isDigitalListingKind(kind)` helper in shared `marketplace/lifecycle.ts`. Every literal `listing_kind === 'question_bank'` in the API (isQuestionBankListing, /full, offer block, fulfilment) becomes a digital-kind check that dispatches to the right service. |
| "Sell this deck" / "Sell this note" | thin entry points: `POST /marketplace/study-packs/publish` with content built client-side from a deck export (`GET /decks/:id/export`) or a note (body + attachments' extracted text as guide); no new server routes. |

### 1c. Clients
Publish flows (web `components/marketplace/PublishStudyPackModal.tsx`, mobile `settings/PublishStudyPackModal.tsx`) reuse the question-bank modal's title/price/campus/course/attestation/update-mode UX; entry points: Library (course row → "Create a study pack from this course"), NoteEditor ("Sell this note"), DeckDetail ("Sell this deck"), AI factory drafts (§2). Listing detail shows the pack preview (TOC, first summary, sample cards/questions) and the digital CTA bar (Buy → Paystack; Free → Download; Owned → Open in Library / Update available). Buyer: purchased packs appear in Library under their course (B overview counts `pack-` alongside `qbank-`), and in a **Purchases** screen (web + mobile) backed by `GET /marketplace/purchases` with Update buttons (mobile finally gets update-pull for question banks too). Category constants on both clients gain `study_pack` (and the listings RPC `p_include_custom`/category lists must include it).

## 2. H — AI Study Product Factory
- Migration (same file as 1a or `20260823121000_study_pack_drafts.sql`): `study_pack_drafts(id, user_id FK, source_note_ids jsonb, folder_id uuid, course_id uuid, status text CHECK IN ('queued','generating','ready','failed','published'), content jsonb, counts jsonb, suggested_title text, suggested_price_kobo integer, classification jsonb {courseCode, level, semester, institutionId}, error text, job_id text, created_at, updated_at)`; RLS owner select, service_role all.
- `POST /ai/study-pack/draft` `{ noteIds?: uuid[] (≤ 12), folderId?, courseId?, title? }` behind `aiRateLimitWithCost(5)` (ONE charge) → creates the draft `queued` and enqueues a BullMQ job `ai.studyPack.generate` (reuse the queue processors pattern) which runs server-side: resolve note content (+ attachments' extracted text) → `summarizeNoteContent` (deep) per source → guide assembly (markdown with TOC anchors) → `generateFlashcardsFromNotes` (≤ 60) → `generateQuestionsFromNotes` (≤ 40 MCQ + new **essay** variant ≤ 5 with a marking rubric — add `kind: 'essay'` support to the question generator prompt/parser and to the question_data shape) → weak-section flagging (sections whose summary is short/low-confidence) → `generateListingDescription` → classification from `user_courses`/note `course_id` → price suggestion = median active `study_pack` price for the same course (else same institution, else by counts: ₦500 + ₦5/card + ₦10/question, capped ₦5,000) → status `ready`; on any failure status `failed` + `error`, and the charge is refunded via the existing 202-job refund hook. `GET /ai/study-pack/drafts`, `GET /ai/study-pack/drafts/:id`, `DELETE /ai/study-pack/drafts/:id`; `POST /marketplace/study-packs/publish { draftId, price, ... }`.
- Clients: "Turn this into a Study Product" on note, folder, course (Library) → Drafts screen (list + status polling via the existing job status endpoint) → Review draft (editable title/description/price, toggle sections) → Publish (the Study Pack modal pre-filled). Credits: show "Uses 5 AI credits" before starting; the AI usage badge updates from the 202 body.

## 3. I — Fee model + payouts
- `packages/shared/src/marketplace/fees.ts`: `resolveMarketplaceFees({ listingKind, itemAmountKobo, env })` → `{ buyerFeeBps, creatorFeeBps, buyerFeeKobo, platformFeeKobo, sellerPayoutKobo, totalChargedKobo }` with the three env knobs; keep `computeMarketplaceCheckoutFees` as a thin wrapper for physical; tests.
- Migration `20260823122000_marketplace_payments_split.sql`: `marketplace_payments` + `platform_fee_kobo integer NOT NULL DEFAULT 0`, `seller_payout_kobo integer` (backfill = `item_amount_kobo`; then `NOT NULL`), replace `marketplace_payments_total_matches` with `total_charged_kobo = item_amount_kobo + service_fee_kobo AND seller_payout_kobo + platform_fee_kobo = item_amount_kobo`.
- API: `createBuyNowCheckoutSession` uses the resolver by listing kind; `transferSellerPayout` amount = `seller_payout_kobo`; refund paths (`refundPaymentForOrder`, dispute refunds) refund `total_charged_kobo` to the buyer and never the platform fee twice; `payoutOnConfirmReceived`/`forcePayoutForOrder` read `seller_payout_kobo`; `/payments/config` returns `{ paystackEnabled, serviceFeeBps, digitalBuyerFeeBps, creatorFeeBps }`; **new** `GET /marketplace/seller/payments?page` → `[{ orderId, listingId, title, itemAmountKobo, platformFeeKobo, sellerPayoutKobo, status, paidAt, payoutAt }]` (the seller ledger that doesn't exist today).
- Clients: buyer checkout shows the real total from config by kind ("You pay ₦2,000"); publish modals show "You receive ₦1,700 · Lantern fee 15 %" live as the price changes; seller Earnings/Payments tab (web SellerInsightsDrawer + mobile SellerInsightsModal) lists the ledger with payout status.

## 4. J — Creator profiles, follows, creator_stats, Verified v1
- Migration `20260823123000_creators.sql`: `profile_follows(follower_id, followee_id, created_at, PK(follower_id, followee_id), CHECK follower<>followee)` + index on followee + RLS owner-side (mirror `user_blocks`); `profiles.bio text` (≤ 280), `profiles.email_confirmed_at timestamptz`, `profiles.verification_level smallint NOT NULL DEFAULT 0`; `creator_stats(user_id PK, active_packs, packs_total, learners_helped, completed_orders, disputed_orders, review_count, avg_rating, five_star_count, follower_count, following_count, points, current_streak, longest_streak, active_days_90, account_age_days, trust_score, trust_level text, refreshed_at)` + SQL function `refresh_creator_stats(p_user_id uuid)` (service role) computing from marketplace_listings (study_pack/question_bank kinds), marketplace_question_bank_entitlements (distinct buyers per seller), marketplace_orders, marketplace_reviews⨝listings, profile_follows, profiles.points, user_streaks, study_activity. Trust score 0–100 per plan §4 N weights (verified +20/+15, longevity, log(completed), −10/lost dispute, reviews) → `trust_level new|rising|trusted|verified`.
- API: `POST/DELETE /users/:userId/follow` (respects `user_blocks` both ways, 403 if blocked), `GET /users/:userId/followers|following?page` (visibility-gated), `GET /creators/:userId` → `{ id, username, name, avatarUrl, bio, institution, programme, studyLevel, stats: { activePacks, learnersHelped, avgRating, reviewCount, followerCount }, isFollowing, isVerified, trustLevel, packs: [listing cards (study_pack + question_bank, active)] }` (owner also gets `followingCount`, never earnings), `GET /creators/discover?institutionId&courseId&limit` (ranked by learners_helped then rating), `PUT /users/:id` accepts `bio`; sync `email_confirmed_at` on `GET /users/me` (via `auth.admin.getUserById`, cached 1h) and set `verification_level = 2 if payout active, 1 if email confirmed`; refresh `creator_stats` on: pack publish, entitlement grant, order completion, review insert, follow/unfollow (debounced: enqueue a BullMQ job `creators.refreshStats`). Notifications: `new_follower`, `creator_new_pack` (fan-out to followers, batched ≤ 500, push-whitelisted).
- Clients: **Creator profile** screen (web + mobile) = today's SellerProfileScreen extended: academic line, bio, Follow/Unfollow, stats tiles, packs grid, Verified badge (`isVerified`), trust level chip; reachable from listing detail seller row, search results, group member rows. "Edit bio" in profile settings. Followers/Following lists. Keep SEC-08: no earnings.

## 5. K — Buyer library parity (folds into G)
`GET /marketplace/purchases` + Purchases screen on web (replaces the Offline-Mode-only view) and mobile (adds update-pull for question banks and packs); Library tree counts include `pack-` bundles.

## 6. Order of work & gates
G-api (migration + service + routes + guards + tests) → then in parallel: G-clients (web, mobile), H (api + worker, then clients), I (shared + migration + api + clients), J-api → J-clients. Every slice: API `tsc` + jest (baseline 98 suites), root `npm run build`, mobile `tsc` 0 errors, shared jest; migrations hand-applied in timestamp order; no git stash/checkout; no commits unless asked. Adversarial review workflow after G+I land (money paths) and again after J.

# Lantern Study — Software Documentation

**Audience.** A new engineer who needs to be productive this week, and a founder who
needs to know what exists without reading code. Sections 1, 2, 6 and 9 are written to
be read by anyone; sections 3, 4, 5, 7 and 8 assume you will open the files they name.

**Scope.** The whole product as it stands at commit `e2fa40f4` (mobile version 1.0.60).
Paths are given relative to the repository root and are cited without line numbers, so
they survive edits.

**Reading order if you have one hour.** §1 (10 min) → §2 (20 min) → §3 (15 min) → §7
(10 min) → skim §8 and §9 (5 min). Come back for §4, §5 and §6 when you need them.

---

## Table of contents

1. [What Lantern Study is, and who uses it](#1-what-lantern-study-is-and-who-uses-it)
2. [Feature map](#2-feature-map)
3. [Architecture](#3-architecture)
4. [Data model](#4-data-model)
5. [The API surface](#5-the-api-surface)
6. [Integrations and environments](#6-integrations-and-environments)
7. [How to run, test and ship](#7-how-to-run-test-and-ship)
8. [Runbooks](#8-runbooks)
9. [Glossary](#9-glossary)

---

## 1. What Lantern Study is, and who uses it

Lantern Study is a study app for university students, built first for Nigerian
campuses. It does three things that usually live in three separate products:

1. **It is where you study.** Your course materials go in — lecture notes, recordings,
   PDFs, slides, a YouTube lecture — and come back out as things you can actually
   revise from: readable notes, flashcards on a spaced-repetition schedule, quizzes,
   practice tests, and a step-by-step plan through a syllabus. An AI companion called
   **Lantern** sits alongside all of it and can explain, quiz you, or walk you through
   a topic one step at a time.
2. **It is where your coursemates are.** Group chats, direct messages, campus
   communities with channels and boards, study rooms with live presence, and a
   knowledge graph that quietly notices who is studying what so it can suggest people
   and groups worth joining.
3. **It is campus life around the studying.** A budget tracker for student money, a
   jobs board for campus and graduate work, and a marketplace where students sell
   physical items hand-to-hand and — the part the business is built on — sell
   **digital study materials** (question banks and study packs) to each other, paid
   through Paystack.

### Who uses it

| Who | What they do | How they get in |
|---|---|---|
| **Student** (the overwhelming majority) | Studies, chats, buys and sells | Android app, or the web app at `lanternstudy.com` |
| **Creator** | A student who publishes question banks / study packs for money | Same accounts, plus a seller payout profile |
| **Instructor** | Runs a class: roster, materials, assignments, analytics | Web "Teach" surface |
| **Institution staff** | Institution-level analytics across classes | Web, staff-gated |
| **Platform admin** | Moderation queues, user management, AI quota, analytics | Web admin console, gated on `platform_admins` |

### The commitments the code keeps

These are not style preferences. They are enforced in shared code and are cited
throughout this document because they explain why things are built the way they are.

- **Studying is free, forever.** The money comes from the marketplace, not from
  charging students to revise.
- **Never lie to a student.** A feature that is not built is labelled "later", not
  hidden. A section with nothing in it is omitted, not rendered as a row of zeroes. A
  source chip that cannot be resolved is dropped rather than shown as a dead link. A
  price shown before checkout is the price charged.
- **Never lose a student's work.** Work done offline is queued durably, per account,
  and replayed. A dropped connection must never be treated as a revoked session, and a
  sign-out must never wipe another account's unsynced work.
- **Both platforms say the same thing.** Anything web and mobile must agree on lives in
  `packages/shared`, so the two cannot drift.

---

## 2. Feature map

Each area below gives: what it does, where the code lives, what it costs the student in
AI credits, and the honesty rule that governs it.

**About AI credits.** A student gets a daily allowance of AI uses (default 20,
`AI_DAILY_LIMIT`), resetting at 00:00 UTC, plus a durable bonus pool earned through
referrals. Costs are defined once in `packages/shared/src/utils/aiCredits.ts` and read
by both the server and the clients, so the price quoted in the UI is the price charged.
Most actions cost **1 use**; the exceptions are noted per area. A queued AI job that
fails **refunds the credit automatically** — the client must never refund or re-charge.
Anything not marked with a cost is free.

### 2.1 Home

The landing surface on both platforms, and a single shared spine so a student who
learns Home on the phone already knows Home in the browser. It shows what to resume:
cards due for review, an inline review card, recent activities (decks, tests, lecture
notes, companion threads), quick actions, progress, daily quests and an upcoming exam.
It is fed by one roll-up request, `GET /api/v1/dashboard/summary`, rather than a dozen.

| | |
|---|---|
| Shared | `packages/shared/src/dashboard/homeSections.ts` — regions, order, quick actions, the recent-activities feed |
| Web | `components/DashboardScreen.tsx`, `components/dashboard/*` |
| Mobile | `apps/mobile/src/screens/dashboard/`, `apps/mobile/src/components/dashboard/` |
| API | `apps/api-server/src/routes/dashboard.ts` |
| Cost | Free |

**Honesty rule.** `homeRegions` returns only regions that have real content. An empty
Home is a true statement; a Home full of zeroes is not.

### 2.2 Study sets and the set room

A **study set** is the container for one subject's work. Filing it under a course is
optional. Inside the set room every tool is a nested path (`/study/sets/:id/notes`,
`/cards`, `/quiz`, `/plan`…) so Back, refresh and Home-resume all land back inside the
set instead of bouncing to a list.

| | |
|---|---|
| Shared | `packages/shared/src/learning/courseWorkspace.ts` (activities, Turn-into targets), `learning/studySetRoutes.ts` (the URL vocabulary — build and parse are inverses), `study/setPresentation.ts` (tile hue/glyph derived by hash from the set id, plus count chips) |
| Web | `components/StudyHubScreen.tsx`, `components/study/*` |
| Mobile | `apps/mobile/src/screens/study/`, `apps/mobile/src/components/study/` |
| API | `apps/api-server/src/routes/studySets.ts` |
| Cost | Free to create and organise. "Turn into" conversions cost 1 use each (cost shown before you tap, from `TURN_INTO_COST`) |

**Honesty rule.** Activities that are not built yet carry status `later` and are shown
as such — visible roadmap, never a dead button. Tile colours are derived from the set
id, identically on both platforms; a set that is peach on the phone and lilac in the
browser is a different object to the student.

### 2.3 Plan

The syllabus, drawn as a timeline: one rail, units on it, topics inside. Topics are
tri-state — **unseen → covered → mastered** — and progress is always derived from the
rows, never stored separately, so it cannot disagree with them. Exactly one topic row
carries the "Continue" pill. Each unit shows a `Sources:` row naming the materials its
topics were generated from.

| | |
|---|---|
| Shared | `packages/shared/src/learning/studySetPlan.ts` (progress, recommendation, modes), `study/planTimeline.ts` (the rail, per-row state, tap targets), `study/unitSources.ts` (provenance chips) |
| Web | `components/study/StudySetPlanPanel.tsx`, `StudyPlanTimeline.tsx`, `StudyCalendar.tsx` |
| Mobile | `apps/mobile/src/components/study/StudyPlanPanel.tsx`, `screens/study/StudyCalendarScreen.tsx` |
| API | `apps/api-server/src/routes/studySets.ts` (plan get/put, topic progress) |
| Cost | Generating a plan costs 1 use; reading and updating it is free |

**Honesty rule.** A source chip is rendered **only** if the id resolves to a real title
in the materials the caller holds — `source_note_ids` is a `uuid[]` that Postgres
cannot foreign-key, so deleted notes leave dangling ids behind. An unresolvable id
produces nothing. Because callers pass filtered lists, the row is not an inventory,
which is why the label is `Sources:` and never "Built from" or "all of".

### 2.4 Notes, lectures and PDFs

The ingestion surface — where raw material becomes study material.

- **Notes** are stored as a light markdown subset and parsed into typed blocks so
  headings read as headings on both platforms.
- **Lecture recording** captures audio (with a lock-screen player and a foreground
  service on Android) and transcribes it.
- **PDFs, slide decks and photos** are uploaded and OCR'd into a note.
- **YouTube** lectures can be imported by transcript.
- **Smart Notes** rewrites a body at a chosen depth.

| | |
|---|---|
| Shared | `packages/shared/src/utils/noteBlocks.ts` (block parsing, marker stripping, previews), `notes/*` |
| Web | `components/NotesScreen.tsx`, `NoteEditorScreen.tsx`, `NotePdfViewer.tsx`, `SmartNoteCompose.tsx`, `components/narration/*` |
| Mobile | `apps/mobile/src/screens/notes/`, `components/lecture/*`, native module `apps/mobile/modules/lecture-recording-service` |
| API | `apps/api-server/src/routes/notes.ts` (the largest route module in the product) |
| Cost | Smart Notes: **1 use** (concise/standard), **3 uses** (deep). Note OCR: **2 uses**. Lecture transcription: **1 use per 15 minutes** recorded or part thereof, clamped at 3 hours. Summaries, quizzes and flashcards generated from a note: 1 use each |

**Honesty rule.** Machine markers (Smart Notes sentinels, the lesson snapshot fence,
any HTML comment) are stripped before **anything** a student sees, previews included. A
leaked sentinel is internal state rendered as content.

### 2.5 Flashcards and FSRS

Decks of cards, scheduled by FSRS (a modern spaced-repetition algorithm). Cards can be
basic, cloze, or image-occlusion. Review, cram and learn are distinct session types.
Reviews work offline and sync later.

| | |
|---|---|
| Shared | `packages/shared/src/flashcards/*` — the scheduler and the plain-language labels for *again / hard / good / easy*, identical on both platforms |
| Web | `components/FlashcardsScreen.tsx`, `DeckDetailScreen.tsx`, `FlashcardReviewScreen.tsx`, `CramSessionScreen.tsx` |
| Mobile | `apps/mobile/src/screens/flashcards/` |
| API | `apps/api-server/src/routes/decks.ts`, `routes/flashcards.ts` |
| Cost | Manual cards free. AI generation: **1 use** per generation |

**Honesty rule.** Flashcard reviews are *events*, not state: the offline queue must
never dedupe them by card id. Reviewing one card twice offline once synced as a single
review, silently discarding real work — see `EVENT_ENTITY_TYPES` in
`packages/shared/src/sync/index.ts`. Generated decks are created with their cards in
one atomic call (`createDeckWithCards`) so a crash mid-generation cannot strand an
empty deck.

### 2.6 Tests and quizzes

Personal tests, adaptive quizzes, and exam mode with a lock. Attempts are resumable: an
attempt's answered state is tri-state (unseen / seen / locked) and the resume point is
*derived*, never stored, so both of mobile's two start paths land in the same place.

| | |
|---|---|
| Shared | `packages/shared/src/api/endpoints.ts` (tests section), question-stat eligibility filter |
| Web | `components/TestBuilderScreen.tsx`, `TestTakingScreen.tsx`, `TestReviewScreen.tsx`, `utils/testAttempt.ts` |
| Mobile | `apps/mobile/src/screens/tests/`, `screens/study/AdaptiveQuizScreen.tsx` |
| API | `apps/api-server/src/routes/tests.ts`, `routes/user-stats.ts` |
| Cost | Manual tests free. AI question generation: **1 use** |

**Honesty rule.** Only eligible question ids feed long-term statistics
(`isQuestionStatEligible`); ad-hoc and generated questions must not pollute mastery.

### 2.7 Lantern — the AI companion

Lantern is a persistent companion, not a chat box. Four modes: **Explain**, **Quiz me**,
**Socratic**, and **Guided**.

**Guided mode** is a multi-turn lesson with real state — the topic, the step number, and
the outstanding check question — that must survive a remount, a Fast Refresh and a
process death. That state machine is pure, shared and unit-tested so the two platforms
cannot disagree about what "step 3 of this lesson" means. The goal picker offers to
*continue* an open lesson above starting a new one.

**Photos** can be attached to a message for the model to read.

| | |
|---|---|
| Shared | `packages/shared/src/api/companion.ts` — modes, the Guided state machine, the goal picker, citation and error normalisation, and the transport |
| Web | `components/AICompanionPanel.tsx`, `components/companion/*` |
| Mobile | `apps/mobile/src/components/AICompanionPanel.tsx`, `components/companion/*` |
| API | `apps/api-server/src/routes/aiCompanion.ts`, `routes/ai.ts` |
| Cost | **One turn, one use — Guided included.** That promise is shown to the student as `GUIDED_COST_NOTE` and the billing honours it. History, conversations, feedback and analytics are free |

**Honesty rule.** Citations from the model arrive untrusted and loosely shaped; one that
does not normalise cleanly is dropped, because a citation a student cannot open implies
a grounding that is not there. Remaining-use headers are parsed off every response so
the credit badge is always the server's number, never a local guess.

### 2.8 Library

The student's archive of everything they have kept, organised as years → courses →
topics, with cross-artefact search. It is a *view* over existing tables (notes, decks,
tests, bundles all carry a `course_id`) rather than its own storage.

| | |
|---|---|
| Web | `components/LibraryScreen.tsx`, `components/library/*`, `utils/libraryArchive.ts` |
| Mobile | `apps/mobile/src/screens/library/`, `components/library/*` |
| API | `apps/api-server/src/routes/library.ts` (`GET /overview`, `GET /search`) |
| Cost | Free |

### 2.9 Chat, groups and communities

Three distinct surfaces that share a transport:

- **Direct messages** — one-to-one threads, addressed by the pair of users. Marketplace
  inquiries ride on DM threads.
- **Groups** — study groups with membership, admins, invites, pins and read receipts.
- **Communities** — campus-scale, Discord-shaped: channels, boards (post/answer), a
  lounge, roles, mutes, invites, live presence, and temporary study rooms.

Realtime delivery is a Supabase subscription owned by each app; the REST calls are the
durable path and the backfill after a reconnect.

| | |
|---|---|
| Shared | `packages/shared/src/chat/*` (reaction normalisation), `network/*` (communities, discovery, presence, feed) |
| Web | `components/ChatWindow.tsx`, `components/chat/*`, `components/community/*`, `CommunityDetailScreen.tsx` |
| Mobile | `apps/mobile/src/screens/groups/`, `screens/discover/`, `components/chat/*`, `components/board/*` |
| API | `apps/api-server/src/routes/messages.ts`, `routes/groups.ts`, `routes/communities.ts`, `routes/studyRooms.ts`, `routes/feed.ts` |
| Cost | Free. Summarising a group chat with AI costs **1 use** |

**Honesty rule.** A campus that has not been switched on returns `NOT_ENABLED` and the
UI says *"Not switched on for this campus yet"* — a state, not an error. Photo and audio
attachments are **signed on read and never stored as URLs**; chat and board photos once
died after 24 hours because a signed URL had been frozen into a database row.

### 2.10 Campus — Budget

A monthly budget with categories, transactions, recurring items, savings goals, expense
splitting and a study wallet. Money-shaped but entirely local to the student: no
payment processor is involved, so a bad write costs a wrong number, not a wrong charge.

| | |
|---|---|
| Web | `components/BudgetTrackerScreen.tsx` and the budget modals, `stores/budgetStore.ts` |
| Mobile | `apps/mobile/src/screens/budget/` (reached under the **Me** tab, not Campus) |
| API | `apps/api-server/src/routes/budget.ts`; wallet writes go through `wallet_adjust_balance` / `wallet_award_once` database functions, not direct client writes |
| Cost | Free |

### 2.11 Campus — Jobs

Campus and graduate job postings, applications with resumes, employer-side company
profiles, screening questions, interviews and offers.

| | |
|---|---|
| Shared | `packages/shared/src/jobs/*` |
| Web | `components/JobsBoardScreen.tsx`, `JobDetailScreen.tsx`, `JobEmployerPipelineScreen.tsx`, `components/jobs/*` |
| Mobile | `apps/mobile/src/screens/marketplace/Job*.tsx`, `components/jobs/*` |
| API | `apps/api-server/src/routes/jobsBoard.ts` |
| Cost | Free. AI-assisted posting description: **1 use** |

**Honesty rule.** Deadlines are enforced server-side. A client whose cached copy still
looks open must not accept an application for a closed posting.

### 2.12 Campus — Marketplace and Shop (Paystack)

Two economies under one Amazon-shaped shell:

- **Hand-over goods** — physical items sold student-to-student, handed over in person.
- **Digital goods** — question banks and study packs. This is the business. A purchase
  grants an entitlement; downloading checks it. Restores after a reinstall re-grant what
  was already paid for and never charge twice.

Around them: browse by department, favourites, inquiries, offers and counter-offers,
cart, addresses, orders, coupons, reviews with helpful votes, seller analytics,
campaigns, boosts, and a creator discovery surface.

**The fee model (since 2026-09-02).** The hand-over fee is **inside the price**. The
buyer pays the list price; Lantern's 5% comes out of the seller's payout, so the seller
receives 95%. A fee is never added on top at checkout. Digital goods carry a platform
creator fee (default 15%) with no buyer surcharge.

| | |
|---|---|
| Shared | `packages/shared/src/marketplace/fees.ts` — **the single calculator**, imported by web, mobile *and* the API so the quoted price and the charged price cannot diverge. All amounts are integer kobo; fees are basis points |
| Web | `components/MarketplaceScreen.tsx` and ~25 sibling screens, `components/marketplace/*` |
| Mobile | `apps/mobile/src/screens/marketplace/` |
| API | `apps/api-server/src/routes/marketplace.ts`, `routes/creators.ts`, `routes/paystackWebhook.ts` |
| Cost | Free to browse, list and buy (money is money, not AI credits). AI listing description: **1 use**. Study-pack generation: **1 use** |

**Honesty rules.** The webhook — not the client's verify call — is the source of truth
for a completed charge. Going live as a seller is gated on a payout profile. The
marketplace is open to every student (2026-09-15); the founder-only private-pilot
allowlist that used to sit in front of it has been removed, along with the
`MARKETPLACE_PUBLIC` / `MARKETPLACE_ALLOWED_USER_IDS` env vars that drove it.

### 2.13 Progress and gamification

Points, badges, levels, streaks (with freezes), daily quests, challenges between
students, activity heatmaps, mastery graphs and exam readiness.

| | |
|---|---|
| Web | `gamification.ts`, `components/me/*`, `components/DailyQuestsWidget.tsx`, `MasteryPanel.tsx` |
| Mobile | `apps/mobile/src/screens/me/`, `screens/games/`, `components/me/*` |
| API | `apps/api-server/src/routes/gamification.ts`, `routes/challenges.ts`, `routes/feed.ts` (mastery) |
| Cost | Free |

**Honesty rule.** The client never mints its own points. It asks the server to award
them and re-reads. All writes go through `record_study_activity` / `record_deck_study`
database functions. A locally-incremented counter the server disagrees with is how a
student watches their streak run backwards.

### 2.14 Settings, appearance and accents

Theme (light / dark / system), accent colour from presets or a free picker, font size
and family, reduced motion, high contrast, compact density, haptics, screen-reader
optimisations, daily goals and reminders, academic identity, and account lifecycle.

| | |
|---|---|
| Shared | `packages/shared/src/settings/appearanceEffects.ts` (settings → concrete numbers and colours), `settings/userSettings.ts`, `design/tokens.ts`, `design/contrast.ts` |
| Web | `components/SettingsModal.tsx`, `utils/applyDesignTokens.ts`, `utils/applyUserSettingsToDom.ts`, `index.css` |
| Mobile | `apps/mobile/src/screens/settings/`, `src/theme/` |
| API | `apps/api-server/src/routes/preferences.ts`, `routes/users.ts` |
| Cost | Free |

**Honesty rules.** A student may pick an accent that is illegible on the surfaces
Lantern paints it on, so every derived colour is run through WCAG contrast *repair*
before use — the choice is honoured as closely as legibility allows, never at the cost
of readable text. And `reduceMotion` must only ever remove the animation, never the
state change the animation was carrying; decoupling the two once left elements stuck
mid-transition.

---

## 3. Architecture

### 3.1 The three apps and the shared package

```
lantern-study/
├── (repo root)          ← the WEB app's actual source lives here
│   App.tsx, index.tsx, components/, hooks/, stores/, services/, utils/, functions/
├── apps/
│   ├── web/             ← build harness only (vite.config.ts, scripts, vitest suites)
│   ├── mobile/          ← Expo / React Native app
│   └── api-server/      ← Express API + BullMQ worker
├── packages/
│   └── shared/          ← @lantern/shared — everything two runtimes must agree on
└── supabase/migrations/ ← 207 hand-applied SQL migrations
```

> **The single most surprising structural fact.** `apps/web` is a *build harness*, not
> the web app. `apps/web/vite.config.ts` sets `root` to the repository root, so the web
> app's components, hooks, stores and services are the top-level directories. If you go
> looking for `apps/web/src/components`, you will find only test files.

| Workspace | What it is | Stack |
|---|---|---|
| `@lantern/web` | Web app + Cloudflare Pages Functions | React 19, Vite 6, Tailwind, react-router (6 real routes; the rest is a hand-written path↔mode mapper in `utils/appRoutes.ts`) |
| `@lantern/mobile` | Android app (and an iOS simulator build) | Expo SDK 54, React Native 0.81.5, **React Navigation 7** (not expo-router), NativeWind, Legacy Architecture with Reanimated 3.19.5 |
| `@lantern/api-server` | REST API and background worker | Express, TypeScript, Supabase service-role client, BullMQ, Redis |
| `@lantern/shared` | The agreement layer | Pure TypeScript, no platform imports, consumed **built** |

**`packages/shared` is consumed BUILT.** It compiles to `dist/` via `npm run build`.
Edit a file there and typecheck web/mobile/api without rebuilding, and you are testing
the previous version. This is the single most common false bug report in the project.
Its export map is documented in `packages/shared/src/index.ts`.

### 3.2 The request path

Two different paths, deliberately.

**Web — cookie BFF.** The browser never holds a refresh token.

```
browser  ──► lanternstudy.com/api/*        (Cloudflare Pages Function)
             functions/api/[[path]].ts      ← proxies to Render, rewrites Set-Cookie
                    │                          SameSite=None → SameSite=Lax
                    ▼
             lantern-study-api.onrender.com/api/*     (Express)
                    │
                    ▼
             Supabase (PostgREST + Storage + Auth), via the SERVICE ROLE
```

The Supabase session is held in **memory only** on the client
(`services/authCookieSession.ts`), with the literal placeholder string
`'cookie-managed'` where a refresh token would be. The real refresh token lives in an
httpOnly cookie and is exchanged through `POST /api/v1/auth/refresh`. A `global.fetch`
interceptor on the Supabase client catches gotrue's internal refresh attempts with that
placeholder and reroutes them to the BFF — see §8.5, this is load-bearing.

**Mobile — direct Supabase plus the API.** Bearer tokens from a Supabase session
persisted in `expo-secure-store`. Realtime and some reads go straight to Supabase; the
rest goes to the same Express API. No BFF, no cookies.

**Both** funnel API calls through one shared client,
`packages/shared/src/api/client.ts`, which owns the base URL, the auth handshake, the
401 refresh-and-retry, and the translation of a failure into an error a student can
read. Its `refreshAuth` is deliberately **tri-state** — `true` / `false` /
`'transient'` — because a boolean cannot distinguish "the session was revoked" from
"the auth server was unreachable", and collapsing the two is what signed students out on
every flaky connection.

### 3.3 Background jobs

Enabled only when `BULLMQ_ENABLED=true` **and** `REDIS_URL` is set; otherwise the work
runs inline in the request (`runSyncOrEnqueue`).

| Queue | Carries | Concurrency env |
|---|---|---|
| `ai-generation` | Question/flashcard/lesson/recap/essay generation, explain, tutor, companion messages, note summarise/quiz/narration, study-pack generation | `AI_WORKER_CONCURRENCY` (default 2) |
| `file-processing` | APKG import, presentation preview, YouTube transcript, OCR extraction | `FILE_WORKER_CONCURRENCY` (default 1) |
| `data-export` | Full user-data export | `EXPORT_WORKER_CONCURRENCY` (default 1) |
| `marketplace-alerts` | All repeatable crons (data retention 03:00, marketplace/job alerts and reminders every 15 min, study reminders every 4 h, exam reminders hourly, weekly summary Mondays 08:00) | 1 |

- Worker entrypoint: `apps/api-server/src/worker.ts` (`npm run worker`), deployed as a
  separate Render service.
- Enqueue and routing: `apps/api-server/src/queue/enqueue.ts`, `queue/jobs/types.ts`.
- **Job status** is a durable record in Redis (`queue/jobStatus.ts`), read by clients at
  `GET /api/v1/jobs/:jobId` (`routes/jobs.ts`). The record's `stage`, monotonic
  `percent`, `status`, `resultRef` and `charge` fields are a client contract.
- **Credit refund.** A queued call answers **202**, which is a 2xx, so the rate-limit
  middleware's own auto-refund never fires for async work. Instead
  `refundJobCreditOnce` claims a single-flight Redis key and returns the credit to the
  pool that paid for it (daily or bonus); `refundChargeOnFinalFailure` covers stalled
  and crashed jobs via the worker's `failed` hook. Both are idempotent, so overlap is
  harmless.

### 3.4 Realtime

Supabase Realtime subscriptions, owned by the apps rather than the shared package. Used
for chat messages, board posts, presence and typing indicators. Mobile multiplexes
through `apps/mobile/src/services/sharedRealtimeChannel.ts`. A dropped membership must
invalidate the subscription as well as the cached rows — a stale subscription on a group
you have left is a privacy problem, not a cosmetic one.

### 3.5 Offline

Two independent systems:

1. **The sync queue** — `packages/shared/src/sync/`. Durable local operations replayed
   when the connection returns. Four rules that must not be softened:
   - Operations are stored **per user**, under `lantern_sync_queue:<userId>`. One
     shared key meant the next student to sign in on a shared handset replayed the
     previous student's work under their own session.
   - **Events are not deduped.** Flashcard reviews and test results are each
     individually meaningful.
   - **Transient errors must rethrow**, not return `false` — a `false` burns one of the
     operation's three retries against a connection that is not there.
   - Nothing is dropped silently; unreplayable operations land in `failedOperations`
     where the UI can surface them.
2. **Offline bundles and pending results** — downloadable study content plus per-user
   pending test results (`apps/mobile/src/stores/offlineStore.ts`,
   `stores/pendingResultsScope.ts`).

### 3.6 Deep links

`lanternstudy://` and `https://lanternstudy.com/*`, verified on Android via
`public/.well-known/assetlinks.json` and on iOS via associated domains. Two cooperating
resolvers on mobile by design: `apps/mobile/src/navigation/linking.ts` (React
Navigation's config, handles cold starts and OS-delivered URLs) and
`navigation/deepLinkTargets.ts` (a pure, node-testable resolver used for
notification taps). Path parsing for study sets is shared with the web router via
`packages/shared/src/learning/studySetRoutes.ts`.

---

## 4. Data model

**208 migrations** in `supabase/migrations`, named `YYYYMMDDHHMMSS_snake_case.sql`. The
real sequence starts at `20251117020518_initial_schema.sql` (one out-of-sequence outlier,
`20250116000000_ai_companion_improvements.sql`, predates it) and currently ends at
`20260915110000_paystack_webhook_two_phase.sql`. Roughly 150 tables and 386 policies. This section is an inventory, not a schema dump — open the migrations for
columns.

> **Migrations are hand-applied.** Merging a migration does not run it. Neither
> Cloudflare Pages nor Render applies SQL. **SQL first, push second** — the API writes
> new columns unconditionally with no missing-column fallback.

### 4.1 Table inventory

| Area | Tables | Ownership / RLS shape |
|---|---|---|
| Identity | `profiles`, `user_preferences`, `platform_admins`, `institution_staff`, `user_api_keys`, `user_blocks`, `profile_follows` | Self-owned (`auth.uid() = id` / `= user_id`). Profile reads are narrowed by `profile_visible_to_viewer`, with column-level grants hiding `rights_*`, `moderation_flags` and suspension fields from clients |
| Academic | `courses`, `course_topics`, `user_courses`, `class_sections`, `class_members`, `class_invites`, `class_materials`, `class_assignments`, `class_assignment_progress` | Catalogue tables: broad authenticated read, service-role write. Class tables: membership-gated through `class_members` |
| Study content | `study_sets`, `study_set_units`, `study_set_topics`, `study_set_folders`, `notes`, `note_folders`, `note_attachments`, `note_comments`, `note_collaborators`, `note_quizzes`, `note_share_links`, `narration_scripts`, `youtube_transcripts`, `offline_bundles`, `study_sessions`, `study_presence` | Owner-first, plus a collaborator branch via `is_note_collaborator()` / `can_read_note()`. `youtube_transcripts` and `study_presence` are service-role caches (RLS on, no policies) |
| Flashcards / FSRS | `decks`, `flashcards`, `deck_collaborators`, `deck_studiers`, `flashcard_comments`, `user_question_stats`, `question_votes` | Owner + collaborator. **SRS state is `flashcards.srs_data` JSONB on the card row** — there is no separate review log, and scheduling lives in app code. `freeze_deck_owner()` / `freeze_note_owner()` triggers stop an editor collaborator stealing ownership |
| Tests | `test_sessions`, `test_results`, `test_session_drafts` | Strictly `auth.uid() = user_id` |
| AI / credits | `ai_companion_conversations`, `ai_companion_messages`, `companion_image_attachments`, `ai_inference_log`, `ai_analytics`, `ai_bonus_grants`, `ai_bonus_uses` | Conversations owner-scoped; logs and analytics service-role only. **Credits are not a wallet**: the daily allowance is Redis/in-memory, only the referral-earned bonus pool is durable, mutated solely by `ai_bonus_grant` / `_spend` / `_refund` |
| Library | *(no tables)* | A view over `course_id` columns on notes/decks/tests/bundles |
| Chat | `groups`, `group_members`, `messages`, `message_reactions`, `message_bookmarks`, `dm_threads`, `dm_messages`, `dm_read_status`, `chat_mutes`, `communities`, `community_members`, `community_invites` | Membership-gated via `is_group_member()` (a SECURITY DEFINER helper introduced to break RLS recursion). Group admin via `groups.admin_ids`. Boards are `messages` thread roots; a lounge is a `groups` row pointed at by `communities.lounge_group_id` |
| Budget | `budgets`, `user_budgets`, `transactions`, `budget_transactions`, `budget_recurring_transactions` | `auth.uid() = user_id`; direct wallet writes revoked in favour of `wallet_adjust_balance` / `wallet_award_once` |
| Jobs | `job_postings`, `job_applications`, `job_applicant_profiles`, `job_companies`, `job_company_members`, `job_screening_questions`, `job_interviews`, `job_offers`, `job_favorites`, `job_reports`, plus view/click counters | Postings public-read / poster-write; applicant tables applicant-owned; employer tables gated by `is_job_company_member()`. Counters service-role only |
| Marketplace | `marketplace_listings`, `_favorites`, `_inquiries`, `_offers`, `_cart_items`, `_checkouts`, `_orders`, `_payments`, `_transactions`, `_reviews`, `_review_votes`, `_reports`, `_coupons`, `_addresses`, `_seller_payout_profiles`, `_seller_preferences`, `_question_banks`, `_question_bank_entitlements`, `_study_packs`, `study_pack_drafts`, `creators`, `paystack_webhook_events` | **The money path is service-role only by design.** Client INSERT/UPDATE/DELETE on listings is revoked; `marketplace_payments`, `paystack_webhook_events`, question banks and study packs have RLS enabled with **no policies at all**, so PostgREST with the anon key sees nothing. Orders and offers mutate only through SECURITY DEFINER functions |
| Network | `concepts`, `concept_links`, `learning_events`, `learning_connections`, `user_topic_mastery`, `referrals`, `activity_events`, `product_events` | Concepts authenticated-read. Aggregates are service-role, refreshed by `refresh_user_topic_mastery` and friends. `referrals` is select-own with a `protect_referral_fields()` trigger doing all writes |
| Moderation | `content_reports`, `moderation_strikes`, `admin_audit_log`, `chat_message_audit`, plus `rights_*` / `takedown_*` columns on listings | Service-role only by design — reports go through `POST /api/v1/reports`, never a direct insert |
| Gamification | `user_streaks`, `daily_quests`, `group_challenges`, `challenge_participants`, `study_activity`, `creator_stats` | Read-own; writes only via `record_study_activity` / `record_deck_study` |
| Notifications | `notifications`, `retention_reminders_sent`, `job_reminders_sent`, `api_idempotency_keys`, `profiles.expo_push_token` | Read/update-own, inserted by service role. Dedup tables service-role only |

### 4.2 RLS patterns

- **Owner predicate** dominates: `auth.uid() = user_id` (68 uses), `= seller_id` (16),
  `= buyer_id` (8), `= id` on `profiles` (5).
- **Membership subqueries** for groups, communities, classes, companies, collaborators.
  Where a policy on a table queried that same table it recursed, so those are now
  SECURITY DEFINER helpers: `is_group_member`, `is_note_collaborator`, `can_read_note`,
  `is_job_company_member`, `profile_visible_to_viewer`.
- **Service-role bypass is the deliberate design** for money, moderation, analytics and
  counters: RLS on, zero policies, so all access goes through the API's service-role
  client and the *route* decides what a caller may see. On a public endpoint this means
  the route is the only access control — there is no RLS backstop.
- **Service-role detection inside functions** is `auth.uid() IS NULL` (the API has no
  JWT subject). GoTrue and FK cascades are exempted via `session_user` and
  `pg_trigger_depth()`.
- ~80 functions, mostly SECURITY DEFINER with `SET search_path = public`, `REVOKE ALL
  FROM PUBLIC` and a targeted `GRANT EXECUTE`.

### 4.3 Storage buckets and signing

Nine buckets. Three were public and were flipped private in
`20260711180000_private_storage_buckets_signed_urls.sql`.

| Bucket | Visibility | Notes |
|---|---|---|
| `question-images` | private | was public |
| `marketplace-images` | private | was public |
| `flashcard-images` | private | was public |
| `note-files` | private | also hosts chat uploads |
| `profile-avatars` | private | |
| `group-avatars` | private | |
| `cover-images` | private | created by the service role on first upload — no migration, so it must be listed in `PRIVATE_STORAGE_BUCKETS` or every signed-URL request is denied |
| `job-resumes` | private | 5 MB, PDF/DOC/DOCX only |
| `job-company-logos` | **public** | 2 MB, images |

Owner scoping is by the first path segment: `(storage.foldername(name))[1] =
auth.uid()::text`. Direct client INSERT is denied.

**Signing happens in exactly one place** — the API's service-role client,
`apps/api-server/src/services/supabase.ts`, exposed as `POST
/api/v1/storage/signed-urls` (up to 40 refs per request), TTL clamped by
`STORAGE_SIGNED_URL_MAX_TTL` (24 h). Requests are coalesced by
`packages/shared/src/utils/signedUrlBatch.ts` and cached per-app.

> **The rule: sign on read, never store a signed URL.** Rows hold a bucket + path
> *reference*. A display URL is minted at render and thrown away. A URL frozen into a
> row expires within 24 hours — this is exactly how chat and board photos went blank.
> `packages/shared/src/utils/storageUrl.ts` holds the bucket list, ref parsing and the
> `.thumb.webp` derivation.

---

## 5. The API surface

Base URL `https://lantern-study-api.onrender.com`, all product routes under
`/api/v1`. Everything is assembled in **`apps/api-server/src/server.ts`**.

### 5.1 Middleware order

Order matters; this is the actual sequence.

| # | Middleware | Note |
|---|---|---|
| 1 | `helmet` | CSP, HSTS one year with preload |
| 2 | `cors` | Per-request origin decision. A missing Origin is *not* blanket-allowed; only a non-cookie credential earns credentialed access with no Origin, and never on a cookie-setting path |
| 3 | `compression` | |
| 4 | `loadShedMiddleware` | 503 + Retry-After above `LOAD_SHED_HEAP_RATIO` / `LOAD_SHED_RSS_BYTES` |
| 5 | JSON body parser | **Dispatched by path.** Paystack webhook 1 MB with raw-body capture for HMAC; large uploads 50 MB; notes/AI uploads 35 MB; avatars 4 MB; everything else 1 MB |
| 6 | `urlencoded` | 1 MB |
| 7 | `cookieParser` | |
| 8 | `csrfProtectionMiddleware` | |
| 9 | `morgan` | |
| 10 | request timeout | 30 s default, skipped for long-running notes/AI paths |
| 11 | request id | sets `X-Request-ID` |
| 12 | `/` health routes | **no auth** |
| 13 | anonymous IP rate limit | Paystack webhooks bypass |
| 14 | `sanitizationMiddleware` | after the limiter on purpose — body-walking is expensive |
| 15 | `validateBodyShape` | same reasoning |
| 16 | route mounts | see below |
| 17 | `notFoundHandler`, Sentry, database/Supabase/general error handlers | |

### 5.2 Route mounts

`apps/api-server/src/routes/`. Registration order matters (Express first-match) — note
that `/users/me/courses` and `/users/me/study-sets` mount *before* `/users` so that
`me` is not captured as a `:userId`.

| Mount | Module | Mount-time middleware |
|---|---|---|
| `/` | `health.ts` | none |
| `/api/v1/users/me/courses` | `userCourses.ts` | |
| `/api/v1/users/me/study-sets` | `studySets.ts` | |
| `/api/v1/users` | `users.ts` | |
| `/api/v1/courses/:courseId/topics` | `courseTopics.ts` | before `/courses` |
| `/api/v1/courses` | `courses.ts` | |
| `/api/v1/concepts`, `/library`, `/creators`, `/communities`, `/study-rooms`, `/classes`, `/schools` | `concepts.ts`, `library.ts`, `creators.ts`, `communities.ts`, `studyRooms.ts`, `classes.ts`, `schools.ts` | |
| `/api/v1` | `institutionStaff.ts` | mounted bare |
| `/api/v1/discover` | `communities.ts` → `discoverRouter` | |
| `/api/v1/feed`, `/mastery` | `feed.ts` (+ `masteryRouter`) | |
| `/api/v1/referrals` | `referrals.ts` | |
| `/api/v1/campuses` | `campuses.ts` | optional auth, public rate limits |
| `/api/v1/reports`, `/auth`, `/storage` | `reports.ts`, `auth.ts`, `storage.ts` | |
| `/api/v1/jobs` | `jobs.ts` | **async job status — not the jobs board** |
| `/api/v1/jobs-board` | `jobsBoard.ts` | optional auth, access gate, public rate limits |
| `/api/v1/budget`, `/contact`, `/analytics` | `budget.ts`, `contact.ts`, `analytics.ts` | |
| `/api/v1/groups` | `groups.ts` | optional auth, public rate limits |
| `/api/v1/messages`, `/notifications`, `/tests`, `/gamification`, `/decks`, `/flashcards`, `/user-stats`, `/dashboard`, `/preferences` | respective modules | |
| `/api/v1/marketplace` | `marketplace.ts` | optional auth, access gate, geo, public rate limits |
| `/webhooks/paystack` **and** `/api/v1/webhooks/paystack` | `paystackWebhook.ts` | same router, two mounts |
| `/api/v1/sitemap`, `/api-keys` | `sitemap.ts`, `apiKeys.ts` | |
| `/api/v1/ai` then `/api/v1/ai/companion` | `ai.ts`, `aiCompanion.ts` | order matters |
| `/api/v1/notes`, `/challenges`, `/offline-bundles` | respective modules | |
| `/api/v1/admin` | `admin.ts` | **auth + `requirePlatformAdmin` + admin rate limit, at the mount** |

### 5.3 Auth modes

`apps/api-server/src/middleware/auth.ts` resolves a credential in this precedence:

1. **`X-API-Key`** — personal API keys (`lsk_` prefix), permissions from the key
   (default read-only). Failed validation is itself rate-limited.
2. **`Authorization: Bearer <jwt>`** — a Supabase JWT. Verified results are cached by
   SHA-256 token hash in an LRU (20,000 entries, 15 s TTL).
3. **Auth cookie** — the web BFF path.

Every authenticated request then passes four guards: token denylist, session cutoff
(tokens issued before a user's revoke point), banned/suspended, and deactivated.
Resource-level authorisation is separate (`middleware/authorizeResource.ts`:
`requireGroupMember`, `requireDeckAccess`, `requireNoteAccess`, …).

### 5.4 Rate limits

Built lazily, Redis-backed when available. Default window 15 minutes. Production values
shown; dev values are far higher.

| Limiter | Window | Prod max | Scope |
|---|---|---|---|
| Anonymous IP | 15 min | 300 | IP |
| Public read | 15 min | 120 | IP |
| Public write | 15 min | 10 | IP |
| Authenticated | 15 min | 1200 | user |
| API-key auth failures | 15 min | 20 | IP |
| Login (composite / IP / email) | 15 min | 10 / 30 / 10 | mixed |
| AI POST burst | 60 s | 15 | user |
| Upload burst | 60 s | 10 | user |
| Storage burst | 60 s | 30 | user |
| Admin | 60 s | 300 | user |
| Data export | 24 h | **1** | user |
| Contact form | 60 min | 5 | IP |

A signed-in caller on a public route gets the authenticated limit rather than the IP
cap (`middleware/publicRateLimitMiddleware.ts`).

**AI quotas** are separate and accounted in `middleware/aiRateLimit.ts`: a global daily
allowance plus per-feature daily caps (companion 75, generate_questions 15,
generate_flashcards 15, explain 40, …), reserved atomically in Redis and rolled back on
overshoot, drawing from the daily pool then the banked bonus pool. Remaining balances
ride back on `X-AI-Cost` and `X-AI-Bonus-Remaining` response headers.

### 5.5 Idempotency

`middleware/idempotency.ts` attaches `req.runIdempotent`, backed by a Supabase-stored
key claim (`claim_idempotency_lock`). Clients send an `Idempotency-Key` header; the
shared endpoint map sends one on creation and money routes.

> **Known defect (tracked, marked in the code).** Several money endpoints in
> `packages/shared/src/api/endpoints.ts` fall back to a *random* default key when the
> caller passes none — `buyNowListing`, `checkoutMarketplaceCart`,
> `createMarketplaceOffer`, `boostListing`, and the budget writes. A random key makes
> the header decorative: a user-initiated retry generates a fresh key, so the server
> cannot recognise it as the same intent and can charge twice. Keys must be derived
> from the intent and held stable across retries, the way `createDeckWithCards` derives
> its key from the job id.

### 5.6 Other request-shaping middleware

- **CSRF** (`middleware/csrf.ts`) — requires `X-Requested-With: LanternStudy` on
  mutating methods whenever an auth cookie is present, and *unconditionally* on the
  session routes. A cross-site form POST cannot set that header, and adding it forces a
  preflight the CORS allowlist rejects.
- **Body shape** (`middleware/validateBody.ts`) — max keys and depth per path (default
  100 / 8; tests 20,000 / 14; offline bundles and digital goods 50,000 / 14), plus
  prototype-pollution key stripping.
- **Sanitisation** (`middleware/security.ts`) — truncate first, then strip script tags
  by a linear index walk (both the greedy and lazy regexes were quadratic), with a
  256 KB total regex-scan budget and base64 payload keys exempt.

---

## 6. Integrations and environments

**No secret values appear in this document or in the repository.** Secrets are listed by
name, with where each one is set.

### 6.1 Where things run

| Piece | Where | Deploys on |
|---|---|---|
| Web app | Cloudflare Pages, project `lantern-study`, at `lanternstudy.com` | Push to `main` → GitHub Actions `deploy-web.yml` → `wrangler pages deploy` |
| Pages Functions (BFF, bot prerender, sitemaps) | Same Pages deployment, from `functions/` | Same |
| API | Render web service `lantern-study-api` (Docker, Oregon, free plan) | Render's own git integration on push to `main` — **independent of GitHub Actions** |
| Worker | Render worker `lantern-study-worker` (same Dockerfile, starter plan) | Same |
| Gotenberg (document conversion) | Render web service `lantern-study-gotenberg` | Blueprint |
| Database, Auth, Storage, Realtime | Supabase (project ref `tiizkjhbrnaibaagmurl`) | **Migrations are hand-applied** |
| Android app | EAS Build → GitHub releases repo `bjamilk/lantern-study-releases` | Manual (§7.3) |

### 6.2 Secrets by name and location

| Where it lives | Names |
|---|---|
| **Render** — API and worker services, dashboard env (`sync: false` in `render.yaml`) | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `REDIS_URL`, `JWT_SECRET`, `GROQ_API_KEY`, `FIREWORKS_API_KEY`, `GEMINI_API_KEY`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `HF_API_TOKEN`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `MARKETPLACE_PAYSTACK_CHECKOUT`, `RESEND_API_KEY`, `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`, `SENTRY_DSN`, `OPERATIONAL_ACCESS_TOKEN`, `EXPORT_SIGNING_SECRET`, `SUPADATA_API_KEY` |
| **Render** — non-secret config, in `render.yaml` | `NODE_ENV`, `PORT`, `ALLOWED_ORIGINS`, `REDIS_ENABLED`, `BULLMQ_ENABLED`, `AI_DAILY_LIMIT`, `MARKETPLACE_*_BPS`, `GOTENBERG_URL`, the rate-limit and body-size knobs |
| **GitHub** — repository secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| **GitHub** — repository variables (baked into the web bundle at build; public by nature) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_SENTRY_DSN` |
| **EAS** — build profile env in `apps/mobile/eas.json` / Expo project secrets | Supabase URL + anon key and the API URL, surfaced through `app.config.ts` `extra` |
| **Local only**, never committed | `apps/mobile/.env` (gitignored — and therefore *absent from what EAS builds from*), `.claude/settings.local.json` |

> The Supabase **anon key** is public by design and is allowlisted in
> `scripts/check-secrets.sh`. The **service-role key** is not, and must never reach a
> client bundle.

### 6.3 AI provider cascade

`apps/api-server/src/services/aiService.ts`. Tried in order, falling through on failure
or exhaustion:

**Groq → Fireworks → Gemini → Cloudflare Workers AI → HuggingFace** (→ a mock provider,
dev and test only).

Each provider has a daily counter that resets at midnight UTC and is synced across
instances through Redis, plus an in-process cooldown after an upstream 429 so a
map-reduce does not thrash one provider. `options.preferredProvider` gives sticky
routing across the chunks of one job. Gemini's key also backs handwriting OCR.

> **`/health` reports which providers are actually keyed.** Declaring a key in
> `render.yaml` is not setting it. Poll `/health` before advertising an AI feature as
> live — this has been wrong before.

### 6.4 Other integrations

| Service | Used for | Key names |
|---|---|---|
| **Paystack** | Marketplace checkout and payouts (Nigeria). Webhook verified by HMAC-SHA512 over the raw body at `POST /webhooks/paystack` | `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `MARKETPLACE_PAYSTACK_CHECKOUT` |
| **Sentry** | Error monitoring, all three apps. The "Unexpected sign-out" event is a deliberate regression alarm | `SENTRY_DSN` (API), `VITE_SENTRY_DSN` (web), mobile DSN via `@sentry/react-native` |
| **Cloudflare Turnstile** | Bot protection on the contact form and sensitive writes. Enforced only when **both** the secret and the hostname list are set | `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES` |
| **Resend** | Transactional email and alerts | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ALERTS_FROM_EMAIL`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL` |
| **Gotenberg** | Office/PDF conversion for note ingestion | `GOTENBERG_URL` |
| **Expo / EAS** | Mobile builds, OTA channel, push notifications | EAS project `2e6076dd-b213-42d0-a966-3a15e3f9cb33` |

---

## 7. How to run, test and ship

Node is pinned: **v20** (mobile requires `>=20.19.4 <21`).

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

### 7.1 Run

```bash
# always first, after any change under packages/shared
cd packages/shared && npm run build

npm run dev:web      # Vite at :5173, proxying /__lantern_api to the deployed API
npm run dev:api      # nodemon + ts-node
npm run dev:mobile   # Expo
```

The API cannot reach real data locally (service-role credentials are the founder's to
supply) but **will boot** for middleware and routing work:

```bash
cd apps/api-server
PORT=3011 NODE_ENV=development TS_NODE_TRANSPILE_ONLY=true \
  SUPABASE_URL=http://127.0.0.1:55421 SUPABASE_SERVICE_ROLE_KEY=dummy \
  JWT_SECRET=dummy npx ts-node --transpile-only src/server.ts
```

`--transpile-only` is required (plain `ts-node` dies on pre-existing type errors in
`src/services/noteFiles.ts`). `NODE_ENV=production` will not boot locally — it
hard-requires a reachable Redis.

### 7.2 The gates

Run the gate for the tree you touched. **Build shared first** or you are testing a
stale `dist/`.

| Workspace | Commands |
|---|---|
| `packages/shared` | `npm run build` then `npx jest` — currently **165 suites, 2097 tests** |
| Web | `cd apps/web && npm run typecheck && npx vitest run` |
| Mobile | `cd apps/mobile && npx tsc --noEmit && npx jest` — tsc is **0 errors**, not 55 |
| API | `cd apps/api-server && npx tsc --noEmit && npx jest` |
| Whole repo | `npm run build`, `npm run test`, `npm run typecheck`, `npm run lint` (turbo; note `packages/shared` has no `lint` script) |
| Design | `npm run design:contrast` — checks what `index.css` actually ships against the tokens |

**Two false gates to know about.**

- **Root `tsc` is not a gate.** Use `npm run build` for web.
- **Mobile jest matches only `**/*.test.ts`**, not `.tsx`. A `.tsx` suite is silently
  never run.

### 7.3 Ship

**Web** — merge to `main`. `deploy-web.yml` builds with the production `VITE_*`
variables, verifies the bundle points at production Supabase, and deploys to Pages.

**API and worker** — merge to `main`. Render's git integration redeploys. Confirm which
build is live by polling the commit marker:

```bash
curl -s https://lantern-study-api.onrender.com/health
# {"status":"ok","commit":"e2fa40f","ai":{...}}
```

Deploys take roughly 5–12 minutes. **Pushing a second commit while one is building
restarts the build** — batch commits when waiting.

**Migrations** — hand-applied in the Supabase SQL editor, **before** the deploy that
needs them. Verify with `~/lantern-handover/sql/VERIFY-MIGRATIONS.sql`
(`to_regclass` / `to_regprocedure`), not by probing with the anon key: once a migration
changes grants, a column probe returns "permission denied" whether or not the column
exists, and a wrong column name reads as a missing migration.

**Migrations with an unconfirmed or outstanding status** (from the repository's own
handover docs, which contradict each other in places — the only ground truth is a probe):

| Migration | Status per the docs |
|---|---|
| `20260824125000_communities_select_grant.sql` | **Outstanding.** Until applied, two `communities` RLS policies are dead code. Not deploy-blocking |
| `20260824126000_drop_notes_view_count.sql` | Outstanding, not deploy-blocking |
| `20260817120000_admin_search_users_by_email.sql` | Never confirmed applied; route falls back to an older scan |
| `20260821120000_marketplace_orders_listing_fk_restrict.sql` | Conflicting reports |
| `20260828160000_marketplace_ratings_and_review_votes.sql` | Unrecorded. Self-documented to degrade gracefully (no stars, sort falls back to newest) |
| `20260829170000_community_lounges.sql` | Unrecorded |
| Everything dated after `20260901` (~20 files, through `20260915110000`) | **No recorded application status anywhere in the repo** — this includes the RLS ownership hardening |

**Android release** — the website's download button is a *version-agnostic* link
(`https://github.com/bjamilk/lantern-study-releases/releases/latest/download/lantern-study.apk`,
hardcoded in `components/marketing/LandingPage.tsx`), so publishing a release is the
whole deploy; no web change is ever needed. In order:

1. Bump `version` in `apps/mobile/app.config.ts`. It is the OTA runtime fence
   (`runtimeVersion.policy: appVersion`); `versionCode` auto-increments.
2. Write `apps/mobile/RELEASE-<version>.md`.
3. **Add a `PRODUCT_FEATURES` entry in `components/admin/productFeatures.ts`.** CI job
   `feature-registry` fails any push that changes the version without touching this
   file. Use `[skip registry]` in the commit message for a bump that ships nothing
   user-visible. It diffs *committed* state, so verify after committing:
   `node scripts/check-feature-registry.mjs --base HEAD~1`.
4. Commit and push, build the APK, install and smoke-test.
5. `bash scripts/publish-android-release.sh <apk> --dry-run`, then for real. The asset
   filename must be exactly `lantern-study.apk` or the stable link 404s. The script
   self-verifies that the link serves the new version.

> **Do not ship Android by `eas update`.** OTA bundles from `main` crash-loop on Android
> at boot (Reanimated SIGABRT in `NativeProxy.initHybrid`). Ship full builds.
>
> **`ios-simulator` builds have no backend.** That profile sets `APP_VARIANT=development`,
> so the Supabase and API values resolve to `undefined` and the app cannot sign in. Use
> **`ios-simulator-preview`**. No signed iOS build has ever existed — there are no Apple
> signing credentials, so a device or TestFlight build needs the founder's Apple
> Developer account.

---

## 8. Runbooks

### 8.1 "The API is down" / which build is live

**First, confirm it is actually the API.** The dev proxy has faked an outage before:
`apps/web/vite.config.ts` proxies to the deployed API with `changeOrigin: true`, which
leaves the browser's `Origin: http://localhost:5173` — production CORS rejects it and
the rejection arrived as **500 on every POST/PUT, including to routes that do not
exist**, while GETs worked fine. That reads exactly like "the API is broken and
read-only". It is fixed (the Origin header is dropped in a `configure` hook), but the
diagnosis is worth keeping.

```bash
# Should return 404. If it does, the API is healthy and the fault is local.
curl -X POST -H 'Content-Type: application/json' -d '{}' \
  https://lantern-study-api.onrender.com/api/v1/nope-not-here

# Which commit is actually running
curl -s https://lantern-study-api.onrender.com/health
```

Render keeps serving the last good build when a deploy fails, so a 200 alone proves
nothing — gate on the `commit` field. A browser-side control is to run the fetch from a
tab on `https://lanternstudy.com` (a real allowed origin, no proxy).

### 8.2 Stale `packages/shared` dist

**Symptom.** A fix you just made does not take effect; a type error points at code you
already changed; a test asserts old behaviour.

**Cause.** `@lantern/shared` is consumed built. Consumers resolve `dist/`.

**Fix.** `cd packages/shared && npm run build`. Do this before *every* typecheck or test
run of web, mobile or the API after touching shared.

**The related trap:** adding a new subpath under `packages/shared/src/` needs three
edits — the file, an `exports` entry in `packages/shared/package.json`, and a `paths`
entry in `apps/api-server/tsconfig.json`. Mobile jest maps `@lantern/shared/*` subpaths
separately, so a subpath imported *only by a test* produces a CI-only TS2307. Reproduce
it locally with `jest --no-cache`.

### 8.3 Android build fails in `INSTALL_DEPENDENCIES`

**Symptom.** `npm error Missing: <package> from lock file`, before Gradle starts.

**Cause.** Every Android build — cloud and `--local` — runs `npm ci` against
`scripts/package-lock.eas-mobile.json`, a hand-maintained *slim* lockfile that the
`eas-build-pre-install` hook (`scripts/eas-prepare-mobile-install.js`) copies over
`package-lock.json`. It exists because a full-repo `npm ci` OOMs on EAS workers. Nothing
regenerates it, so it silently goes stale whenever mobile dependencies change.

The root `package-lock.json` looks guilty and is not — its entries live at nested
workspace paths, so a naive grep says "missing" when the package is present.

**Fix.** Replay the hook's transform in a scratch copy (root `workspaces` =
`['apps/mobile','packages/*']`, root `dependencies` emptied, `devDependencies` reduced
to typescript, mobile `postinstall` deleted), run `npm install --package-lock-only`, and
copy the result back. Never mutate the real `package.json` to do it.

**Related.** A wildcard peer dependency can hoist a wrong major into the root slot that
Android autolinking reads (this happened with `expo-audio` pulling `expo-asset` 57 above
SDK 54's 12.x, crash-looping at boot with `NoClassDefFoundError`). `npx expo install
--check` does not flag it. After any native dependency change, run `npm ls <every expo-*
peer>` and confirm one version each. A root `overrides` pin is ignored unless the stale
entries are deleted from **both** lockfiles first.

### 8.4 Emulator "freezing"

Five stacked causes, in the order they were found:

1. **Stale DNS forwarder.** The guest resolves through QEMU's 10.0.2.3 → host resolver,
   which goes stale after a host network change. Diagnose: `adb shell "ping -c1
   lantern-study-api.onrender.com"` → *unknown host*. Fix at launch:
   `-dns-server 216.16.100.100,8.8.8.8`.
2. **`adb shell svc wifi disable` persists in the AVD.** Never disable wifi in the
   guest. If it was: `svc wifi enable; svc data enable` after boot.
3. **Launching from a background task kills the emulator when the task exits.**
   `nohup … & disown` does not detach in non-interactive zsh, and **macOS has no
   `setsid(1)`**. Use a Python wrapper: `os.setsid()`, redirect fds, `os.execv`, started
   from a *foreground* command, then verify the pgid differs from the shell's.
4. **Cold boot with `-cores 2` under load → `adb: device offline`.** Prefer a snapshot
   boot (omit `-no-snapshot-load`) with default cores, and keep the emulator down while
   Gradle runs.
5. **`kill -9` on qemu corrupts the metadata partition** → FBE key mismatch → infinite
   reboot loop. `-logcat-output` stays empty because the guest never boots;
   `-show-kernel` is the only diagnostic. **The only fix is `-wipe-data`**, which
   destroys the installed APK and the signed-in session — it needs the founder's
   go-ahead and their sign-in afterwards. **Never SIGKILL the emulator:** use `adb emu
   kill`, or SIGTERM and wait 20 s.

Diagnostic that bypasses `adbd` (distinguishes "emulator alive, adbd dead" from
"emulator gone"):

```bash
{ printf 'auth %s\r\navd status\r\nquit\r\n' "$(cat ~/.emulator_console_auth_token)"; sleep 2; } \
  | nc -w 3 localhost 5554
```

Process-check trap: `pgrep -f qemu` matches your own command line — use `pgrep -x
qemu-system-aarch64`.

### 8.5 Cookie sign-out storm (web)

**Symptom.** Students randomly signed out; Sentry fills with "Unexpected sign-out" and
400s on `/auth/v1/token`.

**Cause.** In cookie mode the in-memory Supabase session's `refresh_token` is the
literal placeholder `'cookie-managed'`. gotrue-js refreshes *internally* whenever any
code touches an expired session — `getSession()`, `setSession()` and `refreshSession()`
all do — posting that placeholder to Supabase, which answers 400, so supabase-js
discards a perfectly valid cookie session and emits `SIGNED_OUT`. Guarding individual
call sites is whack-a-mole.

**The fix, and why it must stay.** A `global.fetch` interceptor on the Supabase client
(`services/supabase.ts`): any POST to `/auth/v1/token` carrying `cookie-managed` is
rerouted to the BFF `/api/v1/auth/refresh`, single-flight. Success → a gotrue-shaped
200. BFF 401/403 → the 400 gotrue expects, so a *genuine* revoke still signs out.
Transient failure → `throw new TypeError('Failed to fetch')`, so gotrue treats it as a
network blip and **keeps** the session.

**If you add a second Supabase client, give it the same `global.fetch`.** The
"Unexpected sign-out" Sentry event is the regression alarm and auto-reopens.

**A second mechanism with the same symptom** (a hot loop of session → refresh → user,
64 requests in 6 seconds): a 200 session payload lacking `user` was rejected by
`normalizeMemorySession`, which then *wiped* the token cache while still reporting
success, and `getAuthHeaders()` re-ran the restore per concurrent boot fetch with no
single-flight. Fix shape: tolerant normalise, never wipe on a parse rejection, and
single-flight with capped retries.

### 8.6 PostgREST embed ambiguity

**Symptom.** A roster, list or feed renders `Invalid reference or relationship` in red,
on both platforms, for every record — immediately after a migration was applied.

**Cause.** Adding a **second** foreign key between two tables makes a bare
`profiles!inner(...)` embed ambiguous. PostgREST answers `PGRST201`, the error handler
maps it to a 400, and the raw message reaches the screen. This took out every community
members roster. Every gate stayed green — mobile jest 1813, API 1559 — because the
route's feature-detection guarded against a *missing column* and had no way to see a
*new ambiguity*. Only a device pass caught it.

**Fix.** Name the constraint:
`profiles!community_members_user_id_fkey!inner(...)`.

**How to prevent it.**

1. A migration is not safe just because its SQL is. Before handing one over, check every
   FK it **adds** for a table pair that already has one, then grep every embed on those
   tables, and say so in the migration's header.
2. Never write a bare `profiles!inner(...)` — always name the constraint. A source scan guards this
   (`apps/api-server/src/services/postgrestEmbedDisambiguation.test.ts`); check its
   coverage before assuming a module is protected. Two latent bare embeds remain in
   `supabase.ts` (note_collaborators→profiles, message_bookmarks→messages), safe only
   while those pairs stay single-FK.
3. Anon REST probing cannot verify a migration that changes grants — a probe returns
   "permission denied" either way. Use the verification SQL.
4. **Open decision:** `PGRST201` still maps to 400. A server-side query defect returned
   as a client error blames the student and keeps the failure out of 5xx alerting, which
   is why this outage paged nobody.

### 8.7 Signed URLs expiring (photos go blank after a day)

**Symptom.** Chat or board images render fine, then are blank the next day.

**Cause.** A signed URL was persisted into a database row. Signed URLs expire, capped at
24 hours.

**Fix.** Store a bucket + path *reference*; mint the display URL at render through the
batch signer and throw it away. If a new bucket's signed-URL requests are all denied,
check that it is listed in `PRIVATE_STORAGE_BUCKETS` in
`packages/shared/src/utils/storageUrl.ts` — the gate denies by default and the error
does not mention the list.

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **AI credit / "use"** | One unit of a student's AI allowance. Daily allowance resets 00:00 UTC; a durable bonus pool is earned through referrals. Costs are defined once in `packages/shared/src/utils/aiCredits.ts` |
| **BFF** | Backend-for-frontend. The Cloudflare Pages Function at `functions/api/[[path]].ts` that proxies the web app to the API and rewrites cookies so the browser never holds a refresh token |
| **bps** | Basis points. 100 bps = 1%. How every marketplace fee is expressed |
| **Companion / Lantern** | The AI assistant. Four modes: Explain, Quiz me, Socratic, Guided |
| **Community** | Campus-scale space with channels, boards, a lounge, roles and presence. Larger than a group |
| **`cookie-managed`** | The literal placeholder string standing in for a refresh token in the web app's in-memory session. See §8.5 |
| **Digital goods** | Question banks and study packs — the things creators sell. A purchase grants an *entitlement* |
| **FSRS** | Free Spaced Repetition Scheduler, the flashcard algorithm. State lives in `flashcards.srs_data` JSONB |
| **Group** | A study group: membership, admins, chat, invites. Smaller than a community |
| **Guided mode** | A multi-turn companion lesson with durable state (topic, step, outstanding check). One turn, one use |
| **Hand-over goods** | Physical marketplace items exchanged in person. Fee is inside the price; seller receives 95% |
| **Idempotency key** | The `Idempotency-Key` header that lets the server recognise a retry as the same intent. See the tracked defect in §5.5 |
| **Kobo** | 1/100 of a Nigerian naira. All internal money amounts are integer kobo |
| **Learning event** | An append-only record of something a student did, feeding mastery and the academic graph |
| **Offline 401** | A 401 that could neither be verified nor disproved. The session is *kept*; the student is told to reconnect. Never a sign-out |
| **Plan** | A study set's syllabus as units and topics, tri-state: unseen → covered → mastered |
| **Set room** | The screen for one study set, with every tool as a nested path inside it |
| **Service role** | The Supabase key that bypasses RLS. Held only by the API. On money, moderation and analytics tables the route is the *only* access control |
| **Slim lockfile** | `scripts/package-lock.eas-mobile.json` — what Android builds actually `npm ci` against. Hand-maintained. See §8.3 |
| **Study pack / question bank** | The two digital product types sold in the marketplace |
| **Study set** | The container for one subject's work. Filing it under a course is optional |
| **Transient sync error** | A queue failure meaning "the connection is down", not "the server said no". Handlers must **rethrow** these, never return `false` |
| **Turn into** | Converting one artefact into another (notes → flashcards, notes → quiz). Costs 1 use, shown before you tap |

---

*Generated from the tree at commit `e2fa40f4`. Where this document and the code
disagree, the code is right — and the disagreement is a bug in this document worth
fixing.*

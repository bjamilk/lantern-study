# Google Play store listing — drafts and asset brief

**Drafted:** 2026-08-22 · Owner: account holder · Status: not yet submitted.

Rules for this file: outcome-led copy, **no invented numbers, rankings or
testimonials** (Play rejects unverifiable claims and we have none to cite yet),
every feature mentioned exists in the production build (`apps/mobile/app.config.ts`
release notes are the changelog of record).

## Identity

| Field | Value | Limit |
|---|---|---|
| App name | Lantern Study | 30 chars |
| Default language | English (United Kingdom) — match the web copy | |
| Category | Education | |
| Tags | Education, Productivity | up to 5 |
| Contact email | support@lanternstudy.com | public |
| Website | https://lanternstudy.com | |
| Privacy policy | https://lanternstudy.com/privacy | required |
| Ads | No | |
| In-app purchases | Marketplace purchases via Paystack (third-party) — see "Policy pre-flight" | |

## Short description (≤ 80 chars)

Primary:

> Study smarter. Learn together. Notes, flashcards, tests & groups for uni.

Alternatives:

> Everything you need for university in one place — built for slow networks.
>
> Notes, flashcards, tests, study groups & a student marketplace. Free.

## Full description (≤ 4000 chars) — draft

> **Study smarter. Learn together.**
> Lantern Study puts everything you need for university in one place — notes, flashcards, practice tests, study groups and a student marketplace — and it is built for campuses where the network is slow and data is expensive.
>
> **Turn your lectures into study material**
> • Import PDFs and PowerPoint slides straight into organised notes.
> • Photograph handwritten or printed pages — text is read off the photo automatically.
> • Record a lecture and get it transcribed into a note you can search and study from.
> • Generate flashcards, quizzes and summaries from any note with Lantern AI (free, with a daily allowance).
>
> **Remember what you study**
> • Flashcards with spaced repetition that schedules each card for the moment you are about to forget it.
> • Learn, Match and Test modes; timed tests or untimed study sessions.
> • Swipe to grade, undo a grade, and see a summary at the end of every session.
>
> **Study with your people**
> • Study groups with chat, shared question banks and group tests.
> • Ask a question, get it answered and verified by your group.
> • Leaderboards and streaks that track real study work.
>
> **Marketplace built for students**
> • Question banks and study sets published by students on your campus, delivered straight into Offline Mode.
> • Buy and sell textbooks and student essentials, and browse campus jobs.
> • Safe checkout through Paystack; sellers get paid out to their bank account.
>
> **Works when the network does not**
> • Download tests and decks, study offline, and sync results when you are back online.
> • Light on data by design.
>
> **Also inside**
> • A simple monthly budget — plan income, savings and spending, month by month.
> • Lantern AI companion that explains answers in plain language.
> • Dark mode, adjustable text size, and sign-in with email, Google or Apple.
>
> **Your data**
> • No ads. Analytics only if you opt in.
> • Delete your account — and everything in it — from Settings at any time.
>
> AI-generated content can be wrong; always check it against your course material. Lantern Study is for students aged 16 and over.
>
> Questions? support@lanternstudy.com · Privacy: lanternstudy.com/privacy

(~2,100 characters — room to add a campus-specific line once there is one.)

## Keyword ideas

Play has no keyword field — work these naturally into the description and the
web copy; the Apple keyword field (100 chars) is in `apple-app-store.md`.

flashcards · spaced repetition · study app · university · exam prep · past
questions · question bank · study group · lecture notes · PDF to notes · offline
study · low data · campus marketplace · textbooks · student jobs · budget ·
Nigeria university (and each launch campus by name, e.g. UNILAG — only once the
campus is live in the app).

## Screenshots — shot list (8 phone screenshots)

Specs: PNG/JPG, 9:16 portrait, 1080 × 1920 or 1080 × 2400, min 2 / max 8 per
device type, no alpha. Capture from a **production build** on a Pixel-class
emulator, signed in as a **seeded demo account** (never a real student's data),
light theme, status bar clean (full battery, no notifications), one caption of
≤ 6 words at the top in the display font on a `#6569EE`-tinted band. Same
framing and background across all eight so they read as a set.

| # | Screen | Caption | What must be visible |
|---|---|---|---|
| 1 | Dashboard | Your study day, at a glance | Due cards, streak, quick actions, today's plan |
| 2 | Notes (note open from an imported PDF) | Slides and PDFs become notes | Imported lecture note with headings; "Generate flashcards" action |
| 3 | Flashcard review | Remember it when it matters | A card mid-review with the four grade buttons and interval previews |
| 4 | Group chat with a question | Ask your study group | A question thread with a verified answer badge |
| 5 | Test in progress | Practice like the real exam | Timer, question stem, options, progress |
| 6 | Marketplace (question banks) | Study sets from your campus | Listing cards with campus tag and price |
| 7 | Offline Mode | Download. Study anywhere. Sync later. | Downloaded bundles list with sync status |
| 8 | Lantern AI companion | Explanations in plain language | A chat reply with formatted steps and action chips |

Tablet (7" / 10") screenshots are optional for phones-only listing; if
`supportsTablet` remains on for iOS, plan the iPad set there (see Apple doc).

## Feature graphic — brief (1024 × 500)

- Format: JPG or 24-bit PNG (no alpha), exactly 1024 × 500.
- Background: brand purple `#6569EE` (manifest `theme_color`) with the subtle
  radial glow used on the landing hero; flame mark from
  `public/icons/icon-512.png` at left, roughly 300 px tall, never cropped.
- Headline (display font, white): **Study smarter. Learn together.**
- Sub-line (smaller, 85% white): Notes · Flashcards · Tests · Groups · Marketplace
- Keep all text inside a 100 px safe margin; Play crops edges in some
  placements and overlays a play button in the centre when a promo video is set
  (we have none — leave the centre clear anyway).
- No store badges, prices, "#1", ratings or device frames; no screenshots with
  text too small to read.

## Hi-res icon

512 × 512, 32-bit PNG, **opaque** (Play masks it) — `public/icons/icon-512.png`
qualifies as-is; do not reuse the padded `maskable-*.png` PWA variants here.

## Release notes template (per version, ≤ 500 chars per language)

> What's new in 1.0.x
> • …
> • …
> Fixes: …
> Questions or bugs: support@lanternstudy.com

Source of truth: the `1.0.x:` comment block in `apps/mobile/app.config.ts` and
`apps/mobile/RELEASE-<version>.md`.

## Policy pre-flight (answer honestly; these decide the review outcome)

- **User-generated content:** in-app reporting and blocking exist (users,
  listings, jobs); keep them reachable within two taps from chat, listings and
  profiles. Terms cover prohibited content.
- **Account deletion:** in-app deletion on web and mobile; web URL for the form is
  `https://lanternstudy.com/privacy` (see `google-play-data-safety.md`).
- **Payments:** marketplace checkout is Paystack in the system browser, not Google
  Play Billing. Play's payments policy generally requires Play Billing for digital
  in-app content; student-to-student sales and content also consumable on the
  web are the usual exemption arguments. **Get a ruling before the production
  rollout** — this is the single most likely rejection reason. Physical goods
  (textbooks) and jobs are outside the policy.
- **Permissions:** only `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` are declared
  (`app.config.ts`); `SYSTEM_ALERT_WINDOW` and `WRITE_EXTERNAL_STORAGE` are
  explicitly blocked. No `QUERY_ALL_PACKAGES`, no SMS, no location.
- **Target audience:** 16–17 and 18+ (Privacy Policy: 16+). Do not tick any
  under-13 group.
- **AI disclosure:** the in-app disclaimers already exist (`ai-system-card.md`);
  repeat "AI-generated content can be wrong" in the description (done above).
- **App access:** sign-in is required → supply a reviewer test account with
  seeded content, created for this purpose only.

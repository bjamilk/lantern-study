# Google Play — Data safety form (draft answers)

**App:** Lantern Study · `com.lanternstudy.app` · **Drafted:** 2026-08-22

Every answer below is derived from a repo fact — the Privacy Policy
(`packages/shared/src/legal.ts` → `PRIVACY_POLICY_MD`, mirrored by
`docs/compliance/privacy-policy.md`), `docs/compliance/retention-schedule.md`,
`docs/compliance/subprocessors.md`, `docs/compliance/ai-system-card.md`,
`apps/mobile/app.config.ts` (permissions) and the code paths cited in the
"Basis" column. Nothing here has been reviewed by counsel; do that before
submitting, and re-run this checklist whenever a feature starts collecting a new
data type (the form must be updated within Google's grace period or the app is
pulled).

## Section 1 — Overview

| Play question | Answer | Basis |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | Account data, user content, analytics (§2) |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | TLS to Supabase and the Lantern API (Privacy Policy § Security) |
| Do you provide a way for users to request that their data is deleted? | **Yes** | In-app *Settings → Account → Delete account* on web and mobile → `POST /api/v1/users/:id/delete-immediate` (`apps/api-server/src/routes/users.ts`, called from `apps/mobile/src/services/accountLifecycle.ts` and `services/supabase.ts`). Paused accounts are purged 30 days after deactivation (`retention-schedule.md`). Email route: privacy@lanternstudy.com |
| Account deletion URL (required when the app supports account creation) | `https://lanternstudy.com/privacy` | The Privacy Policy page documents in-app deletion + the contact address. **TODO:** a dedicated public `/account/delete` page would be cleaner; not in this slice |
| Has your app been independently validated against a global security standard? | **No** | — |
| Is the app designed for children / Families policy | **No** | 16+ per Privacy Policy § Children |
| Privacy policy URL | `https://lanternstudy.com/privacy` | `LEGAL_PATHS` in `legal.ts` |

## Section 2 — Data types

Legend — **Collected**: leaves the device. **Shared**: transferred to a third
party *other than* a service provider acting on Lantern's behalf or a transfer the
user initiates (Google's definition). **Optional**: the user can use the app
without providing it. Purposes use Play's vocabulary: App functionality ·
Analytics · Developer communications · Fraud prevention, security and compliance ·
Advertising or marketing · Personalization · Account management.

### Location

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| Approximate location | **Yes** | No | Yes | App functionality | The user *chooses* a campus / institution for marketplace filtering and profile (Privacy Policy: "approximate location derived from IP or campus selection you provide"). No location permission exists: `app.config.ts` `android.permissions = ['RECORD_AUDIO','MODIFY_AUDIO_SETTINGS']`, no `expo-location` dependency. IP-derived location is used only for abuse detection in server logs |
| Precise location | No | — | — | — | No `ACCESS_FINE_LOCATION`, no location SDK |

### Personal info

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| Name | Yes | No | Yes | Account management, App functionality | Display name; populated from Google / Apple sign-in on first login (`subprocessors.md`) |
| Email address | Yes | No | **No** (required for an account) | Account management, App functionality, Fraud prevention/security, Developer communications | Supabase auth; transactional mail (Resend) |
| User IDs | Yes | No | No | Account management, App functionality | Account id, username |
| Address | No | — | — | — | No shipping addresses; campus context is "Approximate location" above |
| Phone number | Yes | No | Yes | Account management, App functionality | `phoneNumber?: string` on the user profile (`packages/shared/src/types/index.ts`), optional in sign-up |
| Race and ethnicity / Political or religious beliefs / Sexual orientation | No | — | — | — | Not collected (Privacy Policy: no special-category data) |
| Other info | Yes | No | Yes | App functionality, Personalization | Institution, programme/level, profile bio, avatar, social handles the user adds |

### Financial info

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| User payment info | Yes | No* | Yes (sellers only) | App functionality | Sellers enter payout bank details in *Seller payout setup* (`apps/mobile/src/screens/marketplace/SellerPayoutSetup.tsx`; Privacy Policy "seller bank account metadata for payouts"). **Buyers never enter card data in the app** — checkout opens Paystack's hosted page in the system browser (`WebBrowser.openBrowserAsync`, e.g. `CartScreen.tsx`, `OrdersScreen.tsx`). *Paystack processes as payment provider on a user-initiated transfer — not "sharing" under Play's definition; confirm with counsel |
| Purchase history | Yes | No | Yes | App functionality, Fraud prevention | Marketplace orders / entitlements |
| Credit score | No | — | — | — | — |
| Other financial info | Yes | No | Yes | App functionality | Budget tracker: income, planned savings, spending entries the user types in (1.0.8 / 1.0.13 release notes in `app.config.ts`) |

### Health and fitness — **None collected.**

### Messages

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| Emails / SMS or MMS | No | — | — | — | Not accessed |
| Other in-app messages | Yes | No | Yes | App functionality | Group chat, direct messages, contact-form submissions (Privacy Policy "Social & communications"). Content reaches an AI provider only when the user invokes an AI feature on it (service provider) |

### Photos and videos

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| Photos | Yes | No | Yes | App functionality | Avatars, photo notes (OCR, 1.0.9), flashcard images, listing / company images — `expo-image-picker` with `mediaTypes: ['images']` |
| Videos | No | — | — | — | Picker is images-only |

### Audio

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| Voice or sound recordings | Yes | No | Yes | App functionality | Lecture / voice recording into notes → transcription by an AI provider (`RECORD_AUDIO`; `NSMicrophoneUsageDescription`; `ai-system-card.md` "audio transcription"). Recordings are user content; transcription providers are service providers |
| Music files / Other audio | No | — | — | — | — |

### Files and docs

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| Files and docs | Yes | No | Yes | App functionality | PDF / PowerPoint imports into notes, deck JSON/CSV imports (`expo-document-picker` in `NotesScreen`, `DeckDetailScreen`, `AIGenerateQuestionsModal`). Jobs applications carry typed screening answers, not CV uploads (no file field in `routes/jobs.ts`) — **re-verify if CV upload ships** |

### Calendar — None. · Contacts — None (no `expo-contacts`).

### App activity

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| App interactions | Yes | No | **Yes — opt-in only** | Analytics | First-party `product_events`, sent only after the user enables Analytics in the Cookie Preference Center (`packages/shared/src/analytics/tracker.ts` is consent-gated); 90-day retention (`retention-schedule.md`). No third-party analytics SDK |
| In-app search history | Yes | No | Yes (same consent) | Analytics | `search_performed` / `search_zero_results` events in `analytics/events.ts`; no per-user search history is stored otherwise |
| Installed apps | No | — | — | — | — |
| Other user-generated content | Yes | No | No (core of the product) | App functionality, Personalization | Notes, flashcards/decks, tests & results, study groups, question banks, marketplace listings, job postings, reviews. Sent to AI providers only on the user's request (Groq, Google Gemini, Cloudflare Workers AI, Hugging Face — `subprocessors.md`) |
| Other actions | Yes | No | No | App functionality, Personalization | Study activity: reviews, streaks/XP, test scores, leaderboards (Privacy Policy "Study & education information") |

### Web browsing — None.

### App info and performance

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| Crash logs | Yes | No | No | Analytics (stability) | Sentry in release builds (`apps/mobile/src/services/sentry.ts`, events scrubbed by `scrubSentryEvent`); Sentry is a service provider (`subprocessors.md`) |
| Diagnostics | Yes | No | No | Analytics | Sentry performance traces at `tracesSampleRate` 0.01 in production |
| Other app performance data | No | — | — | — | — |

### Device or other IDs

| Data type | Collected | Shared | Optional | Purposes | Basis |
|---|---|---|---|---|---|
| Device or other IDs | Yes | No | Yes | App functionality, Analytics | Expo push token, only after the user grants notification permission (`registerForPushNotifications` → `uploadPushToken`; Expo is a service provider); anonymous analytics device id only with Analytics consent; app/OS version attached to crash reports. Conservative declaration — Google counts app-instance identifiers here |

## Section 3 — Sharing, selling, retention (free-text / checkboxes)

- **Nothing is sold.** No advertising or marketing SDKs; the Cookie Policy states
  no advertising/marketing tracking is deployed. Answer "No" to data sharing for
  advertising.
- **Third parties are service providers** under contract / terms
  (`subprocessors.md`): Supabase (DB/auth/storage), Groq · Google Gemini ·
  Cloudflare Workers AI · Hugging Face (AI inference, user-invoked), Sentry (crash
  monitoring), Expo (push delivery), Paystack (payments, user-initiated), Resend
  (transactional email). Under Play's definition these transfers are **not
  "sharing"**, hence "Shared = No" throughout — counsel to confirm.
- **Retention** (`retention-schedule.md`): account & study data until deletion;
  paused accounts 30 days; AI inference metadata, companion analytics and product
  events 90 days; server logs 30–90 days; admin audit log 24 months.
- **Deletion** available for every data type via account deletion; AI providers
  receive prompt content transiently (Lantern does not store full prompts in
  `ai_inference_log` by default — `ai-system-card.md`).

## Section 4 — Before you click Submit

1. Counsel read-through of §2 "Shared" column and the Paystack/AI-provider
   service-provider reasoning.
2. Confirm no new SDK was added since this draft (`apps/mobile/package.json`
   dependencies — any analytics/ads/attribution SDK changes the answers).
3. Keep this file and the Privacy Policy in step; the Play form is legally
   binding and Google enforces mismatches.
4. Apple's App Privacy label must say the same thing — `docs/store/apple-app-store.md`.

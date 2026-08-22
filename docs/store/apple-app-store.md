# Apple App Store — App Privacy label and submission prerequisites

**App:** Lantern Study · bundle id `com.lanternstudy.app` · **Drafted:** 2026-08-22

The App Privacy "nutrition label" must describe the same practices as the Play
Data safety form (`google-play-data-safety.md`); this file maps those answers to
Apple's vocabulary. Same caveat: engineering draft, counsel review before
submission.

## Prerequisites (nothing below works without them)

1. **Apple Developer Program** membership ($99/yr) on the account that will own
   the app; App Store Connect record for `com.lanternstudy.app`. Steps and the
   Apple-side hardening are in `docs/APPLE-SIGN-IN-SETUP.md` (Parts A–C also
   configure Sign in with Apple — mandatory because the app offers Google
   sign-in — and the redirect allow-list). The Team ID from that enrolment is
   also what `apple-app-site-association` needs for Universal Links.
2. Build + upload per `docs/RELEASING.md` "iOS (EAS cloud + TestFlight)":
   `npm run build:ios` then `npm run submit:ios` from `apps/mobile`. There is no
   local iOS release path (fastlane + signing certs).
3. TestFlight: internal testers (≤ 100, no review) immediately; external
   testers need a short beta review and the same privacy/label answers.

## App Privacy — data collection answers

Apple asks, per data type: collected? linked to the user's identity? used for
tracking? Tracking (cross-app/site advertising or data brokers) is **No** for
every type — there are no ad/attribution SDKs — so no App Tracking Transparency
prompt is needed.

| Apple category → type | Collected | Linked to user | Purposes (Apple list) | Play equivalent / basis |
|---|---|---|---|---|
| Contact Info → Name | Yes (optional) | Yes | App Functionality | Personal info → Name |
| Contact Info → Email Address | Yes | Yes | App Functionality, Developer's Advertising or Marketing? **No** — account mail only | Personal info → Email |
| Contact Info → Phone Number | Yes (optional) | Yes | App Functionality | Personal info → Phone |
| Contact Info → Physical Address | No | — | — | Not collected |
| Contact Info → Other User Contact Info | Yes (optional) | Yes | App Functionality | Social handles / bio |
| Health & Fitness | No | — | — | — |
| Financial Info → Payment Info | Yes (sellers, optional) | Yes | App Functionality | Seller payout bank details; buyer card entry happens on Paystack's web page, not in the app |
| Financial Info → Credit Info | No | — | — | — |
| Financial Info → Other Financial Info | Yes (optional) | Yes | App Functionality | Budget tracker entries |
| Location → Coarse Location | Yes (optional) | Yes | App Functionality | User-chosen campus/institution; **no** CoreLocation usage, no location permission strings |
| Location → Precise Location | No | — | — | — |
| Sensitive Info | No | — | — | — |
| Contacts | No | — | — | No Contacts framework |
| User Content → Emails or Text Messages | No | — | — | Apple defines this as email/SMS content; in-app chat is declared under Other User Content below |
| User Content → Photos or Videos | Yes (photos only, optional) | Yes | App Functionality | Avatars, photo notes, card/listing images |
| User Content → Audio Data | Yes (optional) | Yes | App Functionality | Lecture/voice recordings → transcription (`NSMicrophoneUsageDescription`) |
| User Content → Gameplay Content | No | — | — | — |
| User Content → Customer Support | Yes | Yes | App Functionality | Contact-form submissions |
| User Content → Other User Content | Yes | Yes | App Functionality, Product Personalization | Notes, decks, tests, group chat & DMs, question banks, listings, job posts, reviews, files/docs imported |
| Browsing History | No | — | — | — |
| Search History | Yes (opt-in analytics only) | No (anonymous id) | Analytics | `search_performed` events under analytics consent |
| Identifiers → User ID | Yes | Yes | App Functionality | Account id / username |
| Identifiers → Device ID | Yes (optional) | Yes | App Functionality, Analytics | APNs/Expo push token after permission; anonymous analytics id with consent |
| Purchases → Purchase History | Yes (optional) | Yes | App Functionality | Marketplace orders |
| Usage Data → Product Interaction | Yes (opt-in only) | No | Analytics | First-party `product_events` after consent; no third-party analytics SDK |
| Usage Data → Advertising Data | No | — | — | — |
| Usage Data → Other Usage Data | Yes | Yes | App Functionality, Product Personalization | Study activity (reviews, streaks, scores) |
| Diagnostics → Crash Data | Yes | Yes | App Functionality (stability) | Sentry in release builds; `setSentryUser` links the account id |
| Diagnostics → Performance Data | Yes | Yes | App Functionality | Sentry traces (1% sample) |
| Diagnostics → Other Diagnostic Data | No | — | — | — |
| Other Data | No | — | — | — |

**Data used to track you:** none. **Third parties:** same service providers as
the Play form (`docs/compliance/subprocessors.md`); AI providers receive user
content only when the user invokes an AI feature.

## App Store Connect — other fields

| Field | Value / note |
|---|---|
| Name (≤ 30) | Lantern Study |
| Subtitle (≤ 30) | Study smarter. Learn together. |
| Keywords (≤ 100 chars) | `flashcards,spaced repetition,study,university,exam,notes,past questions,study group,offline,campus` |
| Promotional text (≤ 170) | Everything you need for university in one place — notes, flashcards, tests, study groups and a student marketplace, built for slow networks. |
| Description | Reuse the Play full description (`store-listing.md`) — Apple has no character-count penalty at that length |
| Support URL | https://lanternstudy.com (contact form) · support@lanternstudy.com |
| Marketing URL | https://lanternstudy.com |
| Privacy Policy URL | https://lanternstudy.com/privacy |
| Category | Education (secondary: Productivity) |
| Age rating | Answer the questionnaire truthfully: unrestricted web access **No** (in-app browser opens only payment/links), user-generated content **Yes** with moderation (report/block), no gambling/violence → expect 12+; the Privacy Policy says 16+ — state that in the description |
| Sign in with Apple | Already implemented (`expo-apple-authentication`, `usesAppleSignIn: true`) — required by guideline 4.8 because Google sign-in exists |
| Account deletion (5.1.1(v)) | In-app *Settings → Account → Delete account* → `POST /users/:id/delete-immediate` |
| Screenshots | Required sets: 6.9" iPhone (1320 × 2868) and 6.5" iPhone (1284 × 2778); **`supportsTablet: true` in `app.config.ts` means 13" iPad (2064 × 2752) screenshots are required too** — either capture them or set `supportsTablet: false` before the first upload. Reuse the 8-shot list from `store-listing.md` |
| Review notes | Provide the reviewer test account; explain that marketplace checkout opens Paystack in Safari and that AI features have daily limits |
| Export compliance | Uses only standard HTTPS/TLS → "exempt" (ITSAppUsesNonExemptEncryption = NO) — confirm in App Store Connect |

## Policy pre-flight (iOS-specific)

- **In-app purchase (guideline 3.1.1):** the marketplace sells digital question
  banks / study packs through Paystack. Apple generally requires IAP for digital
  content consumed in the app. Options to have ready before review: restrict
  buying digital items to the web on iOS (show purchased content, hide "Buy" —
  the "reader"-style pattern) or keep checkout in Safari and argue
  student-to-student sales; physical goods and jobs are unaffected. Decide with
  counsel before submitting for review.
- **Background audio:** `UIBackgroundModes: ['audio']` is declared for lecture
  recording; the reviewer may ask what plays/records in the background —
  mention the lecture recorder in review notes.
- **Universal Links:** `associatedDomains: ['applinks:lanternstudy.com']` is set
  but `apple-app-site-association` cannot be published until the Team ID exists
  (`docs/HANDOVER-2026-08-15-security-sessions-monitoring-ios.md`). Add it to
  `public/.well-known/` in the same release that goes to TestFlight.

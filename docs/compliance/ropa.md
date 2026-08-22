# Record of Processing Activities (RoPA)

**Controller:** Lantern Study  
**Last updated:** August 22, 2026

| Activity | Data categories | Purpose | Legal basis | Recipients | Retention |
|----------|-----------------|---------|-------------|------------|-----------|
| Account registration | Email, name, username, phone | Provide service | Contract | Supabase Auth | Until deletion |
| OAuth sign-in | Provider ID, email, name | Authentication | Contract | Google, Meta, X | Until deletion |
| Study content | Decks, cards, tests, notes | Core product | Contract | Supabase | Until deletion |
| Learning activity log (`learning_events`, `concepts`, `concept_links`) | Per-user study events: flashcard reviews (grade, scheduler state before/after), test answers (correctness, response time), notes created/opened, AI flashcards/questions generated (counts), question-bank downloads/scores, group questions posted; surface (web/mobile); linked course/deck/group/note/listing ids | Run the learning product: spaced-repetition scheduling, mastery and readiness, study recommendations, progress views | Contract (performance of the service) — written server-side, not dependent on the analytics cookie | Supabase (service-role only; no third parties) | Until account deletion (cascade); exported with the account; never on the 90-day purge |
| Product analytics events (`product_events`) | Pseudonymous device/session id, event name, page/screen, marketplace search and listing interactions | Reliability and product design analytics; also powers seller conversion stats and trending sort | Consent (Cookie Preference Center "Performance & Analytics"; off by default) | Supabase (first-party only; no advertising networks) | About 90 days (`purgeExpiredProductEvents`) |
| Groups & messaging | Messages, membership | Collaboration | Contract | Supabase | Until deletion / group retention |
| Marketplace | Listings, images, inquiries | User marketplace | Contract | Supabase, storage | Until deletion |
| AI features | Prompts, generated content, usage metadata | AI assistance | Contract / Legitimate interest | AI subprocessors | Logs 90 days |
| Push notifications | Expo push token | Alerts | Contract | Expo | Until deletion |
| Security & abuse | IP, logs, rate limits | Security | Legitimate interest | API server, Sentry (optional) | 30–90 days |
| Admin moderation | Audit actions | Platform safety | Legitimate interest | Supabase | 24 months |

## Data subject rights

Export and delete via Settings (web + mobile). Contact: privacy@lanternstudy.com

## International transfers

US and other regions via subprocessors — SCCs where required.

See [subprocessors.md](./subprocessors.md) and [privacy-policy.md](./privacy-policy.md).

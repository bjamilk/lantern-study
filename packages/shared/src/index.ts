// ===========================================
// Lantern Study - Shared Package
// ===========================================
// Cross-platform code shared between web and mobile apps (and, for a growing
// subset, the API server).
//
// WHAT BELONGS IN HERE
//   Anything two runtimes must AGREE on: wire contracts, pure derivations,
//   vocabularies, copy that must read identically, and money arithmetic.
//   Nothing that renders. There is no React component tree in this package
//   apart from one deliberate exception (components/MarkdownRenderer), and no
//   platform import — no `react-native`, no `window`, no `fs`. A file that
//   needs either belongs in the app, not here.
//
// HOW IT IS CONSUMED — READ THIS FIRST
//   BUILT, not from source. `packages/shared` compiles to `dist/` via
//   `npm run build` (tsc -p tsconfig.server.json). Consumers resolve `dist/`
//   for `require`, so if you edit a file here and immediately typecheck or run
//   web/mobile/api WITHOUT rebuilding, you are testing the previous version.
//   Half the "I already fixed that" bug reports trace back to this. Rebuild.
//
//   ADDING A NEW SUBPATH is a three-file change, and skipping any one of them
//   fails somewhere other than where you are looking:
//     1. the file itself, under src/
//     2. an "exports" entry in packages/shared/package.json  (else: bare
//        import resolves, subpath import does not)
//     3. a "paths" entry in apps/api-server/tsconfig.json    (else: the API
//        build breaks, and only the API build)
//   Mobile jest maps `@lantern/shared/*` subpaths separately in
//   apps/mobile/jest.config.js. A subpath imported ONLY by a test therefore
//   produces a CI-only TS2307 that never appears in local dev — reproduce it
//   with `jest --no-cache`. Mobile code must import from a concrete subpath
//   (`@lantern/shared/api`), never the bare package.
//
//   The web turbo build compiles with strict `noUncheckedIndexedAccess`, so an
//   indexed read that is fine under this package's own tsconfig can still fail
//   the web build. Narrow before you index.
//
//   This barrel re-exports the whole package. It is convenient for web and a
//   liability for mobile (Metro pulls the lot), which is why the subpath
//   exports exist. Prefer them.
//
// THE MAP BELOW
//   Grouped by what a thing is FOR, not alphabetically. Each line says which
//   subpath it corresponds to where one exists.

// ---------------------------------------------------------------------------
// FOUNDATIONS — environment, account state, primitive types and helpers
// ---------------------------------------------------------------------------

// Environment + endpoint resolution. NOTE: mobile deliberately does NOT use
// getConfig() — Hermes breaks its platform detection and it hands back an
// unreachable localhost URL, so apps/mobile/src/services/supabase.ts hardcodes
// its endpoints instead.
export * from './config';
// Deactivate / reactivate / delete, and the states in between. (./accountLifecycle)
export * from './accountLifecycle';
// Contact-form shape and validation, shared with the API's /contact route. (./contactForm)
export * from './contactForm';

// The domain types the whole product speaks: User, Group, Message, Deck,
// Flashcard, Test, listings, notifications. (./types)
export * from './types';

// Pure helpers. The big ones: apiMappers (snake_case rows -> domain types),
// storageUrl (private buckets, refs, sign-on-read), noteBlocks (note body
// parsing), aiCredits + aiUsage (what an AI action costs — shared with the
// server so the quoted price is the charged price), deliveryIntegrity,
// signedUrlBatch, plural. (./utils, ./utils/*)
export * from './utils';

// Zustand stores shared across platforms. (./stores)
export * from './stores';

// The IStorageAdapter interface both apps implement (localStorage on web,
// AsyncStorage on mobile) so shared code can persist without knowing where.
// (./storage)
export * from './storage';

// Deep-link parsing, shared by mobile's linking config and web's router so a
// lanternstudy.com URL and a lanternstudy:// URL mean the same thing.
// (./linking)
export * from './linking';

// ---------------------------------------------------------------------------
// ACADEMIC SPINE — who a student is, what they study, what they have learned
// ---------------------------------------------------------------------------

// Course codes, academic years, study levels, and their normalisation. Cross-
// campus matching depends on normalised values — do not send raw input.
// (./academic)
export * from './academic';

// Learning events + concept vocabulary (the append-only learning log and
// concept slugs), course topics (syllabus outline copy and the one outline
// comparator), the course workspace, and the study-set plan + nested set
// routes. (./learning, ./learning/*)
export * from './learning';

// Study-set presentation and planning: tile art and count chips
// (setPresentation), the plan drawn as a timeline (planTimeline), provenance
// chips for a plan unit (unitSources), and share-link copy (shareLink).
// (./study, ./study/*)
export * from './study';

// The one Home spine — which regions exist, in what order, and the recent-
// activities feed. Both platforms render Home from this. (./dashboard)
export * from './dashboard';

// ---------------------------------------------------------------------------
// CAMPUS — the money and opportunity surfaces
// ---------------------------------------------------------------------------

// Jobs board: campus employment, sibling of marketplace goods. (./jobs)
export * from './jobs';

// Marketplace: the fee model (the single calculator for what a buyer pays and
// a seller receives — also imported by the API), location, compliance, study
// packs and course anchoring. (./marketplace)
export * from './marketplace';

// ---------------------------------------------------------------------------
// SAFETY
// ---------------------------------------------------------------------------

// Content reports, rights attestation (clients MUST send `attestation` on
// publish), the content filter, strikes and appeals. (./moderation)
export * from './moderation';

// ---------------------------------------------------------------------------
// STUDY TOOLS
// ---------------------------------------------------------------------------

// Flashcard plain-language labels and the FSRS vocabulary — what "again",
// "hard", "good", "easy" mean to a student, identically on both platforms.
// (./flashcards, ./flashcards/*)
export * from './flashcards';

// ---------------------------------------------------------------------------
// TRANSPORT — talking to the API
// ---------------------------------------------------------------------------

// The ApiClient factory (base URL, auth headers, the tri-state 401 refresh,
// typed errors), the endpoint map (one function per route), the AI companion
// client incl. Guided mode, idempotency keys, version-conflict and rate-limit
// errors, and AI usage header parsing. (./api)
export * from './api';

// The one shared React component in the package: a markdown renderer used by
// both apps. Deliberately not under ./components/* as a general pattern —
// components belong in the apps.
export * from './components/MarkdownRenderer';

// The offline queue: durable local operations replayed when the connection
// returns, scoped per user. (./sync)
export * from './sync';

// ---------------------------------------------------------------------------
// PRESENTATION — the shared look, without any rendering
// ---------------------------------------------------------------------------

// Design tokens (palette, feature accents, type scale, spacing, radius),
// WCAG contrast measurement + runtime repair, connection-status vocabulary,
// and the spot illustrations / tile scenes both platforms draw from the same
// path data. (./design)
export * from './design';

// Notification kinds, copy and grouping. (no dedicated subpath)
export * from './notifications';

// ---------------------------------------------------------------------------
// COMPLIANCE, ANALYTICS, AUTH
// ---------------------------------------------------------------------------

// Legal documents & URLs. Single file, not a directory, because Metro handles
// one file better here. (./legal)
export * from './legal';
// Cookie consent state and the choices that follow from it. (no subpath)
export * from './cookieConsent';
// First-party product analytics: the event allowlist and the prop sanitiser.
// The API re-checks the same allowlist, so an event is added in one place.
// (./analytics)
export * from './analytics';
// Shared auth vocabulary and session helpers. (no subpath)
export * from './auth';

// ---------------------------------------------------------------------------
// NOT RE-EXPORTED HERE — subpath-only
// ---------------------------------------------------------------------------
// These are reachable via their subpath (`@lantern/shared/<name>`) but are
// deliberately kept out of the barrel, mostly to keep Metro's graph smaller:
//   ./settings   appearance + accessibility effects, user settings, daily
//                goals and reminders
//   ./ai         AI client config and prompt-adjacent shared bits
//   ./network    communities, discovery, presence, feed, mastery, referrals
//   ./chat       chat vocabulary and reaction normalisation
//   ./notes      note-side shared helpers
//   ./featureTips
//   ./utils/server  server-only helpers (must never reach a client bundle)

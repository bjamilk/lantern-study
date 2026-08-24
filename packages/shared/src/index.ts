// ===========================================
// Lantern Study - Shared Package
// ===========================================
// Cross-platform code shared between web and mobile apps

// Config
export * from './config';
export * from './accountLifecycle';
export * from './contactForm';

// Types
export * from './types';

// Utils
export * from './utils';

// Stores (Zustand)
export * from './stores';

// Storage adapters
export * from './storage';

// Deep linking
export * from './linking';

// Marketplace (location, compliance)
export * from './marketplace';

// Academic identity (course codes, academic years, study levels)
export * from './academic';

// Learning events + concepts vocabulary (append-only learning log, concept slugs)
// and course topics (syllabus outline copy + the one outline comparator)
export * from './learning';

// Jobs board (campus employment — sibling of marketplace goods)
export * from './jobs';

// Moderation (content reports, rights attestation, content filter, strikes, appeals)
export * from './moderation';

// Flashcard plain-language labels (web + mobile)
export * from './flashcards';

// API client
export * from './api';

// Components
export * from './components/MarkdownRenderer';

// Sync system
export * from './sync';

// Design tokens
export * from './design';

export * from './notifications';

// Legal documents & URLs (single file — Metro-friendly)
export * from './legal';
export * from './cookieConsent';
export * from './analytics';
export * from './auth';

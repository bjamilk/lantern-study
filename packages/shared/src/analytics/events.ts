// ===========================================
// Lantern Study - Product analytics events
// ===========================================
//
// PURPOSE
//   The allowlist of first-party product analytics events, and the sanitiser
//   that decides what may travel with one. First-party only: these go to
//   Lantern's own `POST /api/v1/analytics/events`, not to a third party.
//
// CONSUMERS
//   web + mobile emit them; `apps/api-server/src/routes/analytics.ts` ingests
//   them and re-checks the allowlist server-side. Both sides import this file,
//   which is the point — an event name that is not here is dropped, so adding
//   an event is one edit, not two.
//
// PRIVACY RULE
//   `sanitizeEventProps` is not a formality. Event props must never carry
//   personal data, free text a student typed, message or note content, or
//   anything that identifies a third party. Identity is an anonymous id
//   (ANALYTICS_ANON_ID_KEY) plus a session id, held on the device.
//
// GOTCHA: an event added here is inert until it is also emitted; an event
// emitted but not listed here is silently discarded. Check both.
//
// GOTCHAS
//   - `packages/shared` is consumed BUILT: run `npm run build` in
//     packages/shared before typechecking or running web/mobile, or consumers
//     resolve a stale `dist/`.
//   - A NEW subpath under src/ needs the file, a `packages/shared/package.json`
//     "exports" entry, AND an `apps/api-server/tsconfig.json` "paths" entry.
//     Mobile jest maps `@lantern/shared/*` subpaths separately, so a subpath
//     imported only by a test fails CI-only with TS2307 (`jest --no-cache`).
//   - The web turbo build compiles with strict `noUncheckedIndexedAccess`.

/** Allowlisted first-party product analytics events (v1). */
export const PRODUCT_EVENT_NAMES = [
  'page_view',
  'screen_view',
  'listing_impression',
  'listing_view',
  'search_performed',
  'search_zero_results',
  'inquiry_started',
  'offer_made',
  'checkout_started',
  'signup_started',
  'onboarding_completed',
  'test_started',
  'test_completed',
  'flashcard_review_started',
  'flashcard_review_completed',
  'deck_created',
  'first_card_added',
  'study_mode_selected',
  'study_mode_completed',
  'note_created',
  'ai_tool_used',
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export const PRODUCT_EVENT_ALLOWLIST = new Set<string>(PRODUCT_EVENT_NAMES);

export type ProductEventSurface = 'web' | 'mobile';

export type ProductEventInput = {
  event: ProductEventName;
  props?: Record<string, unknown>;
  campus?: string | null;
};

export type ProductEventPayload = {
  event: ProductEventName;
  surface: ProductEventSurface;
  props: Record<string, unknown>;
  campus?: string | null;
  sessionId?: string | null;
  anonId?: string | null;
  /** Client timestamp for ordering; server still sets created_at. */
  clientTs?: string;
};

export const ANALYTICS_ANON_ID_KEY = 'lantern_analytics_anon_id';
export const ANALYTICS_SESSION_ID_KEY = 'lantern_analytics_session_id';

// ---------------------------------------------------------------------------
// Guards and sanitisation
// ---------------------------------------------------------------------------

export function isProductEventName(value: unknown): value is ProductEventName {
  return typeof value === 'string' && PRODUCT_EVENT_ALLOWLIST.has(value);
}

/** Strip obvious PII and oversized values from event props. */
export function sanitizeEventProps(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  const blocked = /email|password|token|phone|address|name|authorization/i;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (blocked.test(key)) continue;
    if (typeof value === 'string') {
      out[key] = value.slice(0, key === 'query' ? 80 : 200);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (value == null) {
      continue;
    } else if (typeof value === 'object') {
      // Flatten one level of simple scalars only
      continue;
    }
  }
  return out;
}

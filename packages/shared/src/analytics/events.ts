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

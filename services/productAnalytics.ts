import {
  COOKIE_NOTICE_LEGACY_KEY,
  COOKIE_PREFS_STORAGE_KEY,
  createProductTracker,
  getApiBaseUrl,
  resolveCookiePreferences,
  type CookiePreferences,
  type ProductEventInput,
  type ProductEventPayload,
  type ProductTracker,
} from '@lantern/shared';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import { getAuthHeaders } from './supabase';

function readPrefs(): CookiePreferences | null {
  try {
    return resolveCookiePreferences(
      localStorage.getItem(COOKIE_PREFS_STORAGE_KEY),
      localStorage.getItem(COOKIE_NOTICE_LEGACY_KEY),
    );
  } catch {
    return null;
  }
}

async function transport(events: ProductEventPayload[]): Promise<void> {
  const base = (getApiBaseUrl() || '').replace(/\/$/, '');
  if (!base || events.length === 0) return;

  const body = JSON.stringify({ surface: 'web', events });
  const headers = await getAuthHeaders();

  // Prefer sendBeacon for anonymous flushes (no Authorization header).
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function' &&
    !headers.Authorization
  ) {
    const blob = new Blob([body], { type: 'application/json' });
    const ok = navigator.sendBeacon(`${base}/api/v1/analytics/events`, blob);
    if (ok) return;
  }

  const res = await fetch(`${base}/api/v1/analytics/events`, {
    method: 'POST',
    headers,
    body,
    credentials: 'include',
    keepalive: true,
  });
  if (!res.ok) {
    throw new Error(`analytics transport failed: ${res.status}`);
  }
}

let tracker: ProductTracker | null = null;

function getTracker(): ProductTracker {
  if (!tracker) {
    tracker = createProductTracker({
      getPreferences: readPrefs,
      getSurface: () => 'web',
      getUserId: () => useAuthStore.getState().currentUser?.id ?? null,
      lowDataMode: () => useUIStore.getState().lowDataMode,
      storage: {
        getItem: (key) => {
          try {
            return localStorage.getItem(key);
          } catch {
            return null;
          }
        },
        setItem: (key, value) => {
          try {
            localStorage.setItem(key, value);
          } catch {
            /* ignore */
          }
        },
        removeItem: (key) => {
          try {
            localStorage.removeItem(key);
          } catch {
            /* ignore */
          }
        },
      },
      transport,
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        void tracker?.flush();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void tracker?.flush();
      });
    }
  }
  return tracker;
}

export function trackProductEvent(input: ProductEventInput): void {
  getTracker().track(input);
}

export async function notifyProductAnalyticsConsentChange(
  prefs: CookiePreferences | null
): Promise<void> {
  await getTracker().onConsentChange(prefs);
}

export function trackPageView(route: string): void {
  trackProductEvent({
    event: 'page_view',
    props: { route: route.split('?')[0].slice(0, 120) },
  });
}

export function trackListingView(listingId: string, referrer?: string): void {
  trackProductEvent({
    event: 'listing_view',
    props: { listingId, referrer: referrer?.slice(0, 80) },
  });
}

export function trackListingImpression(listingId: string, position: number, from?: string): void {
  trackProductEvent({
    event: 'listing_impression',
    props: { listingId, position, from: from?.slice(0, 40) },
  });
}

export function trackMarketplaceSearch(opts: {
  query: string;
  resultCount: number;
  category?: string;
  campus?: string;
}): void {
  const q = opts.query.trim();
  if (!q) return;
  trackProductEvent({
    event: opts.resultCount === 0 ? 'search_zero_results' : 'search_performed',
    props: {
      query: q.slice(0, 80),
      resultCount: opts.resultCount,
      category: opts.category?.slice(0, 60),
    },
    campus: opts.campus,
  });
}

export function trackSignupStarted(): void {
  trackProductEvent({ event: 'signup_started' });
}

export function trackOnboardingCompleted(): void {
  trackProductEvent({ event: 'onboarding_completed' });
}

export function trackInquiryStarted(listingId: string): void {
  trackProductEvent({ event: 'inquiry_started', props: { listingId } });
}

export function trackOfferMade(listingId: string): void {
  trackProductEvent({ event: 'offer_made', props: { listingId } });
}

export function trackCheckoutStarted(listingId: string): void {
  trackProductEvent({ event: 'checkout_started', props: { listingId } });
}

// ========== Study events ==========

export function trackTestStarted(opts: {
  mode: 'test' | 'study';
  questionCount: number;
  groupId?: string;
}): void {
  trackProductEvent({
    event: 'test_started',
    props: { mode: opts.mode, questionCount: opts.questionCount, groupId: opts.groupId },
  });
}

export function trackTestCompleted(opts: {
  score: number;
  totalQuestions: number;
  offline?: boolean;
}): void {
  trackProductEvent({
    event: 'test_completed',
    props: {
      score: Math.round(opts.score),
      totalQuestions: opts.totalQuestions,
      offline: opts.offline ?? false,
    },
  });
}

export function trackFlashcardReviewStarted(queueSize: number, deckId?: string): void {
  trackProductEvent({ event: 'flashcard_review_started', props: { queueSize, deckId } });
}

export function trackFlashcardReviewCompleted(reviewedCount: number): void {
  trackProductEvent({ event: 'flashcard_review_completed', props: { reviewedCount } });
}

export function trackNoteCreated(source?: string): void {
  trackProductEvent({ event: 'note_created', props: { source: source?.slice(0, 40) } });
}

export function trackAIToolUsed(tool: string): void {
  trackProductEvent({ event: 'ai_tool_used', props: { tool: tool.slice(0, 40) } });
}

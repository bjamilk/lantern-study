import AsyncStorage from '@react-native-async-storage/async-storage';
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

function readPrefsSync(): CookiePreferences | null {
  // AsyncStorage is async; tracker reads prefs via cached value updated on consent.
  return cachedPrefs;
}

let cachedPrefs: CookiePreferences | null = null;
let tracker: ProductTracker | null = null;

export async function hydrateProductAnalyticsPrefs(): Promise<void> {
  try {
    const prefsRaw = await AsyncStorage.getItem(COOKIE_PREFS_STORAGE_KEY);
    const legacyRaw = await AsyncStorage.getItem(COOKIE_NOTICE_LEGACY_KEY);
    cachedPrefs = resolveCookiePreferences(prefsRaw, legacyRaw);
  } catch {
    cachedPrefs = null;
  }
}

async function transport(events: ProductEventPayload[]): Promise<void> {
  const base = (getApiBaseUrl() || '').replace(/\/$/, '');
  if (!base || events.length === 0) return;
  const token = useAuthStore.getState().session?.access_token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'LanternStudy',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/api/v1/analytics/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ surface: 'mobile', events }),
  });
  if (!res.ok) throw new Error(`analytics transport failed: ${res.status}`);
}

function getTracker(): ProductTracker {
  if (!tracker) {
    tracker = createProductTracker({
      getPreferences: readPrefsSync,
      getSurface: () => 'mobile',
      getUserId: () => useAuthStore.getState().user?.id ?? null,
      storage: {
        getItem: (key) => AsyncStorage.getItem(key),
        setItem: (key, value) => AsyncStorage.setItem(key, value),
        removeItem: (key) => AsyncStorage.removeItem(key),
      },
      transport,
    });
  }
  return tracker;
}

export function trackProductEvent(input: ProductEventInput): void {
  getTracker().track(input);
}

export async function notifyProductAnalyticsConsentChange(
  prefs: CookiePreferences | null
): Promise<void> {
  cachedPrefs = prefs;
  await getTracker().onConsentChange(prefs);
}

export function trackScreenView(screen: string): void {
  trackProductEvent({
    event: 'screen_view',
    props: { route: screen.slice(0, 120) },
  });
}

export function trackListingView(listingId: string): void {
  trackProductEvent({ event: 'listing_view', props: { listingId } });
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

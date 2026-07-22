import { acceptAllCookiePreferences, essentialOnlyCookiePreferences } from '../cookieConsent';
import { ANALYTICS_ANON_ID_KEY, ANALYTICS_SESSION_ID_KEY } from './events';
import { createProductTracker } from './tracker';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    map,
  };
}

describe('createProductTracker', () => {
  it('no-ops when analytics consent is off', async () => {
    const storage = memoryStorage();
    const transported: unknown[] = [];
    const tracker = createProductTracker({
      getPreferences: () => essentialOnlyCookiePreferences(),
      getSurface: () => 'web',
      storage,
      transport: async (events) => {
        transported.push(...events);
      },
      flushAt: 1,
      flushIntervalMs: 60_000,
    });

    tracker.track({ event: 'page_view', props: { route: '/dashboard' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(transported).toHaveLength(0);
    expect(storage.map.has(ANALYTICS_ANON_ID_KEY)).toBe(false);
  });

  it('queues and flushes when analytics consent is on', async () => {
    const storage = memoryStorage();
    const transported: Array<{ event: string }> = [];
    const tracker = createProductTracker({
      getPreferences: () => acceptAllCookiePreferences(),
      getSurface: () => 'web',
      storage,
      transport: async (events) => {
        transported.push(...events);
      },
      flushAt: 1,
      flushIntervalMs: 60_000,
      randomId: () => 'test-id',
    });

    tracker.track({ event: 'page_view', props: { route: '/marketplace' } });
    await new Promise((r) => setTimeout(r, 40));
    expect(transported).toHaveLength(1);
    expect(transported[0]?.event).toBe('page_view');
    expect(storage.map.get(ANALYTICS_ANON_ID_KEY)).toBe('test-id');
  });

  it('drops queue and clears ids on consent revoke', async () => {
    const storage = memoryStorage();
    let prefs = acceptAllCookiePreferences();
    const transported: unknown[] = [];
    const tracker = createProductTracker({
      getPreferences: () => prefs,
      getSurface: () => 'mobile',
      storage,
      transport: async (events) => {
        transported.push(...events);
      },
      flushAt: 10,
      flushIntervalMs: 60_000,
      randomId: () => 'anon-1',
    });

    tracker.track({ event: 'screen_view', props: { route: 'Home' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(storage.map.has(ANALYTICS_ANON_ID_KEY)).toBe(true);

    prefs = essentialOnlyCookiePreferences();
    await tracker.onConsentChange(prefs);
    expect(storage.map.has(ANALYTICS_ANON_ID_KEY)).toBe(false);
    expect(storage.map.has(ANALYTICS_SESSION_ID_KEY)).toBe(false);

    tracker.track({ event: 'screen_view', props: { route: 'Home' } });
    await tracker.flush();
    expect(transported).toHaveLength(0);
  });

  it('rejects unknown event names', async () => {
    const storage = memoryStorage();
    const transported: unknown[] = [];
    const tracker = createProductTracker({
      getPreferences: () => acceptAllCookiePreferences(),
      getSurface: () => 'web',
      storage,
      transport: async (events) => {
        transported.push(...events);
      },
      flushAt: 1,
    });

    tracker.track({ event: 'not_a_real_event' as 'page_view' });
    await new Promise((r) => setTimeout(r, 20));
    expect(transported).toHaveLength(0);
  });
});

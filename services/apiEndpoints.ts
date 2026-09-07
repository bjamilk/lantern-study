/**
 * The few endpoints web calls through the SHARED api client.
 *
 * Web hand-writes most of its fetch layer (services/supabase.ts), which is
 * fine for reads. It is not fine for the writes that file generated work: the
 * deck-and-cards save carries an idempotency key, a 20s timeout for decks with
 * hundreds of cards, and a body shape the server validates strictly — and web
 * having its own copy of all that is exactly how the two clients drifted, with
 * mobile saving a generation in one atomic request while web still created a
 * deck and then pushed cards one at a time.
 *
 * So these two come from packages/shared/src/api/endpoints.ts, the same
 * definitions apps/mobile uses. The client underneath is web's: web's auth
 * headers, web's cookie credentials, and the `X-Requested-With` header the
 * server's CSRF middleware demands on every cookie-authenticated write.
 */
import { createApiClient, createApiEndpoints } from '@lantern/shared/api';
import { getApiRoot, getAuthHeaders } from './supabase';
import { isCookieAuthEnabled } from './authCookieSession';

const client = createApiClient({
  // The shared client appends `/api/v1` itself.
  getBaseUrl: () => getApiRoot(),
  getAuthHeaders: async () => ({
    ...(await getAuthHeaders()),
    // Phase 1 C: the server stamps learning_events.surface from this.
    'X-Lantern-Surface': 'web',
  }),
  // Cookie-auth mode sends the session cookie; token mode must NOT, or the
  // browser attaches credentials to a cross-origin API it has none for.
  ...(isCookieAuthEnabled() ? { credentials: 'include' as const } : {}),
});

const endpoints = createApiEndpoints(client);

/**
 * Create a deck AND its cards in one request, keyed on the generating job.
 *
 * Either both land or neither does, and a retry under the same key replays the
 * first response rather than creating a second deck.
 */
export const createDeckWithCards = endpoints.createDeckWithCards;

/**
 * Save generated questions as a launchable personal test.
 *
 * `sourceJobId` is what lets the server stamp the test onto the job record, so
 * a reload — or another device — can be told where the quiz went.
 */
export const createPersonalTest = endpoints.createPersonalTest;

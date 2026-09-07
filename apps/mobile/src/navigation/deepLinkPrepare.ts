/**
 * The I/O some deep-link targets need BEFORE they can be dispatched.
 *
 * `resolveDeepLinkNavigation` (deepLinkTargets.ts) is pure and says where a
 * link lands. One target cannot simply be navigated to: `TestTaking` renders
 * from `testStore.activeTest` and never starts a test itself — the Tests list
 * calls `startTest` and only then navigates. A `test/<id>` link dispatched
 * straight into it opened a full-screen modal with nothing in it, which is
 * how a finished note quiz's Open button, notification and deep link used to
 * behave (they landed on Home before that; an empty TestTaking is not better).
 *
 * So a test link starts the test first. When that cannot be done — the list
 * has not loaded yet on a cold start, or the id is not this account's — the
 * link lands on the Tests list, where the test sits under Available.
 */
import { parseDeepLink } from '@lantern/shared/linking';
import { useAuthStore } from '../stores/authStore';
import { useTestStore } from '../stores/testStore';
import { resolveDeepLinkNavigation } from './deepLinkTargets';
import { toTab } from './nestedTab';

export type DeepLinkTarget = NonNullable<ReturnType<typeof resolveDeepLinkNavigation>>;

const TESTS_LIST: DeepLinkTarget = { screen: 'StudyTab', params: toTab('TestsList') as any };

/** Resolve `url` and do whatever its target needs done first. */
export async function prepareDeepLinkTarget(url: string): Promise<DeepLinkTarget | null> {
  const target = resolveDeepLinkNavigation(url);
  if (!target) return null;

  const parsed = parseDeepLink(url);
  if (parsed?.type !== 'test' || !parsed.id) return target;

  const store = useTestStore.getState();
  // Already the test on screen (a second tap on the same notification): do
  // not restart it and lose the answers so far.
  if (store.activeTest?.test.id === parsed.id) return target;

  const userId = useAuthStore.getState().user?.id;
  try {
    if (!store.tests.some((t) => t.id === parsed.id) && userId) {
      // Reads local storage first, then the server — a cold start reaches
      // here before the Tests list has hydrated itself.
      await store.fetchTests(userId);
    }
    await useTestStore.getState().startTest(parsed.id, 'test', userId ? { userId } : undefined);
    return target;
  } catch {
    return TESTS_LIST;
  }
}

/**
 * Navigation from outside the React tree: stores, services, notification
 * handlers and deep links, none of which hold a `navigation` prop.
 *
 * Main exports: `navigationRef` (attached to the container in RootNavigator),
 * the generic `navigate`, and the named helpers below — challenges inbox, game
 * screen/result, test player, deck detail.
 *
 * Touches: nothing but @react-navigation/native. No stores, no I/O.
 *
 * Gotchas:
 * - Every call is guarded by `navigationRef.isReady()` and does NOTHING when
 *   the container has not mounted. A caller that fires during boot (a cold
 *   deep link, a notification tap on launch) must retry — see
 *   `navigateWhenReady` in hooks/useDeepLinkHandler.ts — rather than assume
 *   this ran.
 * - Every nested target here carries `initial: false`; see the note above
 *   `navigateToChallengesInbox` for why that word is load-bearing.
 */
import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigate(name: keyof RootStackParamList, params?: object) {
  if (navigationRef.isReady()) {
    // CommonActions.navigate takes an untyped route descriptor, sidestepping
    // the typed overloads that reject a dynamic (name, params) pair.
    navigationRef.dispatch(CommonActions.navigate({ name: name as string, params }));
  }
}

/**
 * `initial: false` is load-bearing, not decoration.
 *
 * Without it React Navigation initialises an unmounted child navigator from
 * `getStateFromParams` (@react-navigation/core useNavigationBuilder), which
 * builds `{ routes: [{ name: params.screen }] }` — the target screen becomes
 * the stack's ONLY route and the tab's initial route is never put beneath it.
 * Such a screen is a dead end: its `goBack()` is unhandled by that stack and
 * escapes to the tab navigator (landing on Home), popToTop cannot pop an
 * index of 0, and the tab can never return to its own root. `initial: false`
 * makes the stack `[<tab root>, <target>]` instead.
 */
export function navigateToChallengesInbox() {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.navigate({
      name: 'Main',
      params: {
        screen: 'ChatTab',
        params: { screen: 'ChallengesInbox', initial: false },
      },
    })
  );
}

export function navigateToGameResult(session: unknown, currentUser: unknown) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.navigate({
      name: 'Main',
      params: {
        screen: 'ChatTab',
        params: {
          screen: 'GameResult',
          params: { session, currentUser },
          initial: false,
        },
      },
    })
  );
}

export function navigateToGameScreen() {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.navigate({
      name: 'Main',
      params: {
        screen: 'ChatTab',
        params: { screen: 'GameScreen', params: {}, initial: false },
      },
    })
  );
}

export function navigateToTestTaking(params: {
  testId: string;
  testName: string;
  mode?: 'test' | 'study';
  groupName?: string;
  groupId?: string;
  /** Origin tab/screen to return to on exit; see screens/tests/testSessionExit. */
  returnTo?: import('../screens/tests/testSessionExit').ReturnToTarget;
}) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.navigate({
      name: 'Main',
      params: {
        screen: 'StudyTab',
        params: {
          screen: 'TestTaking',
          params,
          initial: false,
        },
      },
    })
  );
}

/** Onboarding → the freshly generated starter deck (Study tab → DeckDetail). */
export function navigateToDeckDetail(params: { deckId: string; deckName?: string }) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.navigate({
      name: 'Main',
      params: {
        screen: 'StudyTab',
        params: {
          screen: 'DeckDetail',
          params,
          initial: false,
        },
      },
    })
  );
}

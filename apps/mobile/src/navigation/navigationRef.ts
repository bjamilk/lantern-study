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

export function navigateToChallengesInbox() {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.navigate({
      name: 'Main',
      params: {
        screen: 'ChatTab',
        params: { screen: 'ChallengesInbox' },
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
        params: { screen: 'GameScreen', params: {} },
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
        },
      },
    })
  );
}

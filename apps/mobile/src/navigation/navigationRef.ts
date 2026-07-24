import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigate(name: keyof RootStackParamList, params?: object) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name as never, params as never);
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

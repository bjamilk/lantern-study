/**
 * Profile tab -> MeProgress. The Progress peer section: the workspace bar plus
 * the shared MeProgress component (streaks, mastery and the looking-back
 * regions that came off Home).
 *
 * Exports: MeProgressScreen (named and default).
 * Touches: components/me/MeProgress for all content; navigation only.
 * Note: Leaderboard lives on the Home stack, so opening it goes through
 * navigate('HomeTab', toTab('Leaderboard')) rather than a direct push.
 */
import React from 'react';
import {
  KeyboardAwareScrollView,
  Screen,
  useScreenBottomPadding,
} from '../../components/layout';
import { MeProgress } from '../../components/me/MeProgress';
import { MeWorkspaceBar } from './MeWorkspaceBar';
import { toTab } from '../../navigation/nestedTab';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

/**
 * Progress peer section — the hub that used to sit on top of the Profile menu,
 * and now also the home of the eleven looking-back regions that came off Home
 * when it was cut back to its shared spine (SF2 · H2).
 */
export function MeProgressScreen({ navigation }: Props) {
  const bottomPadding = useScreenBottomPadding({ bottom: 'auto' });

  return (
    <Screen bottom="none">
      <MeWorkspaceBar
        active="progress"
        onSelect={(section) => {
          if (section === 'profile') navigation.navigate('Me');
        }}
      />
      <KeyboardAwareScrollView bottomPadding={bottomPadding}>
        <MeProgress
          // `Leaderboard` is a Home-stack screen. Naming the tab lets the
          // nested navigator find it; it was reachable from nowhere else once
          // Home's amber leaderboard banner came off.
          onOpenLeaderboard={() =>
            navigation.navigate('HomeTab', toTab('Leaderboard'))
          }
        />
      </KeyboardAwareScrollView>
    </Screen>
  );
}

export default MeProgressScreen;

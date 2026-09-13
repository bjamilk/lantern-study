import React from 'react';
import {
  KeyboardAwareScrollView,
  Screen,
  useScreenBottomPadding,
} from '../../components/layout';
import { MeProgress } from '../../components/me/MeProgress';
import { MeWorkspaceBar } from './MeWorkspaceBar';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

/**
 * Progress peer section — the hub that used to sit on top of the Profile menu.
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
        <MeProgress />
      </KeyboardAwareScrollView>
    </Screen>
  );
}

export default MeProgressScreen;

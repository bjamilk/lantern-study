/**
 * Floating AI usage indicator above the tab bar.
 * Uses pointerEvents so only the badge captures taps; shifts side/height by tab
 * to avoid overlapping common bottom action areas.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import AIUsageBadge from './AIUsageBadge';
import type { TabKey } from './layout/BottomTabBar';

interface Props {
  activeTab: TabKey;
  /** Hide while More sheet or other bottom overlays are open */
  hidden?: boolean;
}

/** Tabs where list screens often place primary actions on the bottom-right */
const RIGHT_ACTION_TABS: TabKey[] = ['Study', 'Home'];

export function AIUsageFloatingBadge({ activeTab, hidden = false }: Props) {
  const position = useMemo(() => {
    if (RIGHT_ACTION_TABS.includes(activeTab)) {
      return styles.anchorLeft;
    }
    return styles.anchorRight;
  }, [activeTab]);

  if (hidden) return null;

  return (
    <View
      style={[styles.container, position]}
      pointerEvents="box-none"
      accessibilityElementsHidden={false}
      importantForAccessibility="yes"
    >
      <View pointerEvents="auto">
        <AIUsageBadge interactive />
      </View>
    </View>
  );
}

const TAB_BAR_CLEARANCE = 84;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: TAB_BAR_CLEARANCE,
    zIndex: 40,
  },
  anchorLeft: {
    left: 16,
    right: undefined,
  },
  anchorRight: {
    right: 16,
    left: undefined,
  },
});

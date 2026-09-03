/**
 * Floating AI usage indicator on the right side of the screen (vertically centered).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import AIUsageBadge from './AIUsageBadge';
import type { TabKey } from './layout/BottomTabBar';

interface Props {
  activeTab: TabKey;
  /** Hide while More sheet, companion, or chat screens are open */
  hidden?: boolean;
  /** Current focused screen inside a tab stack (e.g. GroupChat) */
  focusedRoute?: string;
}

/** Tabs or screens where the floating badge should not appear */
const HIDDEN_TABS: TabKey[] = ['Chat'];
// Community screens put their own controls on the right edge (the + on BOARDS,
// STUDY GROUPS and STUDY ROOMS sit exactly where this badge floats), and a
// board is a reading surface like a chat.
const HIDDEN_ROUTES = new Set([
  'GroupChat',
  'DirectMessage',
  'TestTaking',
  'CommunityDetail',
  'CommunityChannel',
  'CommunityPost',
  'CommunityMembers',
]);

export function AIUsageFloatingBadge({ activeTab, hidden = false, focusedRoute }: Props) {
  if (hidden || HIDDEN_TABS.includes(activeTab) || (focusedRoute && HIDDEN_ROUTES.has(focusedRoute))) {
    return null;
  }

  return (
    <View
      style={styles.container}
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

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: '50%',
    right: 16,
    transform: [{ translateY: -24 }],
    zIndex: 40,
  },
});

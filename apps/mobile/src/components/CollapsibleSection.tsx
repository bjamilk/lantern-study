import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useUIStore } from '../stores/uiStore';

interface CollapsibleSectionProps {
  /** Stable id — the persisted collapse state is keyed on it, so do not rename casually. */
  id: string;
  title: string;
  /** Rendered in the header, right of the title: a count, a badge, a sort control. */
  headerRight?: React.ReactNode;
  /**
   * Shown next to the title while collapsed, so the section still says something
   * useful folded up ("3 tests", "8 earned"). A section that collapses to a bare
   * title makes the student open it just to find out whether it was worth opening.
   */
  collapsedSummary?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A dashboard panel the student can fold away.
 *
 * The dashboard stacks several tall panels, and on a phone the ones lower down
 * are permanently below the fold. Rather than reorder them for everyone —
 * different students care about different panels — each one folds, and the
 * choice persists.
 *
 * The state lives in `uiStore.collapsedDashboardSections` keyed by `id` and is
 * written to AsyncStorage, so it survives a relaunch.
 */
export function CollapsibleSection({
  id,
  title,
  headerRight,
  collapsedSummary,
  children,
  className = 'mb-4',
}: CollapsibleSectionProps) {
  const { colors } = useTheme();
  const collapsed = useUIStore((s) => Boolean(s.collapsedDashboardSections[id]));
  const toggle = useUIStore((s) => s.toggleDashboardSection);

  return (
    <View className={className}>
      <View className="flex-row items-center justify-between mb-2">
        <Pressable
          onPress={() => toggle(id)}
          // The whole title area is the target, not just the chevron: a 16px
          // chevron is a miss on a phone.
          className="flex-1 flex-row items-center gap-1.5 py-1 -my-1 min-h-[44px]"
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={`${title}, ${collapsed ? 'collapsed' : 'expanded'}`}
          accessibilityHint={collapsed ? `Show ${title}` : `Hide ${title}`}
        >
          <Ionicons
            name={collapsed ? 'chevron-forward' : 'chevron-down'}
            size={16}
            color={colors.textSecondary}
          />
          <Text className="text-sm font-semibold text-lantern-text">{title}</Text>
          {collapsed && collapsedSummary ? (
            <Text className="text-xs text-lantern-text-secondary" numberOfLines={1}>
              {collapsedSummary}
            </Text>
          ) : null}
        </Pressable>
        {/* Header controls stay reachable only while open — a sort control on a
            folded list sorts something nobody can see. */}
        {!collapsed && headerRight ? headerRight : null}
      </View>
      {!collapsed ? children : null}
    </View>
  );
}

export default CollapsibleSection;

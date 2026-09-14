/**
 * Guided mode's entry surface on the phone — the web rail's twin.
 *
 * With Guided on, the chips are the wrong offer: they ask a question, and
 * Guided teaches a TOPIC. So the picker replaces them with rows built from the
 * student's own material — `Continue learning:` only when a real stored next
 * topic exists, `Start learning:` otherwise — plus a row that hands the
 * composer back for anything else.
 *
 * Rendering the picker spends nothing; only the row that is tapped sends a
 * turn, and the cost line under it says so.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import {
  GUIDED_COST_NOTE,
  GUIDED_PICKER_TITLE,
  type GuidedGoal,
} from '@lantern/shared/api/companion';
import { useTheme } from '../../theme';
import { T } from '../ui';
import { AppIcon } from '../ui/AppIcon';

interface Props {
  goals: readonly GuidedGoal[];
  onPick: (goal: GuidedGoal) => void;
  /** "Something else…" — focuses the composer rather than opening a second box. */
  onSomethingElse: () => void;
  disabled?: boolean;
}

/** 44 dp, per the touch-target rule — these rows are the primary way in here. */
const ROW_MIN_HEIGHT = 44;

export function GuidedPicker({ goals, onPick, onSomethingElse, disabled }: Props) {
  const { colors } = useTheme();

  return (
    <View
      className="rounded-xl border border-lantern-border p-3 gap-2"
      style={{ backgroundColor: colors.backgroundSecondary }}
      accessibilityRole="none"
    >
      <T.Label style={{ color: colors.text, fontWeight: '600' }}>{GUIDED_PICKER_TITLE}</T.Label>

      {goals.map((goal) => (
        <Pressable
          key={goal.id}
          disabled={disabled}
          onPress={() => onPick(goal)}
          accessibilityRole="button"
          accessibilityLabel={
            goal.kind === 'continue'
              ? `Continue learning ${goal.topic}`
              : `Start learning ${goal.topic}`
          }
          accessibilityState={{ disabled: !!disabled }}
          style={{
            minHeight: ROW_MIN_HEIGHT,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
          }}
          className={`flex-row items-center justify-between rounded-lg px-3 ${
            disabled ? 'opacity-40' : ''
          }`}
        >
          <T.Caption style={{ color: colors.text, flexShrink: 1 }} numberOfLines={2}>
            {goal.label}
          </T.Caption>
          <AppIcon
            name="chevron-forward"
            size={16}
            color={colors.textSecondary}
            importantForAccessibility="no"
          />
        </Pressable>
      ))}

      <Pressable
        disabled={disabled}
        onPress={onSomethingElse}
        accessibilityRole="button"
        accessibilityLabel="Something else — type what you want to be guided through"
        accessibilityState={{ disabled: !!disabled }}
        style={{ minHeight: ROW_MIN_HEIGHT }}
        className={`justify-center px-3 ${disabled ? 'opacity-40' : ''}`}
      >
        <T.Caption style={{ color: colors.primary, fontWeight: '500' }}>Something else…</T.Caption>
      </Pressable>

      <T.Caption tone="secondary">{GUIDED_COST_NOTE}</T.Caption>
    </View>
  );
}

export default GuidedPicker;

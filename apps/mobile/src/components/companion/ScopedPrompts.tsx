/**
 * The two chip sets above the composer.
 *
 * TOP: the screen-scoped prompts, from the same `studySetCompanionPrompts`
 * table the web rail reads, so a student on the quiz gets "Why is this right?"
 * rather than the same five generic pills they get everywhere. Each carries
 * its intent glyph in the intent's ink (always `ai` here — see `scopedPrompts`,
 * which drops the `go` chips the phone's modal cannot honour).
 *
 * BELOW: the generic seven, matching web, collapsed to four behind "View more"
 * because a 360 dp column turns seven into a wall that buries the scoped ones.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import type { StudySetPathActivity } from '@lantern/shared/learning/studySetRoutes';
import { T, useFeatureAccent } from '../ui';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import {
  QUICK_PROMPTS,
  scopedPrompts,
  visibleQuickPrompts,
  type StudySetCompanionPrompt,
} from './companionScope';

interface Props {
  activity: StudySetPathActivity | null;
  /** What the scoped chips are about, for the screen reader's benefit. */
  scopeName?: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAsk: (message: string) => void;
  disabled?: boolean;
}

/** 44 dp, per the touch-target rule — the chips are the primary way in here. */
const CHIP_MIN_HEIGHT = 44;

export function ScopedPrompts({
  activity,
  scopeName,
  expanded,
  onToggleExpanded,
  onAsk,
  disabled,
}: Props) {
  const ai = useFeatureAccent('ai');
  const scoped = scopedPrompts(activity);
  const generic = visibleQuickPrompts(expanded);
  const canExpand = QUICK_PROMPTS.length > generic.length;

  return (
    <View className="gap-3">
      {scoped.length > 0 ? (
        <View>
          <T.Label tone="secondary" style={{ textTransform: 'uppercase', marginBottom: 6 }}>
            {scopeName ? `About ${scopeName}` : 'On this screen'}
          </T.Label>
          <View className="flex-row flex-wrap gap-2">
            {scoped.map((prompt: StudySetCompanionPrompt) => (
              <Pressable
                key={prompt.id}
                disabled={disabled}
                onPress={() => prompt.ask && onAsk(prompt.ask)}
                accessibilityRole="button"
                accessibilityLabel={prompt.label}
                accessibilityHint={prompt.ask}
                accessibilityState={{ disabled: !!disabled }}
                style={{ minHeight: CHIP_MIN_HEIGHT, backgroundColor: ai.tint }}
                className={`flex-row items-center justify-center px-3 rounded-full ${
                  disabled ? 'opacity-40' : ''
                }`}
              >
                {prompt.icon ? (
                  <AppIcon
                    name={prompt.icon as AppIconName}
                    size={16}
                    color={ai.ink}
                    importantForAccessibility="no"
                  />
                ) : null}
                <T.Caption
                  style={{ marginLeft: prompt.icon ? 6 : 0, color: ai.ink, fontWeight: '500' }}
                >
                  {prompt.label}
                </T.Caption>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View className="flex-row flex-wrap gap-2 justify-center">
        {generic.map((p) => (
          <Pressable
            key={p}
            disabled={disabled}
            onPress={() => onAsk(p)}
            accessibilityRole="button"
            accessibilityLabel={p}
            accessibilityState={{ disabled: !!disabled }}
            style={{ minHeight: CHIP_MIN_HEIGHT }}
            className={`justify-center px-4 rounded-full border border-lantern-border ${
              disabled ? 'opacity-40' : ''
            }`}
          >
            <T.Caption tone="secondary">{p}</T.Caption>
          </Pressable>
        ))}
        {canExpand || expanded ? (
          <Pressable
            onPress={onToggleExpanded}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show fewer prompts' : 'View more prompts'}
            accessibilityState={{ expanded }}
            style={{ minHeight: CHIP_MIN_HEIGHT }}
            className="justify-center px-4 rounded-full"
          >
            <T.Caption style={{ color: ai.ink, fontWeight: '500' }}>
              {expanded ? 'View less' : 'View more'}
            </T.Caption>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default ScopedPrompts;

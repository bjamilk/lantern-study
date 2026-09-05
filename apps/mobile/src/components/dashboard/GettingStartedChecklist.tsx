import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CHECKLIST_ITEMS, shouldShowChecklist, type ChecklistItemKey } from '@lantern/shared/featureTips';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { useTheme } from '../../theme';
import { AppIcon } from '../ui/AppIcon';

interface Props {
  hasDecks: boolean;
  hasTests: boolean;
  hasGroups: boolean;
  hasBudget: boolean;
  hasOpenedLibrary?: boolean;
  hasTriedCompanion?: boolean;
  hasSubmittedQuestion?: boolean;
  hasExploredMarketplace?: boolean;
  hasTriedOffline?: boolean;
  onCreateDeck: () => void;
  onTakeTest: () => void;
  onJoinGroup: () => void;
  onSetBudget: () => void;
  onOpenLibrary?: () => void;
  onTryCompanion?: () => void;
  onSubmitQuestion?: () => void;
  onExploreMarketplace?: () => void;
  onTryOffline?: () => void;
}

export function GettingStartedChecklist({
  hasDecks,
  hasTests,
  hasGroups,
  hasBudget,
  hasOpenedLibrary = false,
  hasTriedCompanion = false,
  hasSubmittedQuestion = false,
  hasExploredMarketplace = false,
  hasTriedOffline = false,
  onCreateDeck,
  onTakeTest,
  onJoinGroup,
  onSetBudget,
  onOpenLibrary,
  onTryCompanion,
  onSubmitQuestion,
  onExploreMarketplace,
  onTryOffline,
}: Props) {
  const { colors } = useTheme();
  const tips = useFeatureTipStore((s) => s.tips);
  const hydrated = useFeatureTipStore((s) => s.hydrated);
  const markChecklist = useFeatureTipStore((s) => s.markChecklist);
  const dismissGettingStarted = useFeatureTipStore((s) => s.dismissGettingStarted);
  const hydrate = useFeatureTipStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (hasDecks) markChecklist('createDeck');
    if (hasTests) markChecklist('takeTest');
    if (hasGroups) markChecklist('joinGroup');
    if (hasBudget) markChecklist('setBudget');
    if (hasOpenedLibrary) markChecklist('openLibrary');
    if (hasTriedCompanion) markChecklist('tryCompanion');
    if (hasSubmittedQuestion) markChecklist('submitQuestion');
    if (hasExploredMarketplace) markChecklist('exploreMarketplace');
    if (hasTriedOffline) markChecklist('tryOffline');
  }, [
    hydrated,
    hasDecks,
    hasTests,
    hasGroups,
    hasBudget,
    hasOpenedLibrary,
    hasTriedCompanion,
    hasSubmittedQuestion,
    hasExploredMarketplace,
    hasTriedOffline,
    markChecklist,
  ]);

  if (!hydrated || !shouldShowChecklist(tips)) return null;

  const actions: Partial<Record<ChecklistItemKey, () => void>> = {
    createDeck: onCreateDeck,
    openLibrary: onOpenLibrary,
    takeTest: onTakeTest,
    joinGroup: onJoinGroup,
    tryCompanion: onTryCompanion,
    submitQuestion: onSubmitQuestion,
    setBudget: onSetBudget,
    exploreMarketplace: onExploreMarketplace,
    tryOffline: onTryOffline,
  };

  const items = CHECKLIST_ITEMS.map((item) => ({
    ...item,
    done: Boolean(tips.checklist[item.key]),
    onClick: actions[item.key],
  }));
  const doneCount = items.filter((i) => i.done).length;

  return (
    <View
      className="rounded-2xl border p-4 mb-4"
      style={{
        borderColor: `${colors.primary}55`,
        backgroundColor: `${colors.primary}14`,
      }}
    >
      <View className="flex-row items-start justify-between mb-3">
        <View className="flex-1 pr-2">
          <Text className="text-sm font-bold" style={{ color: colors.primary }}>
            Getting started
          </Text>
          <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
            {doneCount} of {items.length} complete
          </Text>
        </View>
        <Pressable
          onPress={() => dismissGettingStarted()}
          accessibilityLabel="Dismiss getting started"
          className="p-1"
        >
          <AppIcon name="close" size={18} color={colors.primary} />
        </Pressable>
      </View>
      <View className="gap-1.5">
        {items.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => item.onClick?.()}
            disabled={item.done || !item.onClick}
            className="flex-row items-center gap-2 px-2 py-2 rounded-lg"
          >
            <AppIcon
              name={item.done ? 'checkmark-circle' : 'ellipse'}
              size={20}
              color={item.done ? '#10b981' : colors.primary}
            />
            <Text
              className={`text-sm flex-1 ${item.done ? 'line-through opacity-80' : ''}`}
              style={{ color: item.done ? '#059669' : colors.text }}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default GettingStartedChecklist;

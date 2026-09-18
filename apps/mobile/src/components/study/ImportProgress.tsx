/**
 * What an import is doing, and where to go when it is done — on the phone.
 *
 * The browser's `components/study/ImportProgress.tsx` drawn with React Native
 * primitives. Both read every string and every rule from
 * `@lantern/shared/utils/importStages`, which is the only reason the two can be
 * relied on to say the same thing: nothing here decides anything, it renders a
 * state the sheet hands down.
 *
 * NOT COPIED FROM THE REFERENCE: the animated "Processing Progress" bar and the
 * "~10m remaining" ETA, both of which are invented. A bar is drawn only where
 * the pipeline reports a real number, and the wait line is a range.
 *
 * Touches: `components/ui` (T, Button), `components/ui/AppIcon`, `theme`.
 * Consumed by `components/ImportAndStudyModal`.
 */
import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import {
  IMPORT_RUN_SUBHEADING,
  WHERE_NEXT_FOOTER,
  WHERE_NEXT_TITLE,
  deriveImportStages,
  importRunHeading,
  importWaitHint,
  whereNextCards,
  type ImportRunState,
  type ImportStageCard,
  type WhereNextCardId,
} from '@lantern/shared/utils/importStages';
import { brand } from '../../theme';
import { T } from '../ui';
import { AppIcon } from '../ui/AppIcon';

const STATUS_WORD: Record<ImportStageCard['status'], string> = {
  pending: 'Not started',
  active: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

const StageMark: React.FC<{ status: ImportStageCard['status'] }> = ({ status }) => {
  if (status === 'done') {
    return <AppIcon name="checkmark-circle" size={20} color="#22c55e" />;
  }
  if (status === 'failed') {
    return <AppIcon name="alert-circle" size={20} color="#ef4444" />;
  }
  if (status === 'active') {
    return <ActivityIndicator size="small" color={brand.text} />;
  }
  return (
    <View className="h-5 w-5 rounded-full border-2 border-dashed border-lantern-border" />
  );
};

const StageRow: React.FC<{ card: ImportStageCard; onRetry?: () => void }> = ({
  card,
  onRetry,
}) => (
  <View
    testID={`import-stage-${card.id}`}
    accessibilityRole="text"
    // The status is IN the label, never only in the colour and the glyph: the
    // row has to read the same to TalkBack as it looks on the screen.
    accessibilityLabel={`${card.label} — ${STATUS_WORD[card.status]}`}
    className={`flex-row items-start gap-3 rounded-xl border px-3 py-3 mb-2 ${
      card.status === 'failed' ? 'border-red-400' : 'border-lantern-border'
    }`}
  >
    <StageMark status={card.status} />
    <View className="flex-1">
      <T.Body className="font-semibold">{card.label}</T.Body>
      {card.percent !== null && card.status === 'active' ? (
        <View className="mt-2">
          <View className="h-1.5 w-full overflow-hidden rounded-full bg-lantern-border">
            <View
              className="h-full rounded-full bg-lantern-text"
              style={{ width: `${card.percent}%` }}
            />
          </View>
          <T.Caption tone="secondary" className="mt-1">{`${card.percent}%`}</T.Caption>
        </View>
      ) : null}
      {card.error ? (
        <View className="mt-1">
          <T.Caption className="text-red-500">{card.error}</T.Caption>
          {onRetry ? (
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry this import"
              className="mt-2 self-start rounded-full border border-lantern-border px-3 py-2"
            >
              <T.Caption className="font-semibold">Retry</T.Caption>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  </View>
);

export interface ImportStagesProps {
  state: ImportRunState;
  onRetry?: () => void;
}

export function ImportStages({ state, onRetry }: ImportStagesProps) {
  const cards = deriveImportStages(state);
  const failed = cards.some((card) => card.status === 'failed');

  return (
    <View className="py-2">
      <View className="items-center mb-3">
        <T.Title>{importRunHeading(state.kind)}</T.Title>
        <T.Caption tone="secondary" className="text-center mt-1">
          {IMPORT_RUN_SUBHEADING}
        </T.Caption>
      </View>
      {cards.map((card) => (
        <StageRow key={card.id} card={card} onRetry={card.error ? onRetry : undefined} />
      ))}
      {failed ? null : (
        <T.Caption tone="secondary" className="text-center mt-1">
          {importWaitHint(state.kind)}
        </T.Caption>
      )}
    </View>
  );
}

export interface WhereNextForkProps {
  onViewMaterial?: () => void;
  onViewPlan?: () => void;
  onOpenSetHome: () => void;
}

export function WhereNextFork({ onViewMaterial, onViewPlan, onOpenSetHome }: WhereNextForkProps) {
  const cards = whereNextCards({
    hasMaterial: Boolean(onViewMaterial),
    hasPlan: Boolean(onViewPlan),
  });

  const press = (id: WhereNextCardId) => {
    if (id === 'material') onViewMaterial?.();
    else if (id === 'plan') onViewPlan?.();
    else onOpenSetHome();
  };

  return (
    <View className="py-2">
      <T.Title className="text-center mb-3">{WHERE_NEXT_TITLE}</T.Title>
      {cards.map((card) => (
        <Pressable
          key={card.id}
          testID={`where-next-${card.id}`}
          onPress={() => press(card.id)}
          accessibilityRole="button"
          accessibilityLabel={card.recommended ? `${card.title}, recommended` : card.title}
          className="rounded-2xl border border-lantern-border px-3 py-3 mb-2"
        >
          <View className="flex-row items-center gap-2">
            <T.Body className="font-semibold">{card.title}</T.Body>
            {card.recommended ? (
              <View className="rounded-full bg-lantern-text px-2 py-0.5">
                <T.Caption className="text-lantern-background font-semibold">
                  Recommended
                </T.Caption>
              </View>
            ) : null}
          </View>
          <T.Caption tone="secondary">{card.detail}</T.Caption>
        </Pressable>
      ))}
      <T.Caption tone="secondary" className="text-center mt-1">
        {WHERE_NEXT_FOOTER}
      </T.Caption>
    </View>
  );
}

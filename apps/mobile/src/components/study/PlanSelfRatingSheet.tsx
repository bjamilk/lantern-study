/**
 * The plan-entry self-rating, as a sheet.
 *
 * WHAT THIS IS. The phone half of the web Plan tab's highlighted card (`See
 * what you already know` in `components/study/StudySetPlanPanel.tsx`): a walk
 * through the topics the plan has never heard an answer about, one at a time,
 * asking the one question the web asks — "Do you already know this well enough
 * to skip it?". `I know this` marks the topic COVERED; `Not yet` leaves it
 * alone and moves on. Nothing here calls a model, so it costs nothing and works
 * on a set the AI has never touched.
 *
 * WHY IT WRITES `covered` AND NEVER `mastered`. A rating is the student's own
 * estimate, and the plan already has a word for "I have met this" that is not
 * the word for "I have proved it": `covered` is what reading a topic earns and
 * `mastered` is what a quiz or a card review earns. Letting a tap claim the
 * second one would put a full ring on a topic nobody has ever answered a
 * question about. The sheet says so on screen, in the panel's own words.
 *
 * WHY THE LIST IS FROZEN AT OPEN. `planSelfRatingRows` drops a topic as soon as
 * it stops being `unseen`, so recomputing it between taps would renumber the
 * walk under the student's finger — `3 of 7` becoming `3 of 6` the moment they
 * answer. The rows are snapshotted by the caller when the sheet opens and the
 * index walks that snapshot.
 *
 * All of "which topics, in what order, numbered how" is in
 * ./studyPlanPresentation.ts. This file is a drawing and an index.
 */
import React from 'react';
import { View } from 'react-native';
import type { StudySetTopicStatus } from '@lantern/shared/learning';
import { Button, SheetShell, T } from '../ui';
import type { PlanSelfRatingRow } from './studyPlanPresentation';

export interface PlanSelfRatingSheetProps {
  visible: boolean;
  /** Snapshotted at open. See WHY THE LIST IS FROZEN AT OPEN. */
  rows: readonly PlanSelfRatingRow[];
  /** How far into `rows` the walk is. The caller owns it so closing resets it. */
  index: number;
  onIndexChange: (next: number) => void;
  onRate: (topicId: string, next: StudySetTopicStatus) => void;
  onClose: () => void;
}

export function PlanSelfRatingSheet({
  visible,
  rows,
  index,
  onIndexChange,
  onRate,
  onClose,
}: PlanSelfRatingSheetProps) {
  const row = rows[index];

  // A walk that runs off the end closes rather than drawing an empty sheet.
  const advance = () => {
    if (index + 1 >= rows.length) onClose();
    else onIndexChange(index + 1);
  };

  return (
    <SheetShell
      visible={visible && Boolean(row)}
      onClose={onClose}
      title="Quick check"
      footer={
        <View className="flex-row gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onPress={advance}
            accessibilityLabel={row ? `Not yet. ${row.title}` : 'Not yet'}
          >
            Not yet
          </Button>
          <Button
            className="flex-1"
            onPress={() => {
              if (row) onRate(row.id, 'covered');
              advance();
            }}
            accessibilityLabel={row ? `I know this. ${row.title}` : 'I know this'}
          >
            I know this
          </Button>
        </View>
      }
    >
      {row ? (
        <View className="gap-2">
          <T.Caption tone="secondary">
            {row.unitLabel} · {row.positionLabel}
          </T.Caption>
          <T.Heading>{row.title}</T.Heading>
          <T.Body tone="secondary">Do you already know this well enough to skip it?</T.Body>
          {/* The honesty line, in the web panel's own words rather than a
              second phrasing of the same rule. `I know this` marks the topic
              covered; nothing here can master it. */}
          <T.Caption tone="tertiary">
            This is your own estimate, not a test. Reading a topic covers it. Proving it in a quiz
            or a card review masters it.
          </T.Caption>
          <Button variant="ghost" size="sm" className="self-start" onPress={onClose}>
            Stop the check
          </Button>
        </View>
      ) : null}
    </SheetShell>
  );
}

export default PlanSelfRatingSheet;

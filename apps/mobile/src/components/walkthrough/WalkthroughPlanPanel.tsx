/**
 * The plan panel: every page of the document, what it is called, and which
 * ones are done.
 *
 * The titles are NOT invented here. They come from `pageHeadings` in
 * `@lantern/shared/notes`, the same function the web panel uses, so a page is
 * called the same thing on both platforms. Two of its flags are the whole
 * design of this list:
 *
 * - `isDerived: false` means the title is a guess — the opening sentence, or
 *   "Page N". It is set in the secondary ink so a guess never reads with the
 *   authority of a real heading.
 * - `hasText: false` means there is nothing on the page to explain or quiz.
 *   The row says "no text" rather than staying silent and letting the student
 *   discover it by spending an AI use.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Body, Caption, Title } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { useScreenBottomPadding } from '../layout/Screen';
import type { PageHeading } from './walkthroughModel';

export function WalkthroughPlanPanel({
  visible,
  headings,
  currentIndex,
  done,
  progress,
  onSelect,
  onClose,
}: {
  visible: boolean;
  headings: readonly PageHeading[];
  currentIndex: number;
  done: readonly number[];
  /** "4 of 12 pages done", from `progressLabel`. */
  progress: string;
  onSelect: (pageIndex: number) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const bottomPadding = useScreenBottomPadding();
  const doneSet = new Set(done);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable className="flex-1" accessibilityLabel="Close the plan" onPress={onClose} />
        <View
          className="rounded-t-3xl bg-lantern-background"
          style={{ maxHeight: '78%', paddingBottom: bottomPadding }}
        >
          <View className="px-4 pt-4 pb-2 flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Title>Plan</Title>
              <Caption tone="secondary">{progress}</Caption>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close the plan"
              hitSlop={8}
              className="p-2"
            >
              <AppIcon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView className="px-4">
            {headings.length === 0 ? (
              <Caption tone="secondary" className="py-6">
                No pages to plan yet.
              </Caption>
            ) : null}
            {headings.map((heading) => {
              const isCurrent = heading.pageIndex === currentIndex;
              const isDone = doneSet.has(heading.pageIndex);
              return (
                <Pressable
                  key={heading.pageIndex}
                  onPress={() => onSelect(heading.pageIndex)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isCurrent }}
                  accessibilityLabel={[
                    `Page ${heading.pageIndex + 1}`,
                    heading.title,
                    isDone ? 'done' : undefined,
                    heading.hasText ? undefined : 'no text on this page',
                  ]
                    .filter(Boolean)
                    .join('. ')}
                  className={`flex-row items-center gap-3 px-3 py-3 mb-1.5 rounded-lantern-xl border ${
                    isCurrent
                      ? 'border-lantern-primary bg-lantern-primary-background'
                      : 'border-lantern-border bg-lantern-surface'
                  }`}
                >
                  <AppIcon
                    name={isDone ? 'checkmark-circle' : 'ellipse'}
                    size={18}
                    color={isDone ? colors.success : colors.textTertiary}
                  />
                  <View className="flex-1 min-w-0">
                    <Body
                      numberOfLines={2}
                      tone={heading.isDerived ? 'text' : 'secondary'}
                      style={heading.isDerived ? { fontWeight: '600' } : undefined}
                      importantForAccessibility="no"
                    >
                      {heading.title}
                    </Body>
                    <Caption tone="tertiary" importantForAccessibility="no">
                      {`Page ${heading.pageIndex + 1}`}
                      {heading.hasText ? '' : ' · no text'}
                    </Caption>
                  </View>
                  {isCurrent ? (
                    <Caption tone="secondary" importantForAccessibility="no">
                      Reading
                    </Caption>
                  ) : null}
                </Pressable>
              );
            })}
            <View className="h-4" />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default WalkthroughPlanPanel;

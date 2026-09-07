/**
 * "Quiz me on this page" — the questions, right where the page is.
 *
 * Scoped by CONTENT, not by a flag the server does not have: the page's own
 * text goes to `/daily-quiz`, which is the same `generate_questions` cap and
 * the same single AI use as every other question generation in the app. That
 * is what makes "this page" true rather than a label over a whole-note quiz.
 *
 * The questions are not saved as a test. A page check is a moment in a read,
 * not an artifact to manage later — and the Test builder is one tap away in
 * the note for the student who wants the note-sized version.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { Body, Button, Caption, Title } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { useScreenBottomPadding } from '../layout/Screen';

export interface PageQuizQuestion {
  id: string;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
}

export function WalkthroughQuizSheet({
  visible,
  pageLabel,
  loading,
  error,
  questions,
  onRetry,
  onClose,
}: {
  visible: boolean;
  pageLabel: string;
  loading: boolean;
  error: string | null;
  questions: readonly PageQuizQuestion[];
  onRetry: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const bottomPadding = useScreenBottomPadding();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable className="flex-1" accessibilityLabel="Close the questions" onPress={onClose} />
        <View
          className="rounded-t-3xl bg-lantern-background px-4 pt-4"
          style={{ maxHeight: '80%', paddingBottom: bottomPadding + 12 }}
        >
          <View className="flex-row items-center justify-between mb-1">
            <Title>Questions on this page</Title>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} className="p-2">
              <AppIcon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Caption tone="secondary" className="mb-3">
            {pageLabel}
          </Caption>

          {loading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color={colors.primary} />
              <Caption tone="secondary" className="mt-3">
                Writing questions from this page…
              </Caption>
            </View>
          ) : error ? (
            <View className="py-6">
              <Body style={{ color: colors.error }}>{error}</Body>
              <Button size="sm" variant="secondary" className="mt-3 self-start" onPress={onRetry}>
                Try again
              </Button>
            </View>
          ) : (
            <ScrollView>
              {questions.length === 0 ? (
                <Caption tone="secondary" className="py-6">
                  No questions came back for this page.
                </Caption>
              ) : null}
              {questions.map((q, index) => {
                const isOpen = Boolean(revealed[q.id]);
                return (
                  <View
                    key={q.id}
                    className="mb-2 p-3 rounded-lantern-xl border border-lantern-border bg-lantern-surface"
                  >
                    <Body style={{ fontWeight: '600' }}>{`${index + 1}. ${q.question}`}</Body>
                    {q.options?.length ? (
                      <View className="mt-2">
                        {q.options.map((option) => (
                          <Caption key={option} tone="secondary" className="mb-0.5">
                            {`• ${option}`}
                          </Caption>
                        ))}
                      </View>
                    ) : null}
                    <Pressable
                      onPress={() => setRevealed((prev) => ({ ...prev, [q.id]: !prev[q.id] }))}
                      accessibilityRole="button"
                      accessibilityLabel={isOpen ? 'Hide the answer' : 'Show the answer'}
                      className="mt-2 self-start"
                      hitSlop={6}
                    >
                      <Caption style={{ color: colors.primary }}>
                        {isOpen ? 'Hide answer' : 'Show answer'}
                      </Caption>
                    </Pressable>
                    {isOpen ? (
                      <View className="mt-2">
                        <Body>{q.correctAnswer}</Body>
                        {q.explanation ? (
                          <Caption tone="secondary" className="mt-1">
                            {q.explanation}
                          </Caption>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
              <View className="h-4" />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

export default WalkthroughQuizSheet;

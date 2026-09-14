import React, { useMemo, useState } from 'react';
import { AppIcon } from './ui/AppIcon';
import { Button, Card, FeatureDisc, Select } from './ui';
import {
  MAX_QUESTION_COUNT,
  QUESTION_COUNT_CHOICES,
  TEST_SOURCES,
  TIMER_CHOICES,
  clampQuestionCount,
  defaultTestPlan,
  isNavigationSource,
  primaryActionLabel,
  summarizeTestPlan,
  validateTestPlan,
  type TestAttemptKind,
  type TestPlanDraft,
  applyTestSittingPreset,
  type TestSourceKind,
} from '../utils/testBuilder';
import { TEST_SITTING_PRESETS } from '@lantern/shared';

export interface TestBuilderDeckOption {
  id: string;
  name: string;
  cardCount?: number;
}

export interface TestBuilderNoteOption {
  id: string;
  title: string;
}

export interface TestBuilderScreenProps {
  decks: TestBuilderDeckOption[];
  notes: TestBuilderNoteOption[];
  /** A generation already running — the footer says so instead of going quiet. */
  isBusy?: boolean;
  busyLabel?: string | null;
  error?: string | null;
  onBack: () => void;
  onStart: (plan: TestPlanDraft) => void;
  /** "With your group" leaves this page for the chat, and says so first. */
  onOpenGroupChat: () => void;
  /**
   * The set room this builder is standing in, when it is in one. It rides out
   * on the plan so the test it builds is filed where it was made — the set
   * room's Test tab lists by set and nothing else.
   */
  studySetId?: string | null;
}

const SOURCE_ICON: Record<TestSourceKind, React.ReactNode> = {
  deck: <AppIcon name="albums" size={20} />,
  note: <AppIcon name="document-text" size={20} />,
  group: <AppIcon name="chatbubbles" size={20} />,
};

/**
 * "New test" — the page the web never had.
 *
 * Until this, the only way to author a test on web was the group chat's config
 * modal, so "New test" on the Tests home had to hijack the Chat destination and
 * open a "pick a group" sheet. A student with a deck and no group could not
 * make a test at all. Three sources are offered here, and the group one is
 * honest that it is a door out rather than a form.
 *
 * The footer is PINNED, and the summary line sits inside it. The version of
 * this surface that shipped in the group chat put its actions below the fold on
 * first open, so on a phone the primary action was simply not on screen —
 * whatever is above it, the thing you press is always visible, and it always
 * says what it is about to do.
 */
export const TestBuilderScreen: React.FC<TestBuilderScreenProps> = ({
  decks,
  notes,
  isBusy = false,
  busyLabel,
  error,
  onBack,
  onStart,
  onOpenGroupChat,
  studySetId = null,
}) => {
  const [plan, setPlan] = useState<TestPlanDraft>(defaultTestPlan);

  const availableForSource = useMemo(() => {
    if (plan.source === 'deck') {
      const deck = decks.find((d) => d.id === plan.sourceId);
      return deck?.cardCount ?? null;
    }
    return null;
  }, [plan.source, plan.sourceId, decks]);

  const validity = useMemo(
    () => validateTestPlan(plan, { deckCount: decks.length, noteCount: notes.length }),
    [plan, decks.length, notes.length]
  );

  const summary = summarizeTestPlan(plan);
  const isGroup = isNavigationSource(plan.source);

  const chooseSource = (source: TestSourceKind) => {
    setPlan((prev) => ({ ...prev, source, sourceId: null, sourceTitle: null }));
  };

  const chooseSourceItem = (id: string) => {
    if (plan.source === 'deck') {
      const deck = decks.find((d) => d.id === id);
      setPlan((prev) => ({
        ...prev,
        sourceId: deck ? deck.id : null,
        sourceTitle: deck?.name ?? null,
        questionCount: clampQuestionCount(prev.questionCount, deck?.cardCount ?? null),
      }));
      return;
    }
    const note = notes.find((n) => n.id === id);
    setPlan((prev) => ({
      ...prev,
      sourceId: note ? note.id : null,
      sourceTitle: note?.title ?? null,
    }));
  };

  const chooseAttemptKind = (attemptKind: TestAttemptKind) => {
    setPlan((prev) => ({
      ...prev,
      attemptKind,
      // A practice attempt is never on a clock, so leaving a stale timer set
      // would make the summary line lie about what Start does.
      timerMinutes: attemptKind === 'practice' ? 0 : prev.timerMinutes,
    }));
  };

  const handlePrimary = () => {
    if (isGroup) {
      onOpenGroupChat();
      return;
    }
    if (!validity.canStart) return;
    onStart(studySetId ? { ...plan, studySetId } : plan);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-lantern-background text-lantern-text">
      {/* Scrolling body. `min-h-0` is what lets it scroll instead of crushing
          the pinned footer out of the flex column. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 md:px-6 lg:px-8 py-6 w-full max-w-3xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to Tests"
              className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lantern text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary"
            >
              <AppIcon name="arrow-back" size={20} aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <h1 className="text-title text-lantern-text">New test</h1>
              <p className="text-caption text-lantern-text-secondary">
                Pick where the questions come from, then how you want to sit it.
              </p>
            </div>
          </div>

          <section aria-labelledby="test-source-heading" className="space-y-2">
            <h2 id="test-source-heading" className="text-heading font-semibold text-lantern-text">
              Where the questions come from
            </h2>
            <div role="radiogroup" aria-labelledby="test-source-heading" className="space-y-2">
              {TEST_SOURCES.map((option) => {
                const isSelected = plan.source === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => chooseSource(option.id)}
                    className={`w-full text-left flex items-start gap-3 p-3 min-h-[44px] rounded-lantern-xl border transition-colors ${
                      isSelected
                        ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint'
                        : 'border-lantern-border bg-lantern-surface hover:border-lantern-text-tertiary'
                    }`}
                  >
                    <FeatureDisc feature="tests" icon={SOURCE_ICON[option.id]} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-semibold text-lantern-text">
                        {option.label}
                      </span>
                      <span className="block text-caption text-lantern-text-secondary">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {plan.source === 'deck' && (
            <section className="space-y-2">
              <label htmlFor="test-source-deck" className="block text-body font-semibold text-lantern-text">
                Deck
              </label>
              {decks.length === 0 ? (
                <Card padding="md">
                  <p className="text-body text-lantern-text-secondary">
                    You have no decks yet. Make one in your Library and it will show up here.
                  </p>
                </Card>
              ) : (
                <Select
                  id="test-source-deck"
                  className="w-full"
                  value={plan.sourceId ?? ''}
                  onChange={(event) => chooseSourceItem(event.target.value)}
                >
                  <option value="">Choose a deck…</option>
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                      {typeof deck.cardCount === 'number' ? ` (${deck.cardCount} cards)` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </section>
          )}

          {plan.source === 'note' && (
            <section className="space-y-2">
              <label htmlFor="test-source-note" className="block text-body font-semibold text-lantern-text">
                Note
              </label>
              {notes.length === 0 ? (
                <Card padding="md">
                  <p className="text-body text-lantern-text-secondary">
                    You have no notes yet. Import a PDF, record a lecture or write one, then come back.
                  </p>
                </Card>
              ) : (
                <Select
                  id="test-source-note"
                  className="w-full"
                  value={plan.sourceId ?? ''}
                  onChange={(event) => chooseSourceItem(event.target.value)}
                >
                  <option value="">Choose a note…</option>
                  {notes.map((note) => (
                    <option key={note.id} value={note.id}>
                      {note.title || 'Untitled note'}
                    </option>
                  ))}
                </Select>
              )}
            </section>
          )}

          {plan.source && !isGroup && (
            <>
              <section aria-labelledby="test-count-heading" className="space-y-2">
                <h2 id="test-count-heading" className="text-heading font-semibold text-lantern-text">
                  How many questions
                </h2>
                <div className="flex flex-wrap gap-2">
                  {QUESTION_COUNT_CHOICES.map((count) => {
                    const clamped = clampQuestionCount(count, availableForSource);
                    const isSelected = plan.questionCount === clamped;
                    const isReachable = clamped === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        disabled={!isReachable}
                        aria-pressed={isSelected}
                        onClick={() => setPlan((prev) => ({ ...prev, questionCount: clamped }))}
                        className={`min-h-[44px] px-4 rounded-lantern border text-body font-semibold tabular-nums transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          isSelected
                            ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint text-lantern-feature-tests-ink'
                            : 'border-lantern-border bg-lantern-surface text-lantern-text-secondary hover:text-lantern-text'
                        }`}
                      >
                        {count}
                      </button>
                    );
                  })}
                </div>
                {typeof availableForSource === 'number' && availableForSource < MAX_QUESTION_COUNT && (
                  <p className="text-caption text-lantern-text-secondary tabular-nums">
                    This deck has {availableForSource} card
                    {availableForSource === 1 ? '' : 's'}, so that is the ceiling.
                  </p>
                )}
              </section>

              <section aria-labelledby="test-kind-heading" className="space-y-2">
                <h2 id="test-kind-heading" className="text-heading font-semibold text-lantern-text">
                  How you want to sit it
                </h2>
                <div role="radiogroup" aria-labelledby="test-kind-heading" className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      {
                        id: 'practice' as const,
                        label: 'Practice',
                        description:
                          'Answers revealed as you go, and you are asked how sure you were first.',
                      },
                      {
                        id: 'exam' as const,
                        label: 'Exam',
                        description: 'No feedback until you submit. Add a clock if you want one.',
                      },
                    ]
                  ).map((option) => {
                    const isSelected = plan.attemptKind === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => chooseAttemptKind(option.id)}
                        className={`text-left p-3 min-h-[44px] rounded-lantern-xl border transition-colors ${
                          isSelected
                            ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint'
                            : 'border-lantern-border bg-lantern-surface hover:border-lantern-text-tertiary'
                        }`}
                      >
                        <span className="block text-body font-semibold text-lantern-text">
                          {option.label}
                        </span>
                        <span className="block text-caption text-lantern-text-secondary">
                          {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section aria-labelledby="test-sitting-heading" className="space-y-2">
                <h2 id="test-sitting-heading" className="text-heading font-semibold text-lantern-text">
                  Sitting
                </h2>
                <p className="text-caption text-lantern-text-secondary">
                  Optional exam-format presets — generic, not a licensed paper.
                </p>
                <div className="flex flex-wrap gap-2">
                  {TEST_SITTING_PRESETS.map((preset) => {
                    const isSelected = plan.sittingPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={isSelected}
                        title={preset.promise}
                        onClick={() =>
                          setPlan((prev) =>
                            applyTestSittingPreset(prev, isSelected ? null : preset.id)
                          )
                        }
                        className={`min-h-[44px] rounded-full border px-3 text-caption ${
                          isSelected
                            ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint font-semibold'
                            : 'border-lantern-border text-lantern-text-secondary'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              {plan.attemptKind === 'exam' && (
                <section aria-labelledby="test-timer-heading" className="space-y-2">
                  <h2 id="test-timer-heading" className="text-heading font-semibold text-lantern-text">
                    Timer
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {TIMER_CHOICES.map((minutes) => {
                      const isSelected = plan.timerMinutes === minutes;
                      return (
                        <button
                          key={minutes}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setPlan((prev) => ({ ...prev, timerMinutes: minutes }))}
                          className={`min-h-[44px] px-4 rounded-lantern border text-body font-semibold tabular-nums transition-colors ${
                            isSelected
                              ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint text-lantern-feature-tests-ink'
                              : 'border-lantern-border bg-lantern-surface text-lantern-text-secondary hover:text-lantern-text'
                          }`}
                        >
                          {minutes === 0 ? 'No timer' : `${minutes} min`}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="text-body text-lantern-error">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Pinned footer. `shrink-0` keeps the flex column from crushing it, which
          is what put this surface's actions off-screen on a phone before. */}
      <div className="shrink-0 border-t border-lantern-border bg-lantern-surface px-4 md:px-6 lg:px-8 py-3">
        <div className="w-full max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="min-w-0 flex-1 flex items-start gap-2">
            <AppIcon name="clipboard-check" size={20} className="shrink-0 mt-0.5 text-lantern-feature-tests-ink"
              aria-hidden="true" />
            <p className="text-caption text-lantern-text-secondary">
              {busyLabel && isBusy ? busyLabel : summary}
              {!validity.canStart && validity.blocker ? ` ${validity.blocker}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" onClick={onBack}>
              Cancel
            </Button>
            <Button
              onClick={handlePrimary}
              loading={isBusy}
              disabled={!validity.canStart || isBusy}
            >
              {primaryActionLabel(plan)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestBuilderScreen;

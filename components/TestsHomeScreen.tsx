import React, { useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { OfflineSessionBundle, PausedSessionSummary, TestResult } from '../types';
import { Button, Card, EmptyState, FeatureDisc, ScreenHeader } from './ui';
import { retakeTitle } from '../utils/testRetake';
import { tallyAttempt, unansweredNote } from '../utils/testAttempt';

export interface TestsHomeScreenProps {
  /** Completed attempts, newest first is not assumed — the screen sorts. */
  results: TestResult[];
  /** Attempts a student walked away from and can pick back up. */
  pausedSessions?: PausedSessionSummary[];
  onResumePausedSession?: (sessionId: string) => void;
  onAbandonPausedSession?: (sessionId: string) => void;
  /** Downloaded question sets — a test that is available with no connection. */
  availableBundles?: OfflineSessionBundle[];
  onStartBundle?: (bundleId: string) => void;
  /** Opens the "New test" page (`/study/tests/new`). */
  onNewTest?: () => void;
  onViewResult: (result: TestResult) => void;
  /**
   * Retake straight from a history row.
   *
   * The row itself carries no questions — the server mirrors those only onto
   * launchable rows — so the handler behind this fetches the session first.
   * The row must not try to decide for itself whether a retake is possible; it
   * used to, by looking at `session.questions`, and refused every single one.
   */
  onRetakeResult?: (result: TestResult) => void;
}

type TestsTab = 'available' | 'history';

const percent = (value: number) => `${value.toFixed(0)}%`;

/**
 * Tests home (§5.7 "Tests"), the door the web never had: until this screen the
 * only routes under `/tests` were `active` and `review`, so a student could sit
 * a test and read one back but had nowhere to see what tests she had, and
 * "recent tests" from the Study hub landed on the Dashboard.
 *
 * Colour is one hue — sky, the Tests & Readiness accent — carried by 40 px
 * discs on rows and a 4 px score rail. Scores are text as well as a rail, never
 * a bar alone, and every numeral is `tabular-nums` so a column of them lines up.
 */
export const TestsHomeScreen: React.FC<TestsHomeScreenProps> = ({
  results,
  pausedSessions = [],
  onResumePausedSession,
  onAbandonPausedSession,
  availableBundles = [],
  onStartBundle,
  onNewTest,
  onViewResult,
  onRetakeResult,
}) => {
  const [tab, setTab] = useState<TestsTab>('available');

  const history = useMemo(
    () =>
      [...results].sort(
        (a, b) =>
          new Date(b.session.startTime).getTime() - new Date(a.session.startTime).getTime()
      ),
    [results]
  );

  const savedCount = pausedSessions.length + availableBundles.length;
  const isEmpty = savedCount === 0 && history.length === 0;

  const tabs: { id: TestsTab; label: string; count: number }[] = [
    { id: 'available', label: 'Available', count: savedCount },
    { id: 'history', label: 'History', count: history.length },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-lantern-background text-lantern-text">
      <div className="px-4 md:px-6 lg:px-8 py-6 w-full space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <ScreenHeader
            title="Tests"
            subtitle="Practice tests, past questions and everything you have already sat"
          />
          {onNewTest && (
            <Button onClick={onNewTest}>
              <PlusIcon className="w-5 h-5" />
              New test
            </Button>
          )}
        </div>

        {isEmpty ? (
          /* Compact anatomy (§5.6 empty state, mobile parity): a tint band, a
             title, one sentence, one action — bounded to 768 px rather than
             tinting the whole 1280 px column, which would spend the screen's
             entire chromatic budget on emptiness. */
          <EmptyState
            compact
            feature="tests"
            icon={<ClipboardDocumentCheckIcon className="w-7 h-7" />}
            title="Sit a test, find the gaps"
            description="A practice test is the fastest way to learn what you do not know yet — make one from a group's past questions, or from anything already in your library."
            actionLabel={onNewTest ? 'New test' : undefined}
            onAction={onNewTest}
          />
        ) : (
          <>
            {/* Segmented control: the active segment is a sky tint, and it is
                labelled — never the colour alone. */}
            <div
              role="tablist"
              aria-label="Tests"
              className="inline-flex gap-1 rounded-lantern border border-lantern-border bg-lantern-surface p-1"
            >
              {tabs.map((t) => {
                const isActive = tab === t.id;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    type="button"
                    aria-selected={isActive}
                    onClick={() => setTab(t.id)}
                    className={`min-h-[44px] rounded-lantern px-4 text-body font-semibold transition-colors ${
                      isActive
                        ? 'bg-lantern-feature-tests-tint text-lantern-feature-tests-ink'
                        : 'text-lantern-text-secondary hover:text-lantern-text'
                    }`}
                  >
                    {t.label}
                    <span className="ml-1.5 tabular-nums text-caption font-normal">{t.count}</span>
                  </button>
                );
              })}
            </div>

            {tab === 'available' ? (
              <div className="space-y-2">
                {savedCount === 0 ? (
                  <Card padding="md">
                    <p className="text-body text-lantern-text-secondary">
                      Nothing waiting. Start a new test, or download a group&apos;s questions for
                      offline — they show up here.
                    </p>
                  </Card>
                ) : null}

                {pausedSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center gap-3 p-3 rounded-lantern-xl border border-lantern-border bg-lantern-surface"
                  >
                    <FeatureDisc feature="tests" icon={<ClockIcon className="w-5 h-5" />} />
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-semibold text-lantern-text truncate">{session.title}</p>
                      <p className="text-caption text-lantern-text-secondary tabular-nums">
                        {session.answeredCount}/{session.totalQuestions} answered · paused
                      </p>
                    </div>
                    {onResumePausedSession && (
                      <Button size="sm" onClick={() => onResumePausedSession(session.id)}>
                        <PlayIcon className="w-4 h-4" />
                        Resume
                      </Button>
                    )}
                    {onAbandonPausedSession && (
                      <button
                        type="button"
                        onClick={() => onAbandonPausedSession(session.id)}
                        aria-label={`Discard ${session.title}`}
                        className="shrink-0 p-2 rounded-lantern text-lantern-text-tertiary hover:text-lantern-error hover:bg-lantern-background-secondary"
                      >
                        <TrashIcon className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}

                {availableBundles.map((bundle) => (
                  <div
                    key={bundle.bundleId}
                    className="flex items-center gap-3 p-3 rounded-lantern-xl border border-lantern-border bg-lantern-surface"
                  >
                    <FeatureDisc feature="tests" icon={<ClipboardDocumentCheckIcon className="w-5 h-5" />} />
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-semibold text-lantern-text truncate">
                        {bundle.displayName || bundle.groupName}
                      </p>
                      <p className="text-caption text-lantern-text-secondary tabular-nums">
                        {bundle.questions.length} question{bundle.questions.length === 1 ? '' : 's'} · saved
                        on this device
                      </p>
                    </div>
                    {onStartBundle && (
                      <Button size="sm" onClick={() => onStartBundle(bundle.bundleId)}>
                        <PlayIcon className="w-4 h-4" />
                        Start
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {history.length === 0 ? (
                  <Card padding="md">
                    <p className="text-body text-lantern-text-secondary">
                      No finished tests yet. The first one you submit lands here with its score.
                    </p>
                  </Card>
                ) : (
                  history.map((result, index) => {
                    const key =
                      result.id ??
                      `${result.session.startTime}-${result.session.config?.groupId ?? 'group'}-${index}`;
                    // One name. A row that said "Practice test" while the rest
                    // of the section said "Test" read as two different things.
                    const title = retakeTitle(result.session);
                    const missed = unansweredNote(tallyAttempt(result.session));
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-3 p-3 rounded-lantern-xl border border-lantern-border bg-lantern-surface hover:border-lantern-text-tertiary transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => onViewResult(result)}
                          className="min-w-0 flex-1 text-left flex items-center gap-3"
                        >
                          <FeatureDisc feature="tests" icon={<ClipboardDocumentCheckIcon className="w-5 h-5" />} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-body font-semibold text-lantern-text truncate">{title}</span>
                            <span className="block text-caption text-lantern-text-secondary">
                              {new Date(result.session.startTime).toLocaleDateString()}
                            </span>
                            {/* Unanswered is reported separately from wrong —
                                a question never reached is not one missed. */}
                            {missed && (
                              <span className="block text-caption text-lantern-text-secondary tabular-nums">
                                {missed}
                              </span>
                            )}
                            {/* Score as text AND a rail — the rail alone would be
                                colour carrying meaning on its own. */}
                            <span
                              aria-hidden="true"
                              className="mt-1.5 block h-1 w-full max-w-[12rem] rounded-full bg-lantern-background-secondary overflow-hidden"
                            >
                              <span
                                className="block h-full rounded-full bg-lantern-feature-tests-ink"
                                style={{ width: `${Math.max(0, Math.min(100, result.score))}%` }}
                              />
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-heading font-bold tabular-nums text-lantern-text">
                              {percent(result.score)}
                            </span>
                            <span className="block text-caption tabular-nums text-lantern-text-secondary">
                              {result.correctAnswersCount}/{result.totalQuestions}
                            </span>
                          </span>
                        </button>
                        {onRetakeResult && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onRetakeResult(result)}
                            aria-label={`Retake ${title}`}
                          >
                            <ArrowPathIcon className="w-4 h-4" aria-hidden="true" />
                            Retake
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        )}

        {onNewTest && !isEmpty && (
          <button
            type="button"
            onClick={onNewTest}
            className="inline-flex items-center gap-1.5 text-body font-medium text-lantern-primary-text hover:underline"
          >
            <ArrowPathIcon className="w-4 h-4" aria-hidden="true" />
            Make another test
          </button>
        )}
      </div>
    </div>
  );
};

export default TestsHomeScreen;

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchCourseReadiness } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useNetworkStatus } from '../../hooks';
import { navigate as navigateFromRoot } from '../../navigation/navigationRef';
import { Card, useFeatureAccent } from '../ui';
import { smallTextInk } from '../ui/FeatureDisc';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { tabularNums } from '../../design/typeScale';
import { clampProgressPercent } from './progressBar';
import {
  buildReadinessRows,
  type ReadinessCardRow,
  type ReadinessCourseInput,
  type ReadinessNavTarget,
} from './readinessCardModel';
import { planReadinessLoad, type ReadinessLoadTrigger } from './readinessLoadPlanner';

import { toTab } from '../../navigation/nestedTab';

/**
 * Home's "Exam readiness" card: one compact bar per active course, the three
 * topics that are actually holding the score down, and ONE button that says
 * where it goes.
 *
 * Spec §5.7 makes this the SECOND card on Home and the screen's ONE tint
 * panel, in the tests family's sky — so the single coloured thing above the
 * fold is the answer to "am I ready", not a decoration.
 *
 * Every rule about what to show — the days-left line, which chips, which one
 * action and what it is called — lives in `readinessCardModel.ts` and is
 * tested there. This file only draws it and drives the navigator.
 *
 * It no longer disappears when there are no courses. A card that renders
 * nothing is indistinguishable from a card that failed, and both read to a
 * student as "the app forgot my exams". The three honest states are: courses,
 * no courses yet (say what would fill it), and could-not-load (say so).
 */
const BAND_BAR: Record<string, string> = {
  unknown: 'bg-lantern-primary/50',
  weak: 'bg-red-400',
  developing: 'bg-amber-400',
  strong: 'bg-emerald-500',
};

const openMastery = (courseId?: string) =>
  navigateFromRoot('Main', {
    screen: 'MarketTab',
    params: toTab('Mastery', courseId ? { courseId } : undefined),
  });

const openStudy = (screen: string, params?: Record<string, unknown>) =>
  navigateFromRoot('Main', {
    screen: 'StudyTab',
    params: toTab(screen, params),
  });

/**
 * The one action, driven through the existing stack helpers only — `toTab`
 * carries `initial: false`, so the target lands ON TOP of its tab's root
 * rather than replacing it and stranding Back (navigation/nestedTab.ts).
 */
export function runReadinessAction(target: ReadinessNavTarget): void {
  switch (target.kind) {
    case 'deck':
      openStudy('DeckDetail', { deckId: target.deckId });
      return;
    case 'note':
      openStudy('NoteEditor', { noteId: target.noteId });
      return;
    case 'test':
      // TestBuilder takes no course preselect today (StudyStackParamList:
      // `{ noteId?: string }`), so it opens on its own picker rather than
      // being handed a param it would silently drop.
      openStudy('TestBuilder');
      return;
    case 'topics':
      // The outline editor lives on Library, which opens it on arrival from
      // this param — the topics list is where "Add your topics" must land.
      openStudy('Library', {
        manageOutlineCourseId: target.courseId,
        manageOutlineCourseLabel: target.courseLabel,
      });
      return;
    case 'examDate':
      // Exam dates are edited in Settings → Academic, on the root stack.
      navigateFromRoot('AcademicSettings');
      return;
  }
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; courses: ReadinessCourseInput[] }
  | { status: 'failed' };

export function CourseReadinessCard({
  /**
   * Bumped by Home's pull-to-refresh. The card is a sibling of the stats the
   * student watches recover, so a pull that refreshes them and not this one is
   * the whole reported bug.
   */
  reloadToken,
}: {
  reloadToken?: number;
} = {}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  // Build 169, dark mode: the chips and the action button were painted with
  // `text-lantern-feature-tests-ink` / `bg-lantern-feature-tests-tint`, and
  // NEITHER CLASS EXISTS. `tailwind.config.js` declares `lantern.feature`
  // with `tests` twice — the `{ ink, tint }` pair first, then a deprecated
  // legacy string — and the second wins, so the pair keys are never
  // generated. An unknown Tailwind colour is silently dropped, which left the
  // labels at React Native's default BLACK on a transparent chip: invisible
  // on dark, and accidentally legible on light, which is why it shipped.
  // Same defect for `flashcards`, `groups` and `budget` in that config.
  //
  // The pair is taken from the tokens instead, per theme, so this card no
  // longer depends on that config resolving at all.
  const accent = useFeatureAccent('tests');
  const { isDark, colors } = useTheme();
  // The chip label is the 11px `label` step, so it goes through the
  // small-text ink like every other sub-12px feature label (FeatureDisc.tsx).
  const chipInk = smallTextInk('tests', accent, isDark);

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { isConnected } = useNetworkStatus();

  /**
   * The load, driven by `planReadinessLoad`. Everything the planner reads is
   * held in a ref rather than a dependency, so `run` keeps ONE identity per
   * account: an effect keyed on the card's own status would re-fire the moment
   * a fetch settled and retry itself forever on a dead link.
   */
  const stateRef = useRef<LoadState>(state);
  const inFlightRef = useRef(false);
  const loadedForRef = useRef<string | null>(null);
  /** Newest request wins; every older answer is dropped, not raced. */
  const requestRef = useRef(0);

  const apply = useCallback((next: LoadState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const run = useCallback(
    (trigger: ReadinessLoadTrigger) => {
      const plan = planReadinessLoad({
        trigger,
        status: stateRef.current.status,
        inFlight: inFlightRef.current,
        userId,
        loadedForUserId: loadedForRef.current,
      });
      if (plan.reset) {
        // Another account's readiness (or none) must not sit on screen while
        // this one loads. The in-flight answer is dropped by token below.
        requestRef.current += 1;
        inFlightRef.current = false;
        loadedForRef.current = null;
        apply({ status: 'loading' });
      }
      if (!plan.fetch) return;

      const token = (requestRef.current += 1);
      const forUser = userId;
      inFlightRef.current = true;
      fetchCourseReadiness()
        .then((data) => {
          if (token !== requestRef.current) return;
          inFlightRef.current = false;
          loadedForRef.current = forUser;
          apply({ status: 'ready', courses: data.courses });
        })
        .catch(() => {
          if (token !== requestRef.current) return;
          inFlightRef.current = false;
          // Recorded even on a failure: it is what makes a later sign-in as a
          // different student a `reset`, rather than a silent re-use.
          loadedForRef.current = forUser;
          apply({ status: 'failed' });
        });
    },
    [apply, userId]
  );

  // First render, and any change of signed-in account.
  useEffect(() => {
    run('user-changed');
  }, [run]);

  // Home stays mounted behind its tab, so returning to it runs no plain
  // effect. This is the return path.
  useFocusEffect(
    useCallback(() => {
      run('focus');
    }, [run])
  );

  // Airplane mode off. The card recovers on its own rather than waiting for
  // the student to guess that a pull would help.
  const wasConnected = useRef(isConnected);
  useEffect(() => {
    const cameBack = isConnected && !wasConnected.current;
    wasConnected.current = isConnected;
    if (cameBack) run('reconnected');
  }, [isConnected, run]);

  // Pull-to-refresh, from Home. The initial value is the baseline, so mounting
  // with a token already set does not fetch twice.
  const seenToken = useRef(reloadToken);
  useEffect(() => {
    if (reloadToken === seenToken.current) return;
    seenToken.current = reloadToken;
    run('pull-to-refresh');
  }, [reloadToken, run]);

  // Nothing is drawn for the beat before the first answer: a skeleton in the
  // screen's only tint panel is a flash of colour that means nothing.
  if (state.status === 'loading') return null;

  const rows: ReadinessCardRow[] =
    state.status === 'ready' ? buildReadinessRows(state.courses, 3) : [];

  return (
    <Card
      variant="feature"
      feature="tests"
      icon="clipboard"
      title="Exam readiness"
      // The screen's one tint panel gets the screen's one picture. It sits
      // beside the courses rather than on the band, which costs the card no
      // extra tint — see `CardProps.illustration`.
      illustration="readiness-ring"
      className="mb-4"
    >
      {state.status === 'failed' ? (
        <Text className="text-caption text-lantern-text-secondary">
          We could not load your readiness just now. Your study still counts — pull down to
          refresh.
        </Text>
      ) : rows.length === 0 ? (
        <Text className="text-caption text-lantern-text-secondary">
          Add your courses and exam dates and this becomes a per-course readiness score.
        </Text>
      ) : (
        rows.map((row) => (
          <View
            key={row.courseId}
            className="py-2 border-b border-lantern-border/50 last:border-b-0"
          >
            <Pressable
              onPress={() => openMastery(row.courseId)}
              accessibilityRole="button"
              accessibilityLabel={`${row.courseLabel}: ${row.statusLine}. Open breakdown`}
            >
              <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                <Text
                  className="flex-1 text-caption font-semibold text-lantern-text"
                  numberOfLines={1}
                >
                  {row.courseLabel}
                </Text>
                {row.daysLeftLabel ? (
                  <Text className="text-label text-lantern-text-tertiary" style={tabularNums}>
                    {row.daysLeftLabel}
                  </Text>
                ) : null}
                <AppIcon
                  name="chevron-forward"
                  size={12}
                  color={colors.textTertiary}
                  importantForAccessibility="no"
                />
              </View>
              <View className="mt-1.5 h-1.5 rounded-full bg-lantern-background-secondary overflow-hidden">
                <View
                  className={`h-full rounded-full ${row.readinessScore != null ? BAND_BAR[row.band] : 'bg-lantern-primary/50'}`}
                  style={{
                    width: `${Math.max(
                      clampProgressPercent(row.barPct),
                      row.barPct != null ? 4 : 0
                    )}%`,
                  }}
                />
              </View>
              <Text className="mt-1 text-label text-lantern-text-secondary" style={tabularNums}>
                {row.statusLine}
              </Text>
            </Pressable>

            {/* The countdown's stand-in, not a second action: a course with no
                exam date has an empty slot where the days-left line goes, and
                this fills THAT slot. Never shown alongside a countdown. */}
            {row.examDatePrompt ? (
              <Pressable
                onPress={() => runReadinessAction(row.examDatePrompt!.target)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`${row.examDatePrompt.label}. ${row.examDatePrompt.reason}`}
                className="mt-1 self-start"
              >
                <Text className="text-label font-medium text-lantern-primary-text">
                  {row.examDatePrompt.label}
                </Text>
              </Pressable>
            ) : null}

            {/* The three topics holding the score down, in the tests ink —
                named, because "you're at 44%" without a name is a verdict
                rather than a lead. */}
            {row.weakestChips.length > 0 ? (
              <View className="mt-1.5 flex-row flex-wrap" style={{ gap: 6 }}>
                {row.weakestChips.map((chip) => (
                  <View
                    key={chip}
                    className="rounded-full px-2 py-0.5"
                    style={{ backgroundColor: accent.tint }}
                  >
                    <Text
                      className="text-label font-medium"
                      style={{ color: chipInk }}
                      numberOfLines={1}
                    >
                      {chip}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Pressable
              onPress={() => runReadinessAction(row.nextAction.target)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={row.nextAction.accessibilityLabel}
              className="mt-2 self-start rounded-lg px-3 py-1.5"
              style={{ backgroundColor: accent.tint }}
            >
              <Text className="text-caption font-semibold" style={{ color: accent.ink }}>
                {row.nextAction.label}
              </Text>
            </Pressable>
            {/* Why this and not something else, in one sentence. Without it the
                button is an instruction; with it, it is an answer. */}
            {row.nextAction.reason ? (
              <Text className="mt-1 text-label text-lantern-text-tertiary">
                {row.nextAction.reason}
              </Text>
            ) : null}
          </View>
        ))
      )}

      {rows.length > 0 ? (
        <Pressable
          onPress={() => openMastery()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open your full readiness breakdown"
          className="pt-3"
        >
          <Text className="text-caption font-semibold text-lantern-primary-text">View all</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

export default CourseReadinessCard;

/**
 * The progress sheet every AI generation shows (Wave G).
 *
 * Deliberately NOT a blocking takeover. StudyFetch's Android app puts a
 * full-screen "Generating feature…" wall in front of the student with no
 * percentage, no cancel and no completion notice; its web app shows a spinner
 * that never resolves on work the server already finished. This is a bottom
 * sheet: it can be swiped down or dismissed at any time, the work carries on in
 * jobsStore, and the student is told when it lands.
 *
 * It selects its own job out of the store, so a screen only has to render
 * `<JobProgressSheet />` once — there is nothing to wire per call site.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, Text, View } from 'react-native';
import { featureAccentsDark, featureAccentsLight, type FeatureKey } from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { AppIcon } from '../ui/AppIcon';
import { useJobsStore } from '../../stores/jobsStore';
import { JOB_TIME_BUDGET_MS, findJob, type JobKind } from '../../stores/jobsCore';
import { jobActionLabel, jobSheetState, type JobSheetAction } from './jobSheetModel';
import { openJobResult } from './openJobResult';
import { retrySaveJob } from '../../services/jobArtifacts';

/** Which feature accent a generation belongs to. */
export const featureKeyForJob = (kind: JobKind): FeatureKey => {
  switch (kind) {
    case 'flashcards':
      return 'flashcards';
    case 'quiz':
    case 'test':
      return 'tests';
    case 'summary':
      return 'ai';
    case 'import':
    default:
      return 'notes';
  }
};

/** How far the sheet has to be dragged down before it counts as "swiped away". */
const DISMISS_DISTANCE = 60;

/**
 * Nothing to wire.
 *
 * "Open" used to be a per-screen callback, and every screen's version knew
 * about decks and silently ignored everything else. It routes through
 * openJobResult now, which sends every kind to its own artefact.
 */
export function JobProgressSheet() {
  const { colors, isDark } = useTheme();
  const sheetJobId = useJobsStore((s) => s.sheetJobId);
  const jobs = useJobsStore((s) => s.jobs);
  const stopWatching = useJobsStore((s) => s.stopWatching);
  const dismissJob = useJobsStore((s) => s.dismissJob);
  const retryGenerate = useJobsStore((s) => s.retryGenerate);

  const job = sheetJobId ? findJob(jobs, sheetJobId) : undefined;
  const [now, setNow] = useState(() => Date.now());
  // "Keep waiting" pushes the budget out rather than closing the sheet — the
  // prompt would otherwise reappear on the next tick.
  const [budgetMs, setBudgetMs] = useState(JOB_TIME_BUDGET_MS);
  const translateY = useRef(new Animated.Value(0)).current;

  // One ticking clock while a job is on screen — the elapsed readout and the
  // 90 s budget both come off it.
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'lost') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);

  useEffect(() => {
    translateY.setValue(0);
    setBudgetMs(JOB_TIME_BUDGET_MS);
  }, [sheetJobId, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_e, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_e, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE) {
          const id = useJobsStore.getState().sheetJobId;
          if (id) useJobsStore.getState().stopWatching(id);
          return;
        }
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  if (!job) return null;

  const state = jobSheetState(job, now, budgetMs);
  const accent = (isDark ? featureAccentsDark : featureAccentsLight)[featureKeyForJob(job.kind)];

  const runAction = (action: JobSheetAction) => {
    switch (action) {
      case 'stop-watching':
        stopWatching(job.id);
        break;
      case 'keep-waiting':
        setBudgetMs((ms) => ms + JOB_TIME_BUDGET_MS);
        break;
      case 'retry':
        retryGenerate(job.id);
        break;
      case 'save-to-library':
        // The generation is already paid for and already on this device; this
        // only files it. A failure re-arms the same button (jobArtifacts).
        void retrySaveJob(job.id).catch(() => {
          // The job record carries the reason; the sheet re-renders from it.
        });
        break;
      case 'open':
        void openJobResult(job);
        dismissJob(job.id);
        break;
      case 'dismiss':
      default:
        dismissJob(job.id);
        break;
    }
  };

  const toneColor =
    state.tone === 'failed' ? colors.error : state.tone === 'done' ? colors.success : accent.ink;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => stopWatching(job.id)}>
      <View className="flex-1 justify-end">
        {/* Tapping outside stops WATCHING, never the work. */}
        <Pressable
          className="flex-1"
          accessibilityLabel="Stop watching this generation"
          onPress={() => stopWatching(job.id)}
        />
        <Animated.View
          {...panResponder.panHandlers}
          style={{ transform: [{ translateY }], backgroundColor: colors.modalBackground }}
          className="rounded-t-3xl px-5 pt-3 pb-6"
        >
          <View className="items-center pb-3">
            <View className="h-1 w-10 rounded-full" style={{ backgroundColor: colors.border }} />
          </View>

          <View className="flex-row items-center gap-3">
            <View
              className="h-10 w-10 rounded-full items-center justify-center"
              style={{ backgroundColor: accent.tint }}
            >
              <AppIcon
                name={state.tone === 'failed' ? 'alert-circle' : state.tone === 'done' ? 'checkmark-circle' : 'sparkles'}
                size={20}
                color={toneColor}
              />
            </View>
            <View className="flex-1 min-w-0">
              <Text className="text-heading text-lantern-text" numberOfLines={2}>
                {state.headline}
              </Text>
              <Text className="text-caption text-lantern-text-secondary mt-0.5">
                {state.detail}
              </Text>
            </View>
          </View>

          {state.tone === 'running' ? (
            <>
              <View
                className="h-1.5 rounded-full overflow-hidden mt-4"
                style={{ backgroundColor: colors.border }}
              >
                <View
                  className="h-full rounded-full"
                  style={{ width: `${state.percent}%`, backgroundColor: accent.ink }}
                />
              </View>

              <View className="flex-row items-center justify-between mt-2">
                <Text className="text-label text-lantern-text-secondary">
                  {state.percent}%
                </Text>
                <Text className="text-label text-lantern-text-secondary">
                  {state.elapsedLabel}
                </Text>
              </View>

              {/* The whole path, not one word: the student can see what is left. */}
              <View className="mt-3 gap-1.5">
                {state.stages.map((stage, index) => {
                  const done = index < state.stageIndex;
                  const current = index === state.stageIndex;
                  return (
                    <View key={stage} className="flex-row items-center gap-2">
                      <AppIcon
                        name={done ? 'checkmark-circle' : current ? 'time' : 'radio-button-off'}
                        size={14}
                        color={current ? accent.ink : colors.textTertiary}
                      />
                      <Text
                        className="text-caption flex-1"
                        style={{ color: current ? colors.text : colors.textSecondary }}
                        numberOfLines={1}
                      >
                        {stage}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}

          <View className="mt-5 gap-2">
            {state.actions.map((action, index) => {
              const primary = index === 0 && action !== 'stop-watching';
              return (
                <Pressable
                  key={action}
                  onPress={() => runAction(action)}
                  accessibilityRole="button"
                  className="rounded-2xl px-4 py-3 items-center"
                  style={{
                    backgroundColor: primary ? accent.ink : 'transparent',
                    borderWidth: primary ? 0 : 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text
                    className="text-body font-semibold"
                    style={{ color: primary ? '#ffffff' : colors.text }}
                  >
                    {jobActionLabel(action)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export default JobProgressSheet;

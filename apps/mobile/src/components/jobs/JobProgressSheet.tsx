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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Linking, Modal, PanResponder, Pressable, Text, View } from 'react-native';
import { featureAccentsDark, featureAccentsLight, type FeatureKey } from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { AppIcon } from '../ui/AppIcon';
import { useJobsStore } from '../../stores/jobsStore';
import { JOB_TIME_BUDGET_MS, findJob, type JobKind } from '../../stores/jobsCore';
import {
  jobActionLabel,
  jobSheetState,
  shouldClaimSheetDrag,
  shouldDismissSheet,
  type JobSheetAction,
} from './jobSheetModel';
import { openJobResult } from './openJobResult';
import { retrySaveJob } from '../../services/jobArtifacts';
import { jobNotificationsReadiness, enableJobNotifications } from '../../services/pushNotifications';
import { PUSH_SENT_COPY, type PushReadiness } from '../../utils/pushDiagnostics';
import { syncService } from '../../services/syncService';

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

/** How often an open sheet re-reads the server record of its job. */
const SHEET_REFRESH_MS = 5_000;

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
  const dismissJob = useJobsStore((s) => s.dismissJob);
  const retryGenerate = useJobsStore((s) => s.retryGenerate);
  const refreshActiveJobs = useJobsStore((s) => s.refreshActiveJobs);
  const refreshJobPush = useJobsStore((s) => s.refreshJobPush);

  const job = sheetJobId ? findJob(jobs, sheetJobId) : undefined;
  const [now, setNow] = useState(() => Date.now());
  const [offline, setOffline] = useState(false);
  // Three answers, not two: "we could not ask the server" is not the same as
  // "notifications are off", and the button says something different for each.
  // Starts as `unknown`: until the OS and the status route have both answered,
  // the sheet has no grounds to promise a notification, and `unknown` is the
  // one label that neither promises nor accuses.
  const [notifications, setNotifications] = useState<PushReadiness>('unknown');

  /** Closing is unconditional: the sheet reports on work, it never holds it. */
  const close = useCallback(() => {
    const id = useJobsStore.getState().sheetJobId;
    if (id) useJobsStore.getState().stopWatching(id);
    // Even if the job vanished from the store between render and press, the
    // sheet goes away — the device run found one that only the hardware Back
    // key would close (F6).
    useJobsStore.getState().closeSheet();
  }, []);

  // The sheet is opened by a student who wants to know where the work got to,
  // so it asks the server rather than showing whatever was last cached — and
  // keeps asking while it is on screen. The in-process runner can be stuck on
  // a request the OS killed in the background; the sheet must not be stuck
  // with it, which is what left one sitting at "Saving your quiz" for four
  // minutes after the server had saved it (F6).
  useEffect(() => {
    if (!sheetJobId) return;
    void refreshActiveJobs();
    const timer = setInterval(() => void refreshActiveJobs(), SHEET_REFRESH_MS);
    return () => clearInterval(timer);
  }, [sheetJobId, refreshActiveJobs]);

  // Whether the bar is allowed to say "Waiting for connection…" rather than
  // "Still working…". Neither invents movement.
  useEffect(() => {
    if (!sheetJobId) return;
    let alive = true;
    const apply = (isOnline: boolean) => {
      if (alive) setOffline(!isOnline);
    };
    try {
      apply(syncService.getStatus().isOnline);
    } catch {
      // Sync not started yet; assume online until told otherwise.
    }
    const unsubscribe = syncService.onStatusChange((isOnline) => apply(isOnline));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [sheetJobId]);

  // Can this device be told when the job lands? If not, the sheet stops
  // promising it will be. Asked of the OS and of the server's status route,
  // never of the client's own settings copy.
  useEffect(() => {
    if (!sheetJobId) return;
    let alive = true;
    void jobNotificationsReadiness().then((readiness) => {
      if (alive) setNotifications(readiness);
    });
    return () => {
      alive = false;
    };
  }, [sheetJobId]);

  // A finished job: ask the server what it did about the push. This is the
  // only place that answer exists — the runner in this process settles the
  // job without ever reading its record, which is why a push that never
  // happened looked exactly like one that did.
  useEffect(() => {
    if (!sheetJobId) return;
    void refreshJobPush(sheetJobId);
  }, [sheetJobId, job?.status, refreshJobPush]);
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
      // A tap must still reach the buttons, so the sheet never claims a touch
      // on contact — only a movement.
      onStartShouldSetPanResponderCapture: () => false,
      // CAPTURE, not the bubbling form. Most of this sheet is Pressables, and
      // a Pressable becomes the responder the moment a finger lands on it: the
      // parent is then never asked, which is why the sheet could not be swiped
      // away at all once the drag began on a button (D6). The capture handler
      // is consulted on every move regardless of who holds the responder, and
      // the slop in shouldClaimSheetDrag is what keeps taps working.
      onMoveShouldSetPanResponderCapture: (_e, gesture) =>
        shouldClaimSheetDrag(gesture.dy, gesture.dx),
      onMoveShouldSetPanResponder: (_e, gesture) =>
        shouldClaimSheetDrag(gesture.dy, gesture.dx),
      onPanResponderMove: (_e, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_e, gesture) => {
        if (shouldDismissSheet(gesture.dy)) {
          const id = useJobsStore.getState().sheetJobId;
          if (id) useJobsStore.getState().stopWatching(id);
          useJobsStore.getState().closeSheet();
          return;
        }
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      },
      // A gesture the OS takes away (the Modal's own back handling, a system
      // sheet) leaves the card wherever it was dragged to; put it back.
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  if (!job) return null;

  const state = jobSheetState(job, now, budgetMs, { offline, notifications });
  const accent = (isDark ? featureAccentsDark : featureAccentsLight)[featureKeyForJob(job.kind)];

  const runAction = (action: JobSheetAction) => {
    switch (action) {
      case 'stop-watching':
        close();
        break;
      case 'keep-waiting':
        setBudgetMs((ms) => ms + JOB_TIME_BUDGET_MS);
        // Still waiting means still asking: the budget moves, and so does the
        // question to the server.
        void refreshActiveJobs();
        break;
      case 'enable-notifications':
        void enableJobNotifications().then(async (enabled) => {
          // Registering is not the same as being reachable: re-ask both
          // sources rather than assuming the button worked.
          setNotifications(await jobNotificationsReadiness());
          // A hard refusal can only be undone in the system settings.
          if (!enabled) void Linking.openSettings().catch(() => undefined);
        });
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
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View className="flex-1 justify-end">
        {/* Tapping outside stops WATCHING, never the work. */}
        <Pressable
          className="flex-1"
          accessibilityLabel="Stop watching this generation"
          onPress={close}
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

          {/* What the server did about the notification for this job. One
              line, in plain words, and only when the record actually says. */}
          {state.pushNote ? (
            <View className="mt-4 flex-row items-center gap-2">
              <AppIcon
                name={state.pushNote === PUSH_SENT_COPY ? 'checkmark-circle' : 'information-circle'}
                size={14}
                color={colors.textTertiary}
              />
              <Text className="text-caption text-lantern-text-secondary flex-1">
                {state.pushNote}
              </Text>
            </View>
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
                    {jobActionLabel(action, { notifications })}
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

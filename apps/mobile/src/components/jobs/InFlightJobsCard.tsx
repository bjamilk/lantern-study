/**
 * "Making your study materials" — the Home card that lists generations.
 *
 * The in-app half of Wave G's delivery promise. A notification can be denied,
 * missed or swiped away, so the running and recently finished jobs also have a
 * permanent place on Home with their stage, and a failed one has a Try again
 * right there. StudyFetch's equivalent (the web Creation Progress tray) is the
 * surface that reported a video complete that never played; this one shows
 * exactly what the store knows and nothing more.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { featureAccentsDark, featureAccentsLight } from '@lantern/shared/design';
import { useTheme } from '../../theme';
import { Card } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useAuthStore } from '../../stores/authStore';
import { useJobsStore } from '../../stores/jobsStore';
import { planRetry, visibleJobs, type TrackedJob } from '../../stores/jobsCore';
import { jobActionLabel, jobSheetState } from './jobSheetModel';
import { featureKeyForJob } from './JobProgressSheet';
import { openJobResult } from './openJobResult';
import { retrySaveJob } from '../../services/jobArtifacts';

interface Props {
  className?: string;
}

export function InFlightJobsCard({ className }: Props) {
  const { colors, isDark } = useTheme();
  const userId = useAuthStore((s) => s.user?.id);
  const jobs = useJobsStore((s) => s.jobs);
  const hydrate = useJobsStore((s) => s.hydrate);
  const openSheet = useJobsStore((s) => s.openSheet);
  const dismissJob = useJobsStore((s) => s.dismissJob);
  const retryGenerate = useJobsStore((s) => s.retryGenerate);
  const refreshActiveJobs = useJobsStore((s) => s.refreshActiveJobs);
  const refreshJobPush = useJobsStore((s) => s.refreshJobPush);
  const [now, setNow] = useState(() => Date.now());

  // Home is the app's initial route, so this is where persisted jobs are
  // reattached on a cold start — a generation that was running when the phone
  // killed the app is polled back to a real answer here.
  useEffect(() => {
    if (userId) void hydrate(userId);
  }, [userId, hydrate]);

  const shown = visibleJobs(jobs, now);
  const hasRunning = shown.some((j) => j.status === 'queued' || j.status === 'running');

  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasRunning]);

  // Home is also where a job that finished in the background is first seen
  // again, so this is a second catch-up point beyond the foreground one.
  useEffect(() => {
    if (hasRunning) void refreshActiveJobs();
  }, [hasRunning, refreshActiveJobs]);

  // Whether the server actually notified this phone is only knowable from the
  // job record, and only for a settled job. Read it once per card so a
  // finished row can say which of the two things happened.
  const settledIds = shown
    .filter((j) => j.status !== 'queued' && j.status !== 'running' && !j.pushAudit)
    .map((j) => j.id)
    .join(',');
  useEffect(() => {
    if (!settledIds) return;
    for (const id of settledIds.split(',')) void refreshJobPush(id);
  }, [settledIds, refreshJobPush]);

  if (shown.length === 0) return null;

  const renderRow = (job: TrackedJob) => {
    const state = jobSheetState(job, now);
    const accent = (isDark ? featureAccentsDark : featureAccentsLight)[featureKeyForJob(job.kind)];
    const running = state.tone === 'running';
    const dotColor =
      state.tone === 'failed' ? colors.error : state.tone === 'done' ? colors.success : accent.ink;

    return (
      <Pressable
        key={job.id}
        onPress={() => (running ? openSheet(job.id) : undefined)}
        className="flex-row items-center gap-3 py-2.5 border-t border-lantern-border"
        accessibilityRole={running ? 'button' : undefined}
      >
        <View
          className="h-9 w-9 rounded-full items-center justify-center"
          style={{ backgroundColor: accent.tint }}
        >
          <AppIcon
            name={
              state.tone === 'failed'
                ? 'alert-circle'
                : state.tone === 'done'
                  ? 'checkmark-circle'
                  : 'time'
            }
            size={18}
            color={dotColor}
          />
        </View>

        <View className="flex-1 min-w-0">
          <Text className="text-body font-semibold text-lantern-text" numberOfLines={1}>
            {state.headline}
          </Text>
          {/* Three lines, not two: the "we lost track of this one" line was
              cut mid-word at two ("check your library bef…"), which is the
              half of the sentence that says what to do. */}
          <Text className="text-caption text-lantern-text-secondary" numberOfLines={3}>
            {running ? `${state.detail} · ${state.percent}% · ${state.elapsedLabel}` : state.detail}
          </Text>
          {/* Whether a push about this actually went out. Absent on records
              the server never audited, and then nothing is claimed. */}
          {!running && state.pushNote ? (
            <Text className="text-label text-lantern-text-tertiary mt-0.5" numberOfLines={2}>
              {state.pushNote}
            </Text>
          ) : null}
        </View>

        {state.tone === 'done' ? (
          <Pressable
            onPress={() => {
              void openJobResult(job);
              dismissJob(job.id);
            }}
            className="px-3 py-1.5 rounded-full"
            style={{ backgroundColor: accent.tint }}
          >
            <Text className="text-label" style={{ color: accent.ink }}>
              Open
            </Text>
          </Pressable>
        ) : null}

        {state.tone === 'failed' && planRetry(job) !== 'none' ? (
          <Pressable
            onPress={() => {
              // Whichever half is missing: the save, when the material is
              // still held (free), otherwise the generation itself.
              if (planRetry(job) === 'save') {
                void retrySaveJob(job.id).catch(() => undefined);
                return;
              }
              if (!retryGenerate(job.id)) dismissJob(job.id);
            }}
            className="px-3 py-1.5 rounded-full"
            style={{ backgroundColor: accent.tint }}
          >
            <Text className="text-label" style={{ color: accent.ink }}>
              {jobActionLabel(planRetry(job) === 'save' ? 'save-to-library' : 'retry')}
            </Text>
          </Pressable>
        ) : null}

        {/* Every finished card can be cleared. Two "We lost track of this
            one" cards from an earlier build sat on Home with no way to remove
            them (F9); a card the student has read is theirs to dismiss. */}
        {!running ? (
          <Pressable
            onPress={() => dismissJob(job.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${state.headline}`}
            className="h-8 w-8 items-center justify-center rounded-full"
          >
            <AppIcon name="close" size={16} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </Pressable>
    );
  };

  return (
    <Card className={className ?? 'mb-4'}>
      <View className="flex-row items-center gap-2 pb-1">
        <AppIcon name="sparkles" size={16} color={colors.textSecondary} />
        <Text className="text-label text-lantern-text-secondary">
          {hasRunning ? 'MAKING YOUR STUDY MATERIALS' : 'RECENTLY MADE'}
        </Text>
      </View>
      {shown.map(renderRow)}
    </Card>
  );
}

export default InFlightJobsCard;

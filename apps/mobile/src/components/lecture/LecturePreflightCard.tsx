/**
 * The card a student sees while a lecture is being recorded into a note.
 *
 * Three rows, each one a reading rather than a reassurance: the microphone
 * permission as the OS reports it, the actual input level off the recorder's
 * metering, and whether we are online. Every word on it comes from
 * `lecturePreflight.ts`, which is tested; this file is the drawing.
 *
 * The one thing it will not do is claim a state it has not measured. Before
 * the first metering callback the level says "No signal yet" and the bar is
 * empty — a fake "Audio quality: great" over a blocked microphone is the
 * exact failure this card exists to avoid.
 */
import React, { useEffect } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { featureAccentsDark, featureAccentsLight } from '@lantern/shared/design';
import { useTheme, withAlpha } from '../../theme';
import { Card } from '../ui';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { Body, Caption, Label } from '../ui/Text';
import { useNetworkStatus } from '../../hooks';
import { hasLectureForegroundService } from '../../../modules/lecture-recording-service';
import {
  getSessionElapsedMs,
  useLectureRecordingStore,
} from '../../stores/lectureRecordingStore';
import {
  LECTURE_CONSENT_LINE,
  levelBarFraction,
  preflightRows,
  type PreflightRow,
  type PreflightTone,
} from './lecturePreflight';

const ROW_ICONS: Record<string, AppIconName> = {
  Microphone: 'mic',
  Level: 'volume-medium',
  Cost: 'sparkles',
  Length: 'time',
  Screen: 'phone-portrait',
  Connection: 'wifi',
};

export function LecturePreflightCard() {
  const { colors, isDark } = useTheme();
  const accent = (isDark ? featureAccentsDark : featureAccentsLight).notes;

  const micPermission = useLectureRecordingStore((s) => s.micPermission);
  const meterDb = useLectureRecordingStore((s) => s.meterDb);
  const refreshMicPermission = useLectureRecordingStore((s) => s.refreshMicPermission);
  const status = useLectureRecordingStore((s) => s.status);
  const startedAt = useLectureRecordingStore((s) => s.startedAt);
  const pausedAt = useLectureRecordingStore((s) => s.pausedAt);
  const pausedTotalMs = useLectureRecordingStore((s) => s.pausedTotalMs);
  // The store already ticks once a second while recording; reading it here is
  // what moves the running cost estimate and the remaining-length row without
  // a second timer.
  const tick = useLectureRecordingStore((s) => s.tick);
  const network = useNetworkStatus();
  const isOnline = network.isConnected && network.isInternetReachable !== false;

  // Read the permission on mount and whenever the student comes back from the
  // settings app, so "Blocked" turns into "Allowed" without a restart.
  useEffect(() => {
    void refreshMicPermission();
  }, [refreshMicPermission]);

  void tick;
  // Whole minutes, so the two sentences that depend on length change once a
  // minute rather than jittering every second.
  const elapsedMs =
    status === 'recording'
      ? Math.floor(getSessionElapsedMs({ startedAt, pausedAt, pausedTotalMs }) / 60_000) * 60_000
      : 0;

  const rows = preflightRows({
    micPermission,
    meterDb,
    isOnline,
    elapsedMs,
    screenOffSurvives: hasLectureForegroundService,
  });

  const toneColor = (tone: PreflightTone): string => {
    if (tone === 'ok') return colors.success;
    if (tone === 'warn') return colors.warning;
    if (tone === 'blocked') return colors.error;
    return colors.textTertiary;
  };

  const openSettings = () => {
    void Linking.openSettings().catch(() => {
      // Nothing to fall back to; the row's sentence already says what to do.
    });
  };

  return (
    <Card variant="feature" feature="notes" title="Recording" icon="mic">
      <View className="gap-3">
        {rows.map((row: PreflightRow) => (
          <View key={row.label} className="flex-row items-start gap-3">
            <View
              className="w-6 h-6 rounded-full items-center justify-center"
              style={{ backgroundColor: accent.tint }}
            >
              <AppIcon name={ROW_ICONS[row.label] || 'mic'} size={14} color={accent.ink} />
            </View>
            <View className="flex-1 min-w-0">
              <View className="flex-row items-center gap-2">
                <Label tone="tertiary">{row.label}</Label>
                <Body style={{ color: toneColor(row.tone), fontWeight: '600' }}>{row.state}</Body>
              </View>
              {row.label === 'Level' ? <LevelBar db={meterDb} ink={accent.ink} /> : null}
              <Caption tone="secondary">{row.detail}</Caption>
              {row.action ? (
                <Pressable
                  onPress={openSettings}
                  accessibilityRole="button"
                  className="self-start mt-1 px-3 py-1.5 rounded-lantern-md active:opacity-80"
                  style={{ backgroundColor: accent.tint }}
                >
                  <Label style={{ color: accent.ink, fontWeight: '700' }}>{row.action.label}</Label>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
        <Caption tone="tertiary">{LECTURE_CONSENT_LINE}</Caption>
      </View>
    </Card>
  );
}

/**
 * The meter. Its width is a pure function of the last dB reading, so an empty
 * bar means "we have heard nothing", never "we have not looked".
 */
function LevelBar({ db, ink }: { db: number | null; ink: string }) {
  const fraction = levelBarFraction(db);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      className="h-2 rounded-full my-1 overflow-hidden"
      style={{ backgroundColor: withAlpha(ink, 0.15) }}
    >
      <View
        className="h-full rounded-full"
        style={{ width: `${Math.round(fraction * 100)}%`, backgroundColor: ink }}
      />
    </View>
  );
}

export default LecturePreflightCard;

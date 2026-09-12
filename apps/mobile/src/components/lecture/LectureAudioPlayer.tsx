import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import {
  LECTURE_AUDIO_SPEEDS,
  formatLectureAudioSpeed,
  formatLectureAudioTime,
  nextLectureAudioSpeed,
  type LectureAttachmentLike,
} from '@lantern/shared';
import { T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { refreshNoteAttachmentUrl } from '../../services/notes';

/**
 * The Audio tab of the lecture surface on the phone.
 *
 * Same contract as the web twin (`components/study/LectureAudioPlayer.tsx`):
 * the `fileUrl` saved on the attachment row was signed when the recording was
 * transcribed and storage caps every signed URL at 24 hours, so it is dead by
 * the next day. This mints a fresh one through
 * `GET /notes/:noteId/attachments/:id/url` before loading, keeps the stored URL
 * only as a fallback, and re-signs once more if the sound fails to load.
 *
 * What `expo-av` gives us here: play/pause, seek, duration, and a playback rate
 * (`setRateAsync` with pitch correction). `staysActiveInBackground` keeps a
 * lecture playing when the student leaves the app — the app is already built
 * with `UIBackgroundModes: ['audio']` and the Android foreground-service
 * permissions, so this is real rather than aspirational. What it does NOT give
 * us is a lock-screen / notification transport: expo-av writes no
 * now-playing metadata, so there are no OS play/pause controls. That needs a
 * different native module and is not something this file can fake.
 */
export interface LectureAudioPlayerProps {
  noteId: string;
  attachment: LectureAttachmentLike;
}

export function LectureAudioPlayer({ noteId, attachment }: LectureAudioPlayerProps) {
  const { colors } = useTheme();
  const soundRef = useRef<Audio.Sound | null>(null);
  const trackWidthRef = useRef(0);
  const resignedRef = useRef(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [speed, setSpeed] = useState<number>(1);

  const attachmentId = attachment.id;
  const storedUrl = (attachment.fileUrl ?? '').trim();

  const resign = useCallback(async (): Promise<string | null> => {
    if (!attachmentId) return null;
    try {
      const result = await refreshNoteAttachmentUrl(noteId, attachmentId);
      return result?.url || null;
    } catch {
      return null;
    }
  }, [noteId, attachmentId]);

  useEffect(() => {
    let cancelled = false;
    resignedRef.current = false;
    setFailed(false);
    setUrl(null);
    void (async () => {
      const fresh = await resign();
      if (cancelled) return;
      const next = fresh || storedUrl;
      if (next) setUrl(next);
      else setFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [resign, storedUrl]);

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (typeof status.durationMillis === 'number' && status.durationMillis > 0) {
      setDurationMs(status.durationMillis);
    }
    if (status.didJustFinish) {
      setPlaying(false);
      setPositionMs(0);
      void soundRef.current?.setPositionAsync(0);
      return;
    }
    setPositionMs(status.positionMillis ?? 0);
    setPlaying(status.isPlaying);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlaying(false);
    setPositionMs(0);
    setDurationMs(0);

    const previous = soundRef.current;
    soundRef.current = null;
    if (previous) void previous.unloadAsync();
    if (!url) return;

    const load = async (uri: string): Promise<boolean> => {
      try {
        // Keep playing when the phone goes to sleep or the student switches
        // apps — a 50-minute lecture is not something you sit and watch.
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          playThroughEarpieceAndroid: false,
        }).catch(() => undefined);
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false, progressUpdateIntervalMillis: 250, rate: speed, shouldCorrectPitch: true },
          onStatus
        );
        if (cancelled) {
          await sound.unloadAsync();
          return true;
        }
        soundRef.current = sound;
        return true;
      } catch {
        return false;
      }
    };

    void (async () => {
      if (await load(url)) return;
      if (cancelled || resignedRef.current) {
        if (!cancelled) setFailed(true);
        return;
      }
      resignedRef.current = true;
      const fresh = await resign();
      if (cancelled) return;
      if (!fresh || !(await load(fresh))) setFailed(true);
      else setUrl(fresh);
    })();

    return () => {
      cancelled = true;
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) void sound.unloadAsync();
    };
    // `speed` is applied through setRateAsync below, not by reloading the sound.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, onStatus, resign]);

  const toggle = async () => {
    const sound = soundRef.current;
    if (!sound) return;
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await sound.pauseAsync();
        return;
      }
      const total = status.durationMillis ?? durationMs;
      const atEnd =
        !!status.didJustFinish ||
        (typeof total === 'number' && total > 0 && (status.positionMillis ?? 0) >= total - 40);
      if (atEnd) await sound.playFromPositionAsync(0);
      else await sound.playAsync();
    } catch {
      setPlaying(false);
    }
  };

  const seekToRatio = async (ratio: number) => {
    const sound = soundRef.current;
    if (!sound || !(durationMs > 0)) return;
    const next = Math.max(0, Math.min(durationMs, Math.floor(ratio * durationMs)));
    // Stop just short of the tail so scrubbing to the end does not park the
    // player in the finished state.
    const clamped = next >= durationMs - 40 ? Math.max(0, durationMs - 40) : next;
    try {
      await sound.setPositionAsync(clamped);
      setPositionMs(clamped);
    } catch {
      // A failed seek is not worth an error state; the playhead just stays put.
    }
  };

  const nudgeSeconds = async (deltaSec: number) => {
    if (!(durationMs > 0)) return;
    await seekToRatio(Math.max(0, Math.min(durationMs, positionMs + deltaSec * 1000)) / durationMs);
  };

  const cycleSpeed = async () => {
    const next = nextLectureAudioSpeed(speed);
    setSpeed(next);
    try {
      await soundRef.current?.setRateAsync(next, true);
    } catch {
      // Rate changes are best-effort on older Android decoders.
    }
  };

  if (failed) {
    return (
      <View className="rounded-xl border border-lantern-border bg-lantern-surface p-3">
        <T.Body tone="secondary">
          This recording could not be opened. It may have been removed from storage.
        </T.Body>
      </View>
    );
  }

  if (!url) {
    return (
      <View className="rounded-xl border border-lantern-border bg-lantern-surface p-3">
        <T.Body tone="tertiary">Opening the recording…</T.Body>
      </View>
    );
  }

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <View className="gap-3 rounded-xl border border-lantern-border bg-lantern-surface p-3">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => void toggle()}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause the recording' : 'Play the recording'}
          className="items-center justify-center rounded-full"
          style={{ width: 44, height: 44, backgroundColor: colors.primary }}
        >
          <AppIcon name={playing ? 'pause' : 'play'} size={20} color="#ffffff" />
        </Pressable>
        <View className="flex-1" style={{ gap: 6 }}>
          <Pressable
            onLayout={(event) => {
              trackWidthRef.current = event.nativeEvent.layout.width;
            }}
            onPress={(event) => {
              const width = trackWidthRef.current;
              if (!(width > 0)) return;
              void seekToRatio(Math.max(0, Math.min(1, event.nativeEvent.locationX / width)));
            }}
            style={{ height: 20, justifyContent: 'center' }}
            accessibilityRole="adjustable"
            accessibilityLabel="Seek the recording"
            accessibilityValue={{
              min: 0,
              max: Math.round(durationMs / 1000),
              now: Math.round(positionMs / 1000),
            }}
            accessibilityActions={[
              { name: 'increment', label: 'Forward 10 seconds' },
              { name: 'decrement', label: 'Back 10 seconds' },
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'increment') void nudgeSeconds(10);
              else if (event.nativeEvent.actionName === 'decrement') void nudgeSeconds(-10);
            }}
          >
            <View
              style={{
                height: 6,
                borderRadius: 999,
                overflow: 'hidden',
                backgroundColor: colors.primaryBackground,
              }}
            >
              <View
                style={{
                  height: '100%',
                  width: `${progress * 100}%`,
                  borderRadius: 999,
                  backgroundColor: colors.primary,
                }}
              />
            </View>
          </Pressable>
          <View className="flex-row items-center justify-between">
            <T.Caption tone="secondary" tabular>
              {formatLectureAudioTime(positionMs / 1000)}
            </T.Caption>
            <T.Caption tone="secondary" tabular>
              {formatLectureAudioTime(durationMs / 1000)}
            </T.Caption>
          </View>
        </View>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <Pressable
          onPress={() => void cycleSpeed()}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${formatLectureAudioSpeed(speed)}`}
          className="min-h-[44px] justify-center rounded-full border border-lantern-border px-3"
        >
          <T.Body tabular>{formatLectureAudioSpeed(speed)}</T.Body>
        </Pressable>
        <T.Caption tone="tertiary">
          {LECTURE_AUDIO_SPEEDS.map(formatLectureAudioSpeed).join(' · ')}
        </T.Caption>
      </View>
      <T.Caption tone="tertiary">
        Playback keeps going when you leave the app. There are no lock-screen controls.
      </T.Caption>
    </View>
  );
}

export default LectureAudioPlayer;

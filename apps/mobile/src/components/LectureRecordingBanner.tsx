import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, useNavigation } from '@react-navigation/native';
import {
  formatRecordingDuration,
  getSessionElapsedMs,
  MIN_MOBILE_LECTURE_RECORD_MS,
  useLectureRecordingStore,
} from '../stores/lectureRecordingStore';
import { AppIcon, type AppIconName } from './ui/AppIcon';
import { LectureTitleSheet } from './lecture/LectureTitleSheet';

/**
 * Every button on this bar is the same pill, so the bar's type size is
 * written once. It was seven copies of `text-xs font-semibold` before, which
 * is how a bar drifts into three slightly different button sizes.
 */
function BannerButton({
  label,
  onPress,
  icon,
  tone = 'light',
  disabled,
}: {
  label: string;
  onPress: () => void;
  icon?: AppIconName;
  tone?: 'light' | 'dark';
  disabled?: boolean;
}) {
  const background = tone === 'light' ? 'bg-white/20 active:bg-white/30' : 'bg-black/20 active:bg-black/30';
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`flex-row items-center gap-1 px-2.5 py-1.5 rounded-lg ${background} ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      {icon ? <AppIcon name={icon} size={14} color="#fff" /> : null}
      <Text className="text-white text-xs font-semibold">{label}</Text>
    </Pressable>
  );
}

/**
 * Sticky global bar while a lecture recording/transcription session is active.
 * Survives leaving NoteEditor so users can stop from anywhere in the app.
 */
export function LectureRecordingBanner() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const status = useLectureRecordingStore((s) => s.status);
  const noteId = useLectureRecordingStore((s) => s.noteId);
  const noteTitle = useLectureRecordingStore((s) => s.noteTitle);
  const startedAt = useLectureRecordingStore((s) => s.startedAt);
  const tick = useLectureRecordingStore((s) => s.tick);
  const stopForTitle = useLectureRecordingStore((s) => s.stopForTitle);
  const discard = useLectureRecordingStore((s) => s.discard);
  const cancelTranscription = useLectureRecordingStore((s) => s.cancelTranscription);
  const retryTranscription = useLectureRecordingStore((s) => s.retryTranscription);
  const pauseRecording = useLectureRecordingStore((s) => s.pauseRecording);
  const resumeRecording = useLectureRecordingStore((s) => s.resumeRecording);
  const pausedAt = useLectureRecordingStore((s) => s.pausedAt);
  const pausedTotalMs = useLectureRecordingStore((s) => s.pausedTotalMs);
  const error = useLectureRecordingStore((s) => s.error);

  if (status === 'idle' || !noteId) return null;
  void tick;

  // Recorded seconds, pauses excluded — the same number the price is based on.
  const seconds =
    status === 'recording'
      ? Math.floor(getSessionElapsedMs({ startedAt, pausedAt, pausedTotalMs }) / 1000)
      : 0;
  const canStop = seconds * 1000 >= MIN_MOBILE_LECTURE_RECORD_MS;

  const openNote = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'StudyTab',
        params: {
          screen: 'NoteEditor',
          params: { noteId },
        },
      })
    );
  };

  const statusLabel =
    status === 'recording'
      ? `${pausedAt ? 'Paused' : 'Recording'} ${formatRecordingDuration(seconds)}`
      : status === 'naming'
        ? 'Recording stopped — name it'
        : status === 'failed'
          ? 'Transcription failed — the recording is safe'
          : status === 'uploading'
            ? 'Uploading lecture…'
            : 'Transcribing lecture…';

  return (
    <View
      // Laid out in flow above the tab navigator (see MainTabs), not absolutely
      // over it. As an overlay this bar sat exactly on top of whatever screen
      // header was showing and swallowed its back button, so a recording left
      // the user with no way out of the note. In flow it pushes the screen down
      // instead, and every header stays reachable.
      className="bg-red-600 px-3 py-2 flex-row items-center gap-2"
      style={{ paddingTop: insets.top + 8 }}
    >
      <Pressable onPress={openNote} className="flex-1 min-w-0 active:opacity-80">
        <Text className="text-white text-sm font-semibold" numberOfLines={1}>
          {statusLabel}
        </Text>
        <Text className="text-white/90 text-xs" numberOfLines={2}>
          {status === 'failed'
            ? // The reason, then the promise. A student who has just lost a
              // transcription needs to know the audio is still here before
              // anything else. It does NOT say "nothing was charged": the
              // server refunds a failed request itself, but a client-side
              // timeout on a long lecture can fail here while the server is
              // still working — and this bar cannot see which happened.
              `${error || 'Could not transcribe.'} The audio is still here — tap Retry.`
            : `${noteTitle || 'Untitled note'} · Tap to return`}
        </Text>
      </Pressable>
      {status === 'recording' ? (
        <>
          {/* Resume appends into the same file, so an interrupted lecture
              stays one recording — and one charge. */}
          <BannerButton
            icon={pausedAt ? 'play' : 'pause'}
            onPress={() => void (pausedAt ? resumeRecording() : pauseRecording())}
            label={pausedAt ? 'Resume' : 'Pause'}
          />
          <BannerButton
            disabled={!canStop}
            onPress={() => void stopForTitle()}
            icon="stop"
            label={canStop ? 'Stop' : `${Math.max(0, 2 - seconds)}s`}
          />
          <BannerButton tone="dark" onPress={() => void discard()} label="Discard" />
        </>
      ) : status === 'naming' ? null : status === 'failed' ? (
        <>
          {/* Retrying spends nothing until the upload actually lands, so this
              is a free second attempt rather than a second charge. */}
          <BannerButton icon="refresh" onPress={() => void retryTranscription()} label="Retry" />
          {/* The only button in the app that deletes a recording. */}
          <BannerButton tone="dark" onPress={() => void discard()} label="Discard" />
        </>
      ) : (
        <BannerButton tone="dark" onPress={() => cancelTranscription()} label="Cancel" />
      )}
      {/* Mounted from the banner, not the editor: the stop that opens it can
          come from any screen. */}
      <LectureTitleSheet />
    </View>
  );
}

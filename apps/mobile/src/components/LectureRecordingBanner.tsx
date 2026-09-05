import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, useNavigation } from '@react-navigation/native';
import {
  formatRecordingDuration,
  getElapsedRecordingSeconds,
  MIN_MOBILE_LECTURE_RECORD_MS,
  useLectureRecordingStore,
} from '../stores/lectureRecordingStore';
import { AppIcon } from './ui/AppIcon';

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
  const stopAndTranscribe = useLectureRecordingStore((s) => s.stopAndTranscribe);
  const discard = useLectureRecordingStore((s) => s.discard);
  const cancelTranscription = useLectureRecordingStore((s) => s.cancelTranscription);

  if (status === 'idle' || !noteId) return null;
  void tick;

  const seconds = status === 'recording' ? getElapsedRecordingSeconds(startedAt) : 0;
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
      ? `Recording ${formatRecordingDuration(seconds)}`
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
        <Text className="text-white/90 text-xs" numberOfLines={1}>
          {noteTitle || 'Untitled note'} · Tap to return
        </Text>
      </Pressable>
      {status === 'recording' ? (
        <>
          <Pressable
            disabled={!canStop}
            onPress={() => void stopAndTranscribe()}
            className={`flex-row items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/20 ${
              canStop ? 'active:bg-white/30' : 'opacity-50'
            }`}
          >
            <AppIcon name="stop" size={14} color="#fff" />
            <Text className="text-white text-xs font-semibold">
              {canStop ? 'Stop' : `${Math.max(0, 2 - seconds)}s`}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void discard()}
            className="px-2.5 py-1.5 rounded-lg bg-black/20 active:bg-black/30"
          >
            <Text className="text-white text-xs font-semibold">Discard</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={() => cancelTranscription()}
          className="px-2.5 py-1.5 rounded-lg bg-black/20 active:bg-black/30"
        >
          <Text className="text-white text-xs font-semibold">Cancel</Text>
        </Pressable>
      )}
    </View>
  );
}

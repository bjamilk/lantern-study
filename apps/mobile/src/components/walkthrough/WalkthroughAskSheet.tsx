/**
 * "Ask about this page" — typed, or spoken in fifteen seconds.
 *
 * Two rules shape the whole sheet.
 *
 * 1. The composer is always there. Voice is the shortcut, never the only door:
 *    a student with no signal, no mic permission, or a server that does not
 *    accept spoken questions yet can still type and still get an answer.
 * 2. A spoken question must never be billed as a lecture. `/transcribe-audio`
 *    prices by duration today, so sending a clip before the AI lane accepts
 *    the `voice_ask` key would charge a fifteen-second question at the
 *    recording rate. So the mic is not offered on a hunch: the sheet reads the
 *    server's OWN feature rows (`/ai/usage`) and looks for `voice_ask`. Absent
 *    → no recorder, and a line saying to type instead. That is the degradation
 *    the lane asks for, done by measuring rather than by hoping.
 *
 * The transcript lands in the composer rather than being sent: a misheard
 * question is the student's to fix before it costs anything.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Body, Button, Caption, Title } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { useScreenBottomPadding } from '../layout/Screen';
import { fetchAIUsageDetail } from '../../services/ai';
import { transcribeVoiceQuestion } from '../../services/notes';
import { requestFailureSentence } from '@lantern/shared/network';
import {
  formatClipSeconds,
  MAX_VOICE_ASK_MS,
  VOICE_ASK_FEATURE_KEY,
  voiceAskAvailability,
} from './walkthroughModel';

/** Longest typed question. A question, not an essay. */
const MAX_QUESTION_CHARS = 500;

type VoiceState = 'idle' | 'recording' | 'transcribing';

export function WalkthroughAskSheet({
  visible,
  pageLabel,
  hasPageText,
  onAsk,
  onClose,
}: {
  visible: boolean;
  /** "Page 4" or "Page 4 · Loop of Henle" — what the student is looking at. */
  pageLabel: string;
  /** False on a blank page: the answer will be general, and the sheet says so. */
  hasPageText: boolean;
  onAsk: (question: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const bottomPadding = useScreenBottomPadding();
  const [question, setQuestion] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  /**
   * `null` = not asked yet. Three states, not two: the mic must not flicker
   * into view because a "false" default was rendered before the answer came.
   */
  const [voiceAccepted, setVoiceAccepted] = useState<boolean | null>(null);
  /**
   * True only when the OS says the mic is DENIED. Not "not yet granted": the
   * recorder asks on the first press, and a button hidden before anyone was
   * asked is a feature the student never finds.
   */
  const [micBlocked, setMicBlocked] = useState(false);

  const recordingRef = useRef<{ stopAndUnloadAsync: () => Promise<void>; getURI: () => string | null } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  /**
   * Does this server take a spoken question yet?
   *
   * One read per opening, and a failure answers "no" — the safe direction:
   * the student types, and nobody is charged a lecture for a sentence.
   */
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await fetchAIUsageDetail();
        const accepted = (snapshot.features ?? []).some(
          (row) => row.feature === VOICE_ASK_FEATURE_KEY
        );
        if (!cancelled) setVoiceAccepted(accepted);
      } catch {
        if (!cancelled) setVoiceAccepted(false);
      }
      try {
        const { Audio } = await import('expo-av');
        const perm = await Audio.getPermissionsAsync();
        if (!cancelled) setMicBlocked(perm?.status === 'denied' && perm?.canAskAgain === false);
      } catch {
        if (!cancelled) setMicBlocked(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    clearTimer();
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!rec) return null;
    try {
      await rec.stopAndUnloadAsync();
      return rec.getURI();
    } catch {
      return null;
    }
  }, []);

  // A sheet that closes mid-clip must not leave the microphone open behind it.
  useEffect(() => {
    if (visible) return;
    clearTimer();
    setVoiceState('idle');
    setElapsedMs(0);
    void stopRecording();
  }, [visible, stopRecording]);

  useEffect(() => () => { clearTimer(); void stopRecording(); }, [stopRecording]);

  const finishClip = useCallback(async () => {
    setVoiceState('transcribing');
    const uri = await stopRecording();
    const durationMs = Math.min(Date.now() - startedAtRef.current, MAX_VOICE_ASK_MS);
    setElapsedMs(0);
    if (!uri) {
      setVoiceState('idle');
      setVoiceError('That clip did not record. Type your question instead.');
      return;
    }
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
      });
      if (!base64 || base64.length < 64) {
        setVoiceError('The clip was empty. Hold the button a little longer.');
        return;
      }
      const result = await transcribeVoiceQuestion(base64, {
        mimeType: uri.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/m4a',
        durationMs,
        featureKey: VOICE_ASK_FEATURE_KEY,
      });
      const transcript = (result?.transcript || '').trim();
      if (!transcript) {
        setVoiceError('Nothing was heard in that clip. Try again, or type your question.');
      } else {
        // Into the composer, not into a send: the student reads what was
        // heard, fixes it if it is wrong, and only then spends anything.
        setQuestion((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript).slice(0, MAX_QUESTION_CHARS));
      }
    } catch (error) {
      // The server's own sentence never reaches the student here either: the
      // same failure vocabulary the rest of the app speaks, plus what to do.
      setVoiceError(requestFailureSentence(error));
    } finally {
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      setVoiceState('idle');
    }
  }, [stopRecording]);

  const startClip = useCallback(async () => {
    setVoiceError(null);
    try {
      const { Audio } = await import('expo-av');
      const permission = await Audio.requestPermissionsAsync();
      setMicBlocked(permission?.status === 'denied' && permission?.canAskAgain === false);
      if (!permission?.granted) {
        setVoiceError('Microphone access is off for Lantern Study.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording as unknown as {
        stopAndUnloadAsync: () => Promise<void>;
        getURI: () => string | null;
      };
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setVoiceState('recording');
      clearTimer();
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        // Stop at the cap ourselves. A question is a sentence; a student who
        // keeps talking is stopped with the reason visible rather than
        // paying to transcribe a minute of it.
        if (elapsed >= MAX_VOICE_ASK_MS) void finishClip();
      }, 250);
    } catch (error) {
      setVoiceState('idle');
      // A device fault, not a request: expo-av's own wording is no use to a
      // student, so it is logged nowhere and said plainly here.
      setVoiceError('The recorder could not start. Type your question instead.');
    }
  }, [finishClip]);

  const voice = voiceAskAvailability({
    voiceAccepted: voiceAccepted === true,
    hasPermission: !micBlocked,
  });
  const trimmed = question.trim();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable className="flex-1" accessibilityLabel="Close ask" onPress={onClose} />
        <View className="rounded-t-3xl bg-lantern-background px-4 pt-4" style={{ paddingBottom: bottomPadding + 12 }}>
          <View className="flex-row items-center justify-between mb-1">
            <Title>Ask about this page</Title>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} className="p-2">
              <AppIcon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Caption tone="secondary" className="mb-3">
            {hasPageText
              ? `${pageLabel}. This page is sent with your question.`
              : `${pageLabel} has no readable text, so the answer will be general.`}
          </Caption>

          <TextInput
            className="w-full px-3 py-3 rounded-lantern-xl border border-lantern-border bg-lantern-surface text-lantern-text"
            placeholder="What do you want explained?"
            placeholderTextColor={colors.textTertiary}
            value={question}
            onChangeText={setQuestion}
            maxLength={MAX_QUESTION_CHARS}
            multiline
            style={{ minHeight: 84, textAlignVertical: 'top' }}
            accessibilityLabel="Your question"
          />

          {voiceAccepted === null ? null : voice.canRecord ? (
            <Pressable
              onPress={() => (voiceState === 'recording' ? void finishClip() : void startClip())}
              disabled={voiceState === 'transcribing'}
              accessibilityRole="button"
              accessibilityLabel={
                voiceState === 'recording' ? 'Stop recording your question' : 'Record your question'
              }
              className={`mt-3 flex-row items-center gap-2 px-3 py-2.5 rounded-lantern-xl border ${
                voiceState === 'recording'
                  ? 'border-lantern-error bg-lantern-surface'
                  : 'border-lantern-border bg-lantern-surface'
              } ${voiceState === 'transcribing' ? 'opacity-50' : ''}`}
            >
              {voiceState === 'transcribing' ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <AppIcon
                  name={voiceState === 'recording' ? 'stop' : 'mic'}
                  size={18}
                  color={voiceState === 'recording' ? colors.error : colors.text}
                />
              )}
              <Body importantForAccessibility="no">
                {voiceState === 'recording'
                  ? `Stop · ${formatClipSeconds(elapsedMs)}`
                  : voiceState === 'transcribing'
                    ? 'Writing down your question…'
                    : 'Say it instead'}
              </Body>
              {voiceState === 'idle' ? (
                <Caption tone="secondary" importantForAccessibility="no">
                  {`up to ${Math.round(MAX_VOICE_ASK_MS / 1000)}s`}
                </Caption>
              ) : null}
            </Pressable>
          ) : (
            <Caption tone="secondary" className="mt-3">
              {voice.reason}
            </Caption>
          )}

          {voiceError ? (
            <Caption tone="secondary" className="mt-2" style={{ color: colors.error }}>
              {voiceError}
            </Caption>
          ) : null}

          <View className="flex-row justify-end gap-2 mt-4">
            <Button variant="ghost" size="sm" onPress={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={trimmed.length === 0 || voiceState !== 'idle'}
              onPress={() => {
                onAsk(trimmed);
                setQuestion('');
              }}
            >
              Ask
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default WalkthroughAskSheet;

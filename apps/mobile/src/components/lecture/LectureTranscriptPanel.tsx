/**
 * The phone's TRANSCRIPT surface — the web drawer, folded into a tab.
 *
 * A phone has no room for a 236px column beside the notes, so the drawer
 * becomes the Record/Transcript tab and the minimised widget becomes a compact
 * bar above the tab strip (`LectureRecordingBar`, below). Everything else is
 * the same: the same state machine (`lectureDrawerReducer`), the same chunk
 * cards with their mono stamps, the same consent card after the pre-flight, the
 * same black recording pill with the level, the clock and the red stop.
 *
 * Nothing here records anything. Capture, segments and upload belong to
 * `stores/lectureRecordingStore`; this file draws what that store is doing.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import {
  formatLectureClock,
  lectureChunkStampMs,
  lectureDrawerCopy,
  type LectureChunk,
  type LectureDrawerModel,
} from '@lantern/shared';
import { useTheme } from '../../theme';
import { AppIcon } from '../ui/AppIcon';
import { Body, Caption, Heading, Label } from '../ui/Text';

export interface LectureTranscriptPanelProps {
  drawer: LectureDrawerModel;
  chunks: LectureChunk[];
  /** The take is over: the stamps become END times. */
  sealed: boolean;
  elapsedMs: number;
  enhancing?: boolean;
  onConsent: (granted: boolean) => void;
  onStop: () => void;
  onResume: () => void;
  onEnhance: () => void;
  enhanceCost?: string;
  /** The pre-flight card + Start button the screen already renders. */
  precheck?: React.ReactNode;
}

export function LectureTranscriptPanel({
  drawer,
  chunks,
  sealed,
  elapsedMs,
  enhancing,
  onConsent,
  onStop,
  onResume,
  onEnhance,
  enhanceCost,
  precheck,
}: LectureTranscriptPanelProps) {
  const { colors } = useTheme();

  if (drawer.step === 'precheck') {
    return <View className="gap-3">{precheck}</View>;
  }

  if (drawer.step === 'consent') {
    return (
      <View className="gap-3 rounded-xl border border-lantern-border bg-lantern-surface p-4">
        <Heading>{lectureDrawerCopy.consentTitle}</Heading>
        <Body tone="secondary">{lectureDrawerCopy.consentBody}</Body>
        <Pressable
          onPress={() => onConsent(true)}
          accessibilityRole="button"
          accessibilityLabel={lectureDrawerCopy.consentYes}
          className="min-h-[44px] items-center justify-center rounded-full bg-lantern-primary"
        >
          <Body style={{ color: '#ffffff', fontWeight: '600' }}>
            {lectureDrawerCopy.consentYes}
          </Body>
        </Pressable>
        <Pressable
          onPress={() => onConsent(false)}
          accessibilityRole="button"
          accessibilityLabel={lectureDrawerCopy.consentNo}
          className="min-h-[44px] items-center justify-center rounded-full border border-lantern-border bg-lantern-surface"
        >
          <Body>{lectureDrawerCopy.consentNo}</Body>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-3">
      <View style={{ gap: 8 }}>
        {chunks.map((chunk) => (
          <View key={chunk.id} className="flex-row" style={{ gap: 8 }}>
            <Caption tone="secondary" tabular style={{ width: 40, paddingTop: 8 }}>
              {formatLectureClock(lectureChunkStampMs(chunk, sealed))}
            </Caption>
            <View className="flex-1 rounded-xl bg-lantern-feature-notes-tint p-2">
              <Body>{chunk.text}</Body>
            </View>
          </View>
        ))}
      </View>

      {drawer.step === 'recording' ? (
        <Caption style={{ color: colors.success, fontWeight: '600' }}>
          {lectureDrawerCopy.listening}
        </Caption>
      ) : null}

      {drawer.step === 'saving' ? (
        <View className="rounded-xl border border-lantern-border bg-lantern-surface p-3">
          <Body style={{ fontWeight: '600' }}>{lectureDrawerCopy.savingTitle}</Body>
          <Caption tone="secondary">{lectureDrawerCopy.savingBody}</Caption>
        </View>
      ) : null}

      {drawer.step === 'done' ? (
        <View className="gap-3">
          <View className="rounded-xl border border-lantern-border bg-lantern-surface p-3">
            <Body style={{ fontWeight: '600' }}>{lectureDrawerCopy.doneTitle}</Body>
            <Pressable
              onPress={onEnhance}
              disabled={enhancing}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(enhancing) }}
              className="mt-2 min-h-[44px] items-center justify-center rounded-full bg-lantern-primary"
              style={enhancing ? { opacity: 0.5 } : undefined}
            >
              <Body style={{ color: '#ffffff', fontWeight: '600' }}>
                {enhancing
                  ? '⟳ Generating…'
                  : `✨ Enhance notes${enhanceCost ? ` · ${enhanceCost}` : ''}`}
              </Body>
            </Pressable>
          </View>
          <Pressable
            onPress={onResume}
            accessibilityRole="button"
            accessibilityLabel="Resume recording"
            className="min-h-[44px] items-center justify-center rounded-full border border-lantern-border bg-lantern-surface"
          >
            <Body>🎙 {lectureDrawerCopy.resume}</Body>
          </Pressable>
        </View>
      ) : null}

      {drawer.step === 'recording' ? (
        <LectureRecordingPill elapsedMs={elapsedMs} onStop={onStop} />
      ) : null}
    </View>
  );
}

/** The black pill: the clock and the red stop, 46px tall like the web's. */
export function LectureRecordingPill({
  elapsedMs,
  onStop,
}: {
  elapsedMs: number;
  onStop: () => void;
}) {
  return (
    <View className="h-[46px] w-[176px] flex-row items-center justify-between rounded-full bg-lantern-primary px-3">
      <Body tabular style={{ color: '#ffffff' }}>
        {formatLectureClock(elapsedMs)}
      </Body>
      <Pressable
        onPress={onStop}
        accessibilityRole="button"
        accessibilityLabel={lectureDrawerCopy.stop}
        className="h-8 w-8 items-center justify-center rounded-full bg-lantern-error"
      >
        <AppIcon name="stop" size={16} color="#ffffff" />
      </Pressable>
    </View>
  );
}

/**
 * The minimised widget's phone shape: a compact bar above the tab strip, so a
 * student typing notes still has the clock and the stop button without leaving
 * the pane they are writing in.
 */
export function LectureRecordingBar({
  elapsedMs,
  qualityLabel,
  onStop,
  onExpand,
}: {
  elapsedMs: number;
  qualityLabel?: string;
  onStop: () => void;
  onExpand: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2 rounded-xl bg-lantern-primary px-3 py-2">
      <Label style={{ color: '#ffffff' }}>{qualityLabel ?? 'Recording'}</Label>
      <Body tabular style={{ color: '#ffffff' }}>
        {formatLectureClock(elapsedMs)}
      </Body>
      <Pressable
        onPress={onStop}
        accessibilityRole="button"
        accessibilityLabel={lectureDrawerCopy.stop}
        className="ml-auto h-8 w-8 items-center justify-center rounded-full bg-lantern-error"
      >
        <AppIcon name="stop" size={14} color="#ffffff" />
      </Pressable>
      <Pressable
        onPress={onExpand}
        accessibilityRole="button"
        accessibilityLabel={lectureDrawerCopy.expand}
        className="h-8 w-8 items-center justify-center rounded-full"
      >
        <AppIcon name="expand" size={14} color="#ffffff" />
      </Pressable>
    </View>
  );
}

export default LectureTranscriptPanel;

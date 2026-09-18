import React from 'react';
import { Pressable, View } from 'react-native';
import {
  lectureSegmentLabel,
  lectureSegmentsSummaryLine,
} from '@lantern/shared/utils/lectureSegments';
import type { LectureAttachmentLike } from '@lantern/shared';
import type { LectureSegmentUi } from '../../stores/lectureRecordingStore';
import { T } from '../ui';
import { LectureAudioPlayer } from './LectureAudioPlayer';

/**
 * The two lists a segmented lecture grows on the phone: its transcript and its
 * audio. The web twin is `components/study/LectureSegmentList.tsx`, and the two
 * say the same sentences on purpose — a student who records on the phone and
 * reads on the laptop must not be told two different stories about the same
 * lecture.
 *
 * The sentence that matters most is on a card that failed: "the audio is
 * saved". A student who reads "this part did not transcribe" and cannot tell
 * whether the recording survived has been told nothing useful, and on a phone
 * that the OS killed mid-lecture it is the only thing they want to know.
 */

const STATUS_LINE: Record<LectureSegmentUi['status'], string> = {
  uploading: 'Saving this part…',
  transcribing: 'Transcribing…',
  done: '',
  failed: '',
};

export interface LectureTranscriptSegmentsProps {
  segments: LectureSegmentUi[];
  /** The phone's own live captions, for the segment still being recorded. */
  liveCaptions?: string;
  recording?: boolean;
  onRetry?: (seq: number) => void;
}

export function LectureTranscriptSegments({
  segments,
  liveCaptions,
  recording,
  onRetry,
}: LectureTranscriptSegmentsProps) {
  const captions = (liveCaptions ?? '').trim();
  return (
    <View style={{ gap: 8 }}>
      {segments.map((segment) => (
        <View
          key={segment.seq}
          className="rounded-xl border border-lantern-border bg-lantern-surface p-3"
          style={{ gap: 4 }}
        >
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <T.Caption tone="secondary" tabular>
              {segment.stamp}
            </T.Caption>
            {segment.status === 'uploading' || segment.status === 'transcribing' ? (
              <T.Caption tone="tertiary">{STATUS_LINE[segment.status]}</T.Caption>
            ) : null}
          </View>
          {segment.status === 'done' ? (
            <T.Body>{segment.transcript || 'Nothing was said in this part.'}</T.Body>
          ) : segment.status === 'failed' ? (
            <View style={{ gap: 6 }}>
              <T.Body tone="secondary">
                This part did not transcribe. The audio is saved — nothing is lost.
              </T.Body>
              {segment.error ? <T.Caption tone="tertiary">{segment.error}</T.Caption> : null}
              {onRetry ? (
                <Pressable
                  onPress={() => onRetry(segment.seq)}
                  accessibilityRole="button"
                  accessibilityLabel={`Retry transcribing the part at ${segment.stamp}`}
                  className="min-h-[44px] justify-center self-start rounded-full border border-lantern-border px-3"
                >
                  <T.Body>Retry</T.Body>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <T.Body tone="tertiary">The words for this part arrive when it finishes.</T.Body>
          )}
        </View>
      ))}

      {recording ? (
        <View
          className="rounded-xl border border-lantern-border bg-lantern-surface p-3"
          style={{ gap: 4 }}
          accessibilityLiveRegion="polite"
        >
          <T.Caption tone="secondary">Listening…</T.Caption>
          <T.Body tone="secondary">
            {captions ||
              'Captions appear here as you speak. They are replaced by the real transcript when this part finishes.'}
          </T.Body>
        </View>
      ) : null}
    </View>
  );
}

export interface LectureAudioSegmentsProps {
  noteId: string;
  segments: LectureSegmentUi[];
  noteTitle?: string | null;
  attachments?: LectureAttachmentLike[] | null;
}

export function LectureAudioSegments({
  noteId,
  segments,
  noteTitle,
  attachments,
}: LectureAudioSegmentsProps) {
  const playable = segments.filter((segment) => segment.attachmentId);
  const byId = new Map(
    (attachments ?? []).filter((row) => row.id).map((row) => [row.id as string, row])
  );

  return (
    <View style={{ gap: 12 }}>
      <View>
        <T.Label>Audio recordings</T.Label>
        <T.Caption tone="secondary">
          {lectureSegmentsSummaryLine(segments.map((row) => ({ createdAt: row.createdAt })))}
        </T.Caption>
      </View>
      {playable.length === 0 ? (
        <T.Body tone="tertiary">
          {segments.length
            ? 'These parts are still being saved. They appear here once they land.'
            : 'No recording is saved on this lecture yet.'}
        </T.Body>
      ) : (
        playable.map((segment) => (
          <View key={segment.seq} style={{ gap: 4 }}>
            <T.Label>{lectureSegmentLabel(segment)}</T.Label>
            <LectureAudioPlayer
              noteId={noteId}
              noteTitle={noteTitle}
              attachment={
                byId.get(segment.attachmentId as string) ?? {
                  id: segment.attachmentId,
                  type: 'audio',
                  fileName: segment.fileName,
                  fileUrl: segment.fileUrl,
                }
              }
            />
          </View>
        ))
      )}
    </View>
  );
}

export default LectureTranscriptSegments;

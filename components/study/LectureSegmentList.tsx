import React from 'react';
import { lectureSegmentLabel, lectureSegmentsSummaryLine } from '@lantern/shared/utils/lectureSegments';
import type { LectureAttachmentLike } from '@lantern/shared';
import type { LectureSegmentUi } from '../../stores/lectureRecordingStore';
import { Button } from '../ui';
import { LectureAudioPlayer } from './LectureAudioPlayer';

/**
 * The two lists a segmented lecture grows: its transcript and its audio.
 *
 * ## Transcript
 *
 * One card per five-minute segment, stamped with where in the lecture it
 * starts, filling in as Whisper answers. While a segment is still open the only
 * text available is the browser's own captions, so they are shown under a
 * "Listening…" dot and are replaced — not appended to — when the segment's real
 * transcript lands. That replacement is the point: captions are a placeholder
 * for a span, never a second transcript of it.
 *
 * A segment that failed shows Retry ON ITS OWN CARD, and says plainly that the
 * audio is already saved. The lecture is not re-recorded and no other segment
 * is touched: one refused request must not cost a student the hour they sat
 * through.
 *
 * ## Audio files
 *
 * One playable row per segment. Each plays through `LectureAudioPlayer`, which
 * re-signs its URL rather than trusting the one stored on the row — a signed
 * URL is dead within 24 hours, which is the same freeze that once killed chat
 * photos.
 */

export interface LectureTranscriptSegmentsProps {
  segments: LectureSegmentUi[];
  /** The browser captions for the segment still being recorded. */
  liveCaptions?: string;
  /** A take is running, so the last card is the one in progress. */
  recording?: boolean;
  onRetry: (seq: number) => void;
}

const STATUS_LINE: Record<LectureSegmentUi['status'], string> = {
  recording: 'Recording…',
  uploading: 'Saving this part…',
  transcribing: 'Transcribing…',
  done: '',
  failed: '',
};

export const LectureTranscriptSegments: React.FC<LectureTranscriptSegmentsProps> = ({
  segments,
  liveCaptions,
  recording,
  onRetry,
}) => {
  const captions = (liveCaptions ?? '').trim();
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {segments.map((segment) => (
          <li
            key={segment.seq}
            className="rounded-xl border border-lantern-border bg-lantern-background p-3"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-caption tabular-nums text-lantern-text-secondary">
                {segment.stamp}
              </span>
              {segment.status !== 'done' && segment.status !== 'failed' ? (
                <span className="text-caption text-lantern-text-tertiary">
                  {STATUS_LINE[segment.status]}
                </span>
              ) : null}
            </div>
            {segment.status === 'done' ? (
              <p className="mt-1 text-body text-lantern-text whitespace-pre-wrap">
                {segment.transcript || 'Nothing was said in this part.'}
              </p>
            ) : segment.status === 'failed' ? (
              <div className="mt-1 space-y-2">
                <p className="text-body text-lantern-text-secondary">
                  This part did not transcribe. The audio is saved — nothing is lost.
                </p>
                {segment.error ? (
                  <p className="text-caption text-lantern-text-tertiary">{segment.error}</p>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onRetry(segment.seq)}
                  aria-label={`Retry transcribing the part at ${segment.stamp}`}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-body text-lantern-text-tertiary">
                The words for this part arrive when it finishes.
              </p>
            )}
          </li>
        ))}
      </ol>

      {recording ? (
        <div
          className="rounded-xl border border-dashed border-lantern-border bg-lantern-background p-3"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lantern-feature-recording-ink opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-lantern-feature-recording-ink" />
            </span>
            <span className="text-caption text-lantern-text-secondary">Listening…</span>
          </div>
          <p className="mt-1 text-body text-lantern-text-secondary whitespace-pre-wrap">
            {captions ||
              'Captions appear here as you speak. They are replaced by the real transcript when this part finishes.'}
          </p>
        </div>
      ) : null}
    </div>
  );
};

export interface LectureAudioSegmentsProps {
  noteId: string;
  segments: LectureSegmentUi[];
  /** Attachment rows off the note, used to play a segment saved in an earlier session. */
  attachments?: LectureAttachmentLike[] | null;
}

export const LectureAudioSegments: React.FC<LectureAudioSegmentsProps> = ({
  noteId,
  segments,
  attachments,
}) => {
  const playable = segments.filter((segment) => segment.attachmentId);
  const byId = new Map(
    (attachments ?? []).filter((row) => row.id).map((row) => [row.id as string, row])
  );

  return (
    <div className="space-y-3 p-3">
      <div>
        <h2 className="text-heading">Audio recordings</h2>
        <p className="text-caption text-lantern-text-secondary">
          {lectureSegmentsSummaryLine(segments.map((row) => ({ createdAt: row.createdAt })))}
        </p>
      </div>
      {playable.length === 0 ? (
        <p className="text-body text-lantern-text-tertiary">
          {segments.length
            ? 'These parts are still being saved. They appear here once they land.'
            : 'No recording is saved on this lecture yet.'}
        </p>
      ) : (
        <ol className="space-y-3">
          {playable.map((segment) => (
            <li key={segment.seq} className="space-y-1">
              <p className="text-label uppercase text-lantern-text-secondary">
                {lectureSegmentLabel(segment)}
              </p>
              <LectureAudioPlayer
                noteId={noteId}
                attachment={
                  byId.get(segment.attachmentId as string) ?? {
                    id: segment.attachmentId,
                    type: 'audio',
                    fileName: segment.fileName,
                    fileUrl: segment.fileUrl,
                  }
                }
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

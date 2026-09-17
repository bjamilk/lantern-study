import type { DataLayer } from './data';
import {
  formatTranscriptForNote,
  getYoutubeTranscript,
} from './youtubeTranscript';
import { logger } from '../utils/logger';

export interface YoutubeTranscriptJobParams {
  noteId: string;
  attachmentId: string;
  videoId: string;
  /** Attachment metadata written at creation time; merged into the update. */
  meta: Record<string, unknown>;
}

export interface YoutubeTranscriptJobResult {
  status: 'ready' | 'failed';
  noteId: string;
  attachmentId: string;
  segmentCount?: number;
  language?: string | null;
  source?: string;
  error?: string;
}

/**
 * Fetches the transcript for a YouTube note attachment and stores it as
 * extracted text (timestamped ~30s blocks) so AI study tools can use it.
 * Never throws — failures are written to attachment metadata instead.
 */
export async function runYoutubeTranscriptJob(
  layer: DataLayer,
  params: YoutubeTranscriptJobParams
): Promise<YoutubeTranscriptJobResult> {
  const { noteId, attachmentId, videoId, meta } = params;

  const {
    transcriptError: _prevError,
    transcriptFailedAt: _prevFailedAt,
    ...baseMeta
  } = meta;

  try {
    const transcript = await getYoutubeTranscript(layer.getClient(), videoId);
    const formatted = formatTranscriptForNote(transcript.segments) || transcript.text;

    await layer.notes.updateNoteAttachment(attachmentId, {
      extractedText: formatted,
      metadata: {
        ...baseMeta,
        videoId,
        transcriptStatus: 'ready',
        transcriptLanguage: transcript.language,
        transcriptSource: transcript.source,
        transcriptSegments: transcript.segments.length,
        transcriptFetchedAt: new Date().toISOString(),
        transcriptError: null,
        transcriptFailedAt: null,
      },
    });

    return {
      status: 'ready',
      noteId,
      attachmentId,
      segmentCount: transcript.segments.length,
      language: transcript.language,
      source: transcript.source,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcript fetch failed.';
    logger.warn('YouTube transcript job failed', { noteId, videoId, error: message });

    await layer.notes
      .updateNoteAttachment(attachmentId, {
        metadata: {
          ...baseMeta,
          videoId,
          transcriptStatus: 'failed',
          transcriptError: message,
          transcriptFailedAt: new Date().toISOString(),
        },
      })
      .catch((updateErr) => {
        logger.error('Failed to record transcript failure on attachment', {
          attachmentId,
          updateErr,
        });
      });

    return { status: 'failed', noteId, attachmentId, error: message };
  }
}

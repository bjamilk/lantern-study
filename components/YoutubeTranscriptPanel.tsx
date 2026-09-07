import React, { useEffect, useMemo, useState } from 'react';
import type { NoteAttachment } from '../types';
import { Button } from './ui';
import { AppIcon } from './ui/AppIcon';

type TranscriptStatus = 'ready' | 'processing' | 'failed' | 'missing';

function resolveTranscriptStatus(attachment?: NoteAttachment | null): TranscriptStatus {
  if (!attachment) return 'missing';
  if (attachment.extractedText?.trim()) return 'ready';
  const status = attachment.metadata?.transcriptStatus;
  if (status === 'processing' || status === 'ready' || status === 'failed') return status;
  return 'missing';
}

interface YoutubeTranscriptPanelProps {
  theme: 'light' | 'dark';
  attachment?: NoteAttachment | null;
  canRetry?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
}

const YoutubeTranscriptPanel: React.FC<YoutubeTranscriptPanelProps> = ({
  theme,
  attachment,
  canRetry = false,
  retrying = false,
  onRetry,
}) => {
  const isDark = theme === 'dark';
  const status = resolveTranscriptStatus(attachment);
  const transcript = attachment?.extractedText?.trim() || '';
  const errorMessage =
    typeof attachment?.metadata?.transcriptError === 'string'
      ? attachment.metadata.transcriptError
      : null;
  const [expanded, setExpanded] = useState(status === 'ready');

  useEffect(() => {
    if (status === 'ready') setExpanded(true);
  }, [status]);

  const shellClass = isDark
    ? 'border-lantern-border bg-lantern-surface text-lantern-text'
    : 'border-lantern-border bg-lantern-background text-lantern-text';

  const statusCopy = useMemo(() => {
    if (status === 'processing' || retrying) {
      return {
        title: 'Fetching transcript…',
        body: 'We’ll use this transcript for Smart Notes and other AI study tools.',
      };
    }
    if (status === 'failed' || status === 'missing') {
      return {
        title: 'Transcript unavailable',
        body:
          errorMessage ||
          'We couldn’t fetch captions for this video. Private videos, disabled captions, and some cloud rate limits can block transcript import.',
      };
    }
    return {
      title: 'Video transcript',
      body: 'Ready for Smart Notes, flashcards, and chat.',
    };
  }, [status, retrying, errorMessage]);

  return (
    <div className={`rounded-xl border px-3 py-3 sm:px-4 space-y-2 ${shellClass}`} role="status">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{statusCopy.title}</p>
          <p
            className={`text-xs mt-0.5 ${
              isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'
            }`}
          >
            {statusCopy.body}
          </p>
        </div>
        {(status === 'failed' || status === 'missing') && canRetry && onRetry ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={retrying}
            onClick={onRetry}
            className="shrink-0"
          >
            {retrying ? (
              <AppIcon name="refresh" size={16} className="animate-spin" aria-hidden />
            ) : (
              'Retry'
            )}
          </Button>
        ) : null}
        {status === 'ready' && transcript ? (
          <button
            type="button"
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-lantern-primary"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                Hide <AppIcon name="chevron-up" size={16} aria-hidden />
              </>
            ) : (
              <>
                Show <AppIcon name="chevron-down" size={16} aria-hidden />
              </>
            )}
          </button>
        ) : null}
      </div>

      {(status === 'processing' || retrying) && (
        <div className="flex items-center gap-2 text-xs text-lantern-text-tertiary">
          <AppIcon name="refresh" size={16} className="animate-spin" aria-hidden />
          Pulling captions from YouTube…
        </div>
      )}

      {status === 'ready' && expanded && transcript ? (
        <div
          className={`max-h-64 overflow-y-auto rounded-lg border px-3 py-2 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
            isDark
              ? 'border-lantern-border bg-lantern-background text-lantern-text-tertiary'
              : 'border-lantern-border bg-lantern-surface text-lantern-text'
          }`}
        >
          {transcript}
        </div>
      ) : null}
    </div>
  );
};

export default YoutubeTranscriptPanel;
export { resolveTranscriptStatus };

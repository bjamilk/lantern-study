import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LECTURE_AUDIO_SPEEDS,
  formatLectureAudioSpeed,
  formatLectureAudioTime,
  lectureAudioFileName,
  nextLectureAudioSpeed,
  type LectureAttachmentLike,
} from '@lantern/shared';
import { refreshNoteAttachmentUrl } from '../../services/notes';
import { AppIcon } from '../ui/AppIcon';

/**
 * The Audio tab of the lecture surface.
 *
 * The one thing this file exists to get right: a lecture recording's `fileUrl`
 * was signed at transcribe time and the storage layer caps every signed URL at
 * 24 hours, so the URL saved on the attachment row is dead by the next day —
 * the same freeze that killed chat photos. So the player never trusts the
 * stored link: it mints a fresh one through
 * `GET /notes/:noteId/attachments/:id/url` on open, falls back to the stored
 * URL only if that call fails, and re-signs once more if the element itself
 * errors mid-session. A row with no `fileUrl` at all but a `storagePath` in its
 * metadata (signing failed when the recording was saved) plays through exactly
 * the same path.
 *
 * The mobile twin is `apps/mobile/src/components/lecture/LectureAudioPlayer.tsx`.
 */
export interface LectureAudioPlayerProps {
  noteId: string;
  attachment: LectureAttachmentLike;
}

export const LectureAudioPlayer: React.FC<LectureAudioPlayerProps> = ({ noteId, attachment }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const resignedRef = useRef(false);
  const attachmentId = attachment.id;
  const storedUrl = (attachment.fileUrl ?? '').trim();
  const fileName = lectureAudioFileName(attachment);

  /** Mint a fresh signed URL. Returns false when there is nothing to play. */
  const resign = useCallback(async (): Promise<boolean> => {
    if (!attachmentId) return false;
    try {
      const { url } = await refreshNoteAttachmentUrl(noteId, attachmentId);
      if (!url) return false;
      setSrc(url);
      setFailed(false);
      return true;
    } catch {
      return false;
    }
  }, [noteId, attachmentId]);

  useEffect(() => {
    let cancelled = false;
    resignedRef.current = false;
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setFailed(false);
    setSrc(null);
    void (async () => {
      if (attachmentId) {
        try {
          const { url } = await refreshNoteAttachmentUrl(noteId, attachmentId);
          if (cancelled) return;
          if (url) {
            setSrc(url);
            return;
          }
        } catch {
          // Fall through to whatever was saved on the row.
        }
      }
      if (cancelled) return;
      if (storedUrl) setSrc(storedUrl);
      else setFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId, attachmentId, storedUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = speed;
  }, [speed, src]);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    try {
      await el.play();
    } catch {
      // The usual cause is an expired link, not a blocked gesture — this click
      // IS the gesture. Re-sign once and try the same click again.
      if (resignedRef.current) {
        setFailed(true);
        return;
      }
      resignedRef.current = true;
      if (await resign()) {
        window.setTimeout(() => {
          void audioRef.current?.play().catch(() => setFailed(true));
        }, 0);
      } else {
        setFailed(true);
      }
    }
  };

  const onError = () => {
    if (resignedRef.current) {
      setFailed(true);
      return;
    }
    resignedRef.current = true;
    void resign().then((ok) => {
      if (!ok) setFailed(true);
    });
  };

  const seek = (seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    setPosition(seconds);
  };

  if (failed) {
    return (
      <div className="p-3">
        <p className="text-body text-lantern-text-secondary">
          This recording could not be opened. It may have been removed from storage.
        </p>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="p-3">
        <p className="text-body text-lantern-text-tertiary">Opening the recording…</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const total = event.currentTarget.duration;
          setDuration(Number.isFinite(total) ? total : 0);
          event.currentTarget.playbackRate = speed;
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onError={onError}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? 'Pause the recording' : 'Play the recording'}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lantern-primary text-white"
        >
          <AppIcon name={playing ? 'pause' : 'play'} size={20} />
        </button>
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 0}
          step={0.1}
          value={Math.min(position, duration || 0)}
          disabled={!(duration > 0)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Seek the recording"
          className="min-w-0 flex-1 accent-lantern-primary"
        />
        <span className="shrink-0 text-caption tabular-nums text-lantern-text-secondary">
          {formatLectureAudioTime(position)} / {formatLectureAudioTime(duration)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSpeed((was) => nextLectureAudioSpeed(was))}
          aria-label={`Playback speed ${formatLectureAudioSpeed(speed)}`}
          className="inline-flex min-h-[44px] items-center rounded-full border border-lantern-border bg-lantern-surface px-3 text-body tabular-nums text-lantern-text hover:border-lantern-text-tertiary"
        >
          {formatLectureAudioSpeed(speed)}
        </button>
        <span className="text-caption text-lantern-text-tertiary">
          {LECTURE_AUDIO_SPEEDS.map(formatLectureAudioSpeed).join(' · ')}
        </span>
        <a
          href={src}
          download={fileName}
          className="ml-auto inline-flex min-h-[44px] items-center rounded-full border border-lantern-border px-3 text-body text-lantern-text hover:border-lantern-text-tertiary"
        >
          Download
        </a>
      </div>
    </div>
  );
};

export default LectureAudioPlayer;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import {
  LECTURE_AUDIO_SPEEDS,
  formatLectureAudioSpeed,
  formatLectureAudioTime,
  lectureAudioFileName,
  nextLectureAudioSpeed,
  type LectureAttachmentLike,
} from '@lantern/shared';
import { T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import {
  describeAttachmentUrlError,
  fetchNoteAttachmentUrl,
  logLectureMedia,
} from '../../services/noteAttachmentUrl';
import {
  LECTURE_AUDIO_JUMP_SECONDS,
  LectureAudioEngine,
  initialLectureAudioState,
  type LectureAudioState,
} from '../../services/lectureAudioEngine';

/**
 * The Audio tab of the lecture surface on the phone.
 *
 * Same contract as the web twin (`components/study/LectureAudioPlayer.tsx`):
 * the `fileUrl` saved on the attachment row was signed when the recording was
 * transcribed and storage caps every signed URL at 24 hours, so it is dead by
 * the next day. This mints a fresh one through
 * `GET /notes/:noteId/attachments/:id/url` before loading, keeps the stored URL
 * only as a fallback, and re-signs once more if the sound fails to open.
 *
 * All playback lives in `services/lectureAudioEngine.ts`, which owns the
 * `expo-audio` player and the lock-screen session. This file is the view: it
 * renders engine state and sends transport commands back. The controls on the
 * lock screen and in the notification shade drive the same engine, so the two
 * can never disagree about where the playhead is.
 */
export interface LectureAudioPlayerProps {
  noteId: string;
  attachment: LectureAttachmentLike;
  /** The note's own title — what the lock screen should call this recording. */
  noteTitle?: string | null;
}

/**
 * What the lock screen calls this recording.
 *
 * The NOTE TITLE wins: that is the name the student gave the lecture, and it is
 * what they are looking for on the lock screen. `LectureTabs` passes it down
 * (`LectureTabSource` itself carries no title, so the two screens that mount
 * the surface supply it).
 *
 * The file name is the fallback for an older row saved before the title was
 * threaded through: `physiology-week-4.m4a` becomes `Physiology week 4`, and
 * the recorder's default name becomes plain "Lecture recording" rather than
 * showing the student a slug.
 */
function nowPlayingTitle(
  attachment: LectureAttachmentLike,
  noteTitle?: string | null
): string {
  const named = (noteTitle ?? '').trim();
  if (named && named.toLowerCase() !== 'untitled note') return named;
  const raw = lectureAudioFileName(attachment);
  const stem = raw.replace(/\.[a-z0-9]{1,5}$/i, '');
  const words = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words || words.toLowerCase() === 'lecture recording') return 'Lecture recording';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The app mark shown beside the transport on the lock screen and in the
 * notification shade. `expo-audio` takes a URL string, so the bundled asset has
 * to be resolved to one: a packager URL in dev, a `file://`/bundle path in a
 * release build. Resolved once, and defensively — a null here would cost the
 * whole player, and artwork is the most optional field on the session.
 */
const LOCK_SCREEN_ARTWORK_URL: string | undefined = (() => {
  try {
    return Image.resolveAssetSource(require('../../../assets/icon.png'))?.uri || undefined;
  } catch {
    return undefined;
  }
})();

export function LectureAudioPlayer({ noteId, attachment, noteTitle }: LectureAudioPlayerProps) {
  const { colors } = useTheme();
  const engineRef = useRef<LectureAudioEngine | null>(null);
  const trackWidthRef = useRef(0);
  const resignedRef = useRef(false);
  const [url, setUrl] = useState<string | null>(null);
  /** Null while healthy; otherwise the reason the student is shown. */
  const [failure, setFailure] = useState<string | null>(null);
  const [state, setState] = useState<LectureAudioState>(initialLectureAudioState);

  const attachmentId = attachment.id;
  const storedUrl = (attachment.fileUrl ?? '').trim();
  const title = useMemo(() => nowPlayingTitle(attachment, noteTitle), [attachment, noteTitle]);

  /**
   * Answers a URL, or the reason there is none. The reason is the point: the
   * server says whether the row has no storage path, whether the object is
   * gone, or whether the session expired, and the student used to be told
   * "it may have been removed from storage" in all three cases.
   */
  const resign = useCallback(
    async (step: 'sign' | 'resign'): Promise<{ url?: string; error?: string }> => {
      if (!attachmentId) return { error: 'This recording has no attachment id.' };
      try {
        return { url: await fetchNoteAttachmentUrl(noteId, attachmentId, { step }) };
      } catch (err) {
        return {
          error: describeAttachmentUrlError(err, 'The recording link could not be refreshed.'),
        };
      }
    },
    [noteId, attachmentId]
  );

  useEffect(() => {
    let cancelled = false;
    resignedRef.current = false;
    setFailure(null);
    setUrl(null);
    void (async () => {
      const fresh = await resign('sign');
      if (cancelled) return;
      const next = fresh.url || storedUrl;
      if (next) {
        setUrl(next);
        return;
      }
      logLectureMedia('audio:no-url', { noteId, attachmentId, message: fresh.error });
      setFailure(fresh.error || 'This recording has no file to play.');
    })();
    return () => {
      cancelled = true;
    };
  }, [resign, storedUrl, noteId, attachmentId]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    const engine = new LectureAudioEngine({
      nowPlaying: {
        title,
        artist: 'Lantern Study',
        ...(LOCK_SCREEN_ARTWORK_URL ? { artworkUrl: LOCK_SCREEN_ARTWORK_URL } : {}),
      },
      onState: (next) => {
        if (!cancelled) setState(next);
      },
    });
    engineRef.current = engine;

    void (async () => {
      const first = await engine.load(url);
      if (cancelled) return;
      if (first.ok) return;
      logLectureMedia('audio:load', { noteId, attachmentId, message: first.message });
      // One re-sign, once: a URL minted seconds ago that still will not open is
      // a missing object, not an expiry, and retrying forever just spins.
      if (resignedRef.current) {
        engine.markFailed(first.message);
        setFailure(first.message);
        return;
      }
      resignedRef.current = true;
      const fresh = await resign('resign');
      if (cancelled) return;
      if (!fresh.url) {
        engine.markFailed(fresh.error);
        setFailure(fresh.error || first.message);
        return;
      }
      const second = await engine.load(fresh.url);
      if (cancelled) return;
      if (!second.ok) {
        logLectureMedia('audio:load:retry', {
          noteId,
          attachmentId,
          message: second.message,
        });
        engine.markFailed(second.message);
        setFailure(second.message);
        return;
      }
      setUrl(fresh.url);
    })();

    return () => {
      cancelled = true;
      engineRef.current = null;
      engine.destroy();
    };
  }, [url, title, resign, noteId, attachmentId]);

  const seekToRatio = (ratio: number) => {
    const { durationMs } = state;
    if (!(durationMs > 0)) return;
    void engineRef.current?.command({
      type: 'seek',
      positionMs: Math.floor(ratio * durationMs),
    });
  };

  // The watchdog inside the engine is the only thing that notices a source
  // that opens, reports nothing, and never plays — so its reason counts too.
  const shownFailure = failure || (state.phase === 'failed' ? state.errorMessage : null);

  if (shownFailure) {
    return (
      <View className="rounded-xl border border-lantern-border bg-lantern-surface p-3">
        <T.Body tone="secondary">This recording could not be opened.</T.Body>
        <T.Caption tone="tertiary">{shownFailure}</T.Caption>
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

  const { positionMs, durationMs, playing, rate } = state;
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const jumpLabel = `${LECTURE_AUDIO_JUMP_SECONDS} seconds`;

  return (
    <View className="gap-3 rounded-xl border border-lantern-border bg-lantern-surface p-3">
      <View className="flex-row items-center gap-3">
        <Pressable
          onPress={() => void engineRef.current?.command({ type: 'toggle' })}
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
              seekToRatio(Math.max(0, Math.min(1, event.nativeEvent.locationX / width)));
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
              { name: 'increment', label: `Forward ${jumpLabel}` },
              { name: 'decrement', label: `Back ${jumpLabel}` },
            ]}
            onAccessibilityAction={(event) => {
              const name = event.nativeEvent.actionName;
              if (name !== 'increment' && name !== 'decrement') return;
              void engineRef.current?.command({
                type: 'jump',
                seconds:
                  name === 'increment' ? LECTURE_AUDIO_JUMP_SECONDS : -LECTURE_AUDIO_JUMP_SECONDS,
              });
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
          onPress={() =>
            void engineRef.current?.command({ type: 'jump', seconds: -LECTURE_AUDIO_JUMP_SECONDS })
          }
          accessibilityRole="button"
          accessibilityLabel={`Back ${jumpLabel}`}
          className="min-h-[44px] justify-center rounded-full border border-lantern-border px-3"
        >
          <T.Body tabular>{`−${LECTURE_AUDIO_JUMP_SECONDS}s`}</T.Body>
        </Pressable>
        <Pressable
          onPress={() =>
            void engineRef.current?.command({ type: 'jump', seconds: LECTURE_AUDIO_JUMP_SECONDS })
          }
          accessibilityRole="button"
          accessibilityLabel={`Forward ${jumpLabel}`}
          className="min-h-[44px] justify-center rounded-full border border-lantern-border px-3"
        >
          <T.Body tabular>{`+${LECTURE_AUDIO_JUMP_SECONDS}s`}</T.Body>
        </Pressable>
        <Pressable
          onPress={() =>
            void engineRef.current?.command({ type: 'rate', rate: nextLectureAudioSpeed(rate) })
          }
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${formatLectureAudioSpeed(rate)}`}
          className="min-h-[44px] justify-center rounded-full border border-lantern-border px-3"
        >
          <T.Body tabular>{formatLectureAudioSpeed(rate)}</T.Body>
        </Pressable>
        <T.Caption tone="tertiary">
          {LECTURE_AUDIO_SPEEDS.map(formatLectureAudioSpeed).join(' · ')}
        </T.Caption>
      </View>
      <T.Caption tone="tertiary">
        {`Playback keeps going when you leave the app. Play, pause and ${jumpLabel.replace(' seconds', '-second')} skips are on your lock screen too.`}
      </T.Caption>
    </View>
  );
}

export default LectureAudioPlayer;

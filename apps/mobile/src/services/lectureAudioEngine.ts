import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';

/**
 * The one audio engine behind the lecture player on the phone.
 *
 * Why this file exists at all: the Audio tab used to drive `expo-av`'s
 * `Audio.Sound` straight from the component. That played in the background, but
 * `expo-av` writes no now-playing metadata, so a student who locked the phone
 * mid-lecture had audio and no way to pause it without unlocking, finding the
 * app and finding the tab. `expo-audio` (the SDK 54 successor, same Expo
 * module system, no prebuild ejection) exposes a real lock-screen surface:
 *
 * - Android: a media3 `MediaSessionService` (`AudioControlsService`, declared
 *   in the library's own manifest with `foregroundServiceType="mediaPlayback"`)
 *   puts a media notification on the lock screen and in the shade, with
 *   play/pause, a scrub bar and optional ±10 s buttons.
 * - iOS: `MPRemoteCommandCenter` — play, pause, scrub
 *   (`changePlaybackPositionCommand`) and ±10 s skip on the lock screen,
 *   Control Centre, CarPlay and the Watch.
 *
 * The ±10 s interval is the module's own constant on both platforms
 * (`AudioControlsService.SEEK_INTERVAL_MS = 10000`, `preferredIntervals =
 * [10.0]`) and is not configurable, so the in-app nudge buttons use the same
 * 10 s rather than inventing a number the lock screen would contradict.
 *
 * Everything above the native calls is a pure reducer so the transitions that
 * actually bite (a status frame that arrives after teardown, a seek past the
 * tail, a rate change that the decoder silently refuses) are testable without
 * a device. The component holds no playback logic of its own.
 */

export const LECTURE_AUDIO_JUMP_SECONDS = 10;

/**
 * How long a source may sit in `loading` before the engine calls it dead.
 *
 * `createAudioPlayer` is SYNCHRONOUS and does not throw for a URL it cannot
 * open: a 403 from storage, a deleted object and a dead signature all return a
 * perfectly good player object that simply never reports `isLoaded: true`. So
 * `load()`'s try/catch can only ever catch a native constructor fault, and
 * without this watchdog the Audio tab sits on "Opening the recording…" for
 * ever. 20s is generous for a cold 50-minute m4a on campus wifi.
 */
export const LECTURE_AUDIO_LOAD_TIMEOUT_MS = 20_000;

export const LECTURE_AUDIO_LOAD_TIMEOUT_MESSAGE =
  'The recording did not start playing. The file may be missing from storage, or the link may have expired.';

/** How close to the tail counts as "finished", in milliseconds. */
const TAIL_EPSILON_MS = 40;

export interface LectureAudioNowPlaying {
  title: string;
  artist: string;
  artworkUrl?: string;
}

/**
 * Android's `expo.modules.audio.Metadata` types `artworkUrl` as
 * `java.net.URL?`, so ANY string without a protocol throws
 * `MalformedURLException` straight out of `setActiveForLockScreen`. The value
 * that shipped was `Image.resolveAssetSource(require('icon.png')).uri`, which
 * in a release build is the bare bundled-asset key `assets_icon` — not a URL.
 *
 * So the engine accepts only an absolute URL a JVM will parse: http(s) for a
 * remote mark, file:// for the bundled one after `expo-asset` has unpacked it
 * (see `lockScreenArtwork.ts`). Anything else is dropped — artwork is the most
 * optional field on the session, and a wrong one used to cost the lecture.
 */
export function sanitizeLockScreenArtworkUrl(value?: string | null): string | undefined {
  const url = (value ?? '').trim();
  if (!url) return undefined;
  return /^(https?|file):\/\/./i.test(url) ? url : undefined;
}

/** The metadata payload handed to both lock-screen calls. */
export function lockScreenMetadata(nowPlaying: LectureAudioNowPlaying): {
  title: string;
  artist: string;
  albumTitle: string;
  artworkUrl?: string;
} {
  const artworkUrl = sanitizeLockScreenArtworkUrl(nowPlaying.artworkUrl);
  return {
    title: nowPlaying.title,
    artist: nowPlaying.artist,
    albumTitle: nowPlaying.artist,
    ...(artworkUrl ? { artworkUrl } : {}),
  };
}

/**
 * Local on purpose: `noteAttachmentUrl.logLectureMedia` drags supabase in, and
 * this file is imported by the pure engine tests. Same `[lecture-media]` tag,
 * so one logcat filter still catches every hop.
 */
function logLectureMedia(step: string, detail: Record<string, unknown>): void {
  console.warn('[lecture-media]', JSON.stringify({ step, ...detail }));
}

export interface LectureAudioState {
  /**
   * `idle` before a source is handed over, `loading` while one is opening,
   * `ready` once the native player reports it loaded, `failed` when both the
   * stored URL and a freshly signed one refused to open.
   */
  phase: 'idle' | 'loading' | 'ready' | 'failed';
  positionMs: number;
  durationMs: number;
  rate: number;
  playing: boolean;
  /** Why `phase` is `failed`. Never a guess — the server's sentence, or the watchdog's. */
  errorMessage?: string;
}

export const initialLectureAudioState: LectureAudioState = {
  phase: 'idle',
  positionMs: 0,
  durationMs: 0,
  rate: 1,
  playing: false,
};

/**
 * A transport command. The same four shapes cover an in-app button press and a
 * lock-screen remote command, which is the point: `remoteCommandToCommand`
 * funnels the OS commands into this type so both routes take one code path.
 */
export type LectureAudioCommand =
  | { type: 'toggle' }
  | { type: 'seek'; positionMs: number }
  | { type: 'jump'; seconds: number }
  | { type: 'rate'; rate: number };

/** The remote commands the lock-screen surfaces can raise. */
export type LectureAudioRemoteCommand =
  | 'play'
  | 'pause'
  | 'togglePlayPause'
  | 'seekForward'
  | 'seekBackward'
  | { command: 'seekTo'; positionMs: number };

export type LectureAudioAction =
  | { type: 'load-start' }
  | { type: 'load-failed'; message?: string }
  | { type: 'status'; status: LectureAudioStatusFrame }
  | { type: 'optimistic-seek'; positionMs: number }
  | { type: 'optimistic-rate'; rate: number }
  | { type: 'reset' };

/** The subset of `AudioStatus` this engine reads. */
export interface LectureAudioStatusFrame {
  isLoaded?: boolean;
  playing?: boolean;
  currentTime?: number;
  duration?: number;
  didJustFinish?: boolean;
  playbackRate?: number;
}

const asMs = (seconds: number | undefined): number =>
  typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : 0;

/** Keep a seek inside the track, and just short of the tail. */
export function clampSeekMs(targetMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  if (!Number.isFinite(targetMs)) return 0;
  const inside = Math.max(0, Math.min(durationMs, Math.floor(targetMs)));
  // Parking exactly on the tail leaves the player in the finished state, which
  // reads to the student as "it refused to scrub".
  return inside >= durationMs - TAIL_EPSILON_MS
    ? Math.max(0, durationMs - TAIL_EPSILON_MS)
    : inside;
}

/** Where a ±n second nudge lands, clamped. */
export function jumpTargetMs(
  positionMs: number,
  durationMs: number,
  seconds: number
): number {
  return clampSeekMs(positionMs + seconds * 1000, durationMs);
}

export function isAtEnd(state: LectureAudioState): boolean {
  return (
    state.durationMs > 0 && state.positionMs >= state.durationMs - TAIL_EPSILON_MS
  );
}

/**
 * Lock-screen command → engine command. `seekForward` / `seekBackward` are
 * already applied natively by the module before the status frame reaches us;
 * this mapping exists so an in-app caller (and a test) can take the identical
 * path, and so a future surface that only emits remote names needs no new logic.
 */
export function remoteCommandToCommand(
  remote: LectureAudioRemoteCommand
): LectureAudioCommand | null {
  if (typeof remote === 'object') {
    return { type: 'seek', positionMs: remote.positionMs };
  }
  switch (remote) {
    case 'play':
    case 'pause':
    case 'togglePlayPause':
      return { type: 'toggle' };
    case 'seekForward':
      return { type: 'jump', seconds: LECTURE_AUDIO_JUMP_SECONDS };
    case 'seekBackward':
      return { type: 'jump', seconds: -LECTURE_AUDIO_JUMP_SECONDS };
    default:
      return null;
  }
}

export function lectureAudioReducer(
  state: LectureAudioState,
  action: LectureAudioAction
): LectureAudioState {
  switch (action.type) {
    case 'reset':
      return { ...initialLectureAudioState, rate: state.rate };
    case 'load-start':
      return { ...initialLectureAudioState, rate: state.rate, phase: 'loading' };
    case 'load-failed':
      return {
        ...state,
        phase: 'failed',
        playing: false,
        ...(action.message ? { errorMessage: action.message } : {}),
      };
    case 'optimistic-seek':
      return { ...state, positionMs: clampSeekMs(action.positionMs, state.durationMs) };
    case 'optimistic-rate':
      return { ...state, rate: action.rate };
    case 'status': {
      const { status } = action;
      // A frame can arrive after a failure (the native object outlives the
      // reject by a tick); it must not resurrect a dead player.
      if (state.phase === 'failed') return state;
      if (status.isLoaded === false) return state;

      const durationMs = asMs(status.duration) || state.durationMs;
      const phase = 'ready' as const;

      if (status.didJustFinish) {
        return { ...state, phase, durationMs, positionMs: 0, playing: false };
      }

      const positionMs =
        typeof status.currentTime === 'number' && Number.isFinite(status.currentTime)
          ? Math.max(0, Math.round(status.currentTime * 1000))
          : state.positionMs;

      // Some Android decoders refuse a rate and keep reporting 1; trust the
      // native number so the pill never lies about what is playing.
      const rate =
        typeof status.playbackRate === 'number' && status.playbackRate > 0
          ? status.playbackRate
          : state.rate;

      return {
        ...state,
        phase,
        durationMs,
        positionMs,
        rate,
        playing: status.playing === true,
        errorMessage: undefined,
      };
    }
    default:
      return state;
  }
}

/* ------------------------------------------------------------------ *
 * Native side
 * ------------------------------------------------------------------ */

/** What `load()` answers: either it opened, or here is why it did not. */
export type LectureAudioLoadResult =
  | { ok: true }
  | { ok: false; message: string };

export interface LectureAudioEngineOptions {
  nowPlaying: LectureAudioNowPlaying;
  onState: (state: LectureAudioState) => void;
}

/**
 * Owns exactly one native `AudioPlayer` and the lock-screen session that goes
 * with it. Created per mounted player; `destroy()` releases both, because a
 * media notification that outlives the screen is a bug the student has to
 * swipe away.
 */
export class LectureAudioEngine {
  private player: AudioPlayer | null = null;
  private subscription: { remove: () => void } | null = null;
  private state: LectureAudioState = initialLectureAudioState;
  private destroyed = false;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: LectureAudioEngineOptions) {}

  getState(): LectureAudioState {
    return this.state;
  }

  private dispatch(action: LectureAudioAction) {
    if (this.destroyed) return;
    const next = lectureAudioReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.options.onState(next);
  }

  /**
   * Opens `url`. Answers `{ ok: false, message }` when the source could not be
   * opened, which is the caller's cue to re-sign and try once more — a lecture
   * URL is signed for 24 hours and is dead by the next day. The message is what
   * the student is shown, so it must never be invented here: it is either the
   * native fault's own text or the watchdog's sentence.
   */
  async load(url: string): Promise<LectureAudioLoadResult> {
    if (this.destroyed) return { ok: false, message: 'The player was closed.' };
    this.teardownPlayer();
    this.dispatch({ type: 'load-start' });

    try {
      // Background playback is the whole point: a 50-minute lecture is not
      // something a student sits and watches. `shouldPlayInBackground` is what
      // keeps the session alive with the screen off, and it is also the
      // precondition for the Android media notification staying up.
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        allowsRecording: false,
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      }).catch(() => undefined);

      const player = createAudioPlayer({ uri: url }, { updateInterval: 250 });
      if (this.destroyed) {
        player.remove();
        return { ok: false, message: 'The player was closed.' };
      }
      this.player = player;
      player.shouldCorrectPitch = true;
      if (this.state.rate !== 1) {
        player.setPlaybackRate(this.state.rate, 'high');
      }

      this.subscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        // The FIRST loaded frame is the only proof the source really opened.
        if ((status as LectureAudioStatusFrame)?.isLoaded) this.clearLoadTimer();
        this.dispatch({ type: 'status', status });
      });

      // See LECTURE_AUDIO_LOAD_TIMEOUT_MS: nothing else ever reports an
      // unopenable source, because the constructor above happily returns one.
      this.clearLoadTimer();
      this.loadTimer = setTimeout(() => {
        this.loadTimer = null;
        if (this.state.phase !== 'loading') return;
        this.dispatch({
          type: 'load-failed',
          message: LECTURE_AUDIO_LOAD_TIMEOUT_MESSAGE,
        });
      }, LECTURE_AUDIO_LOAD_TIMEOUT_MS);

      // Claim the lock screen / notification transport for this recording.
      // Only one player owns it at a time, which suits a lecture surface where
      // one recording plays at a time.
      //
      // NON-FATAL, and that is the whole point of the inner try: on Android
      // `Metadata.artworkUrl` is a `java.net.URL`, so a bare bundled-asset key
      // ("assets_icon") threw MalformedURLException out of this call, the outer
      // catch tore the player down, and the student was told the recording
      // "could not be opened" when the audio itself was fine (Round 2c, check
      // 3). Playback must never depend on the lock-screen integration.
      try {
        player.setActiveForLockScreen(
          true,
          lockScreenMetadata(this.options.nowPlaying),
          { showSeekForward: true, showSeekBackward: true }
        );
      } catch (error) {
        logLectureMedia('lockscreen', {
          message: error instanceof Error && error.message ? error.message : String(error),
        });
      }
      return { ok: true };
    } catch (error) {
      // A lock-screen session that will not open must not cost the student the
      // lecture, but it is also the one fault this try/catch can see, so it is
      // reported rather than swallowed.
      this.teardownPlayer();
      return {
        ok: false,
        message:
          error instanceof Error && error.message
            ? error.message
            : 'The audio player could not be started on this device.',
      };
    }
  }

  /** Retitle the lock screen without reloading — used when the note is renamed. */
  updateNowPlaying(nowPlaying: LectureAudioNowPlaying) {
    if (!this.player) return;
    try {
      this.player.updateLockScreenMetadata(lockScreenMetadata(nowPlaying));
    } catch {
      // Metadata is cosmetic; a refusal must not break playback.
    }
  }

  markFailed(message?: string) {
    this.clearLoadTimer();
    this.dispatch({ type: 'load-failed', ...(message ? { message } : {}) });
  }

  private clearLoadTimer() {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
  }

  /** The single entry point for every transport control, in-app or remote. */
  async command(command: LectureAudioCommand): Promise<void> {
    const player = this.player;
    if (!player) return;
    try {
      switch (command.type) {
        case 'toggle': {
          if (this.state.playing) {
            player.pause();
            return;
          }
          // Pressing play on a finished lecture should restart it, not sit
          // there doing nothing.
          if (isAtEnd(this.state)) {
            await player.seekTo(0);
            this.dispatch({ type: 'optimistic-seek', positionMs: 0 });
          }
          player.play();
          return;
        }
        case 'seek': {
          const target = clampSeekMs(command.positionMs, this.state.durationMs);
          this.dispatch({ type: 'optimistic-seek', positionMs: target });
          await player.seekTo(target / 1000);
          return;
        }
        case 'jump': {
          const target = jumpTargetMs(
            this.state.positionMs,
            this.state.durationMs,
            command.seconds
          );
          this.dispatch({ type: 'optimistic-seek', positionMs: target });
          await player.seekTo(target / 1000);
          return;
        }
        case 'rate': {
          this.dispatch({ type: 'optimistic-rate', rate: command.rate });
          player.setPlaybackRate(command.rate, 'high');
          return;
        }
      }
    } catch {
      // A refused seek or rate leaves the playhead where it was; the next
      // status frame corrects the optimistic value.
    }
  }

  remote(remote: LectureAudioRemoteCommand): Promise<void> {
    const command = remoteCommandToCommand(remote);
    return command ? this.command(command) : Promise.resolve();
  }

  private teardownPlayer() {
    this.clearLoadTimer();
    this.subscription?.remove();
    this.subscription = null;
    const player = this.player;
    this.player = null;
    if (!player) return;
    try {
      player.clearLockScreenControls();
    } catch {
      // Nothing to clear if the session never opened.
    }
    try {
      player.remove();
    } catch {
      // Already released.
    }
  }

  destroy() {
    this.destroyed = true;
    this.teardownPlayer();
  }
}

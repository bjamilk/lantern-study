import {
  LECTURE_AUDIO_JUMP_SECONDS,
  LECTURE_AUDIO_LOAD_TIMEOUT_MESSAGE,
  LECTURE_AUDIO_LOAD_TIMEOUT_MS,
  LectureAudioEngine,
  clampSeekMs,
  initialLectureAudioState,
  isAtEnd,
  jumpTargetMs,
  lectureAudioReducer,
  remoteCommandToCommand,
  type LectureAudioState,
} from './lectureAudioEngine';
import { MockAudioPlayer, __resetExpoAudioMock } from './__mocks__/expoAudio';

const state = (over: Partial<LectureAudioState> = {}): LectureAudioState => ({
  ...initialLectureAudioState,
  ...over,
});

describe('lectureAudioReducer', () => {
  it('moves idle to loading and clears the playhead but keeps the chosen speed', () => {
    const before = state({ phase: 'ready', positionMs: 9000, durationMs: 60000, rate: 1.5 });
    expect(lectureAudioReducer(before, { type: 'load-start' })).toEqual(
      state({ phase: 'loading', rate: 1.5 })
    );
  });

  it('takes position and duration from a status frame in seconds', () => {
    const next = lectureAudioReducer(state({ phase: 'loading' }), {
      type: 'status',
      status: { isLoaded: true, playing: true, currentTime: 12.5, duration: 3600 },
    });
    expect(next).toMatchObject({
      phase: 'ready',
      positionMs: 12500,
      durationMs: 3600000,
      playing: true,
    });
  });

  it('keeps the last known duration when a frame reports none', () => {
    const before = state({ phase: 'ready', durationMs: 3600000, positionMs: 1000 });
    const next = lectureAudioReducer(before, {
      type: 'status',
      status: { isLoaded: true, playing: true, currentTime: 2, duration: 0 },
    });
    expect(next.durationMs).toBe(3600000);
    expect(next.positionMs).toBe(2000);
  });

  it('rewinds and stops on the finished frame', () => {
    const before = state({ phase: 'ready', playing: true, positionMs: 59000, durationMs: 60000 });
    const next = lectureAudioReducer(before, {
      type: 'status',
      status: { isLoaded: true, playing: false, currentTime: 60, duration: 60, didJustFinish: true },
    });
    expect(next).toMatchObject({ playing: false, positionMs: 0, durationMs: 60000 });
  });

  it('trusts the native playback rate over the requested one', () => {
    // Some Android decoders refuse a rate and keep reporting 1.
    const before = lectureAudioReducer(state({ phase: 'ready' }), {
      type: 'optimistic-rate',
      rate: 1.5,
    });
    expect(before.rate).toBe(1.5);
    const next = lectureAudioReducer(before, {
      type: 'status',
      status: { isLoaded: true, playing: true, currentTime: 1, duration: 10, playbackRate: 1 },
    });
    expect(next.rate).toBe(1);
  });

  it('leaves the rate alone when a frame omits it', () => {
    const before = state({ phase: 'ready', rate: 1.25 });
    const next = lectureAudioReducer(before, {
      type: 'status',
      status: { isLoaded: true, playing: true, currentTime: 1, duration: 10 },
    });
    expect(next.rate).toBe(1.25);
  });

  it('does not let a late status frame resurrect a failed player', () => {
    const failed = lectureAudioReducer(state({ phase: 'loading' }), { type: 'load-failed' });
    expect(failed.phase).toBe('failed');
    const next = lectureAudioReducer(failed, {
      type: 'status',
      status: { isLoaded: true, playing: true, currentTime: 5, duration: 10 },
    });
    expect(next).toBe(failed);
  });

  it('ignores an unloaded frame', () => {
    const before = state({ phase: 'ready', positionMs: 4000, durationMs: 10000 });
    expect(lectureAudioReducer(before, { type: 'status', status: { isLoaded: false } })).toBe(
      before
    );
  });

  it('clamps an optimistic seek to the track', () => {
    const before = state({ phase: 'ready', durationMs: 60000 });
    expect(
      lectureAudioReducer(before, { type: 'optimistic-seek', positionMs: 999999 }).positionMs
    ).toBe(59960);
    expect(
      lectureAudioReducer(before, { type: 'optimistic-seek', positionMs: -5000 }).positionMs
    ).toBe(0);
  });
});

describe('seek arithmetic', () => {
  it('stops just short of the tail so scrubbing to the end does not finish the track', () => {
    expect(clampSeekMs(60000, 60000)).toBe(59960);
    expect(clampSeekMs(59999, 60000)).toBe(59960);
  });

  it('returns 0 for a track with no known duration', () => {
    expect(clampSeekMs(5000, 0)).toBe(0);
  });

  it('rejects a non-finite target rather than passing NaN to the decoder', () => {
    expect(clampSeekMs(Number.NaN, 60000)).toBe(0);
  });

  it('nudges forward and back within the track', () => {
    expect(jumpTargetMs(30000, 60000, 10)).toBe(40000);
    expect(jumpTargetMs(30000, 60000, -10)).toBe(20000);
    expect(jumpTargetMs(2000, 60000, -10)).toBe(0);
    expect(jumpTargetMs(58000, 60000, 10)).toBe(59960);
  });

  it('knows when the playhead is parked at the end', () => {
    expect(isAtEnd(state({ positionMs: 59960, durationMs: 60000 }))).toBe(true);
    expect(isAtEnd(state({ positionMs: 30000, durationMs: 60000 }))).toBe(false);
    expect(isAtEnd(state({ positionMs: 0, durationMs: 0 }))).toBe(false);
  });
});

describe('remoteCommandToCommand', () => {
  it('maps every lock-screen transport onto an in-app command', () => {
    expect(remoteCommandToCommand('play')).toEqual({ type: 'toggle' });
    expect(remoteCommandToCommand('pause')).toEqual({ type: 'toggle' });
    expect(remoteCommandToCommand('togglePlayPause')).toEqual({ type: 'toggle' });
    expect(remoteCommandToCommand('seekForward')).toEqual({
      type: 'jump',
      seconds: LECTURE_AUDIO_JUMP_SECONDS,
    });
    expect(remoteCommandToCommand('seekBackward')).toEqual({
      type: 'jump',
      seconds: -LECTURE_AUDIO_JUMP_SECONDS,
    });
  });

  it('carries the scrub position through from the lock-screen slider', () => {
    expect(remoteCommandToCommand({ command: 'seekTo', positionMs: 12345 })).toEqual({
      type: 'seek',
      positionMs: 12345,
    });
  });

  it('uses the interval the module itself hard-codes on both platforms', () => {
    // AudioControlsService.SEEK_INTERVAL_MS = 10000 on Android;
    // skipForwardCommand.preferredIntervals = [10.0] on iOS.
    expect(LECTURE_AUDIO_JUMP_SECONDS).toBe(10);
  });
});

describe('LectureAudioEngine', () => {
  beforeEach(() => {
    __resetExpoAudioMock();
  });

  const build = () => {
    const seen: LectureAudioState[] = [];
    const engine = new LectureAudioEngine({
      nowPlaying: { title: 'Pharmacology week 4', artist: 'Lantern Study' },
      onState: (next) => seen.push(next),
    });
    return { engine, seen };
  };

  it('claims the lock screen with the note title when a source loads', async () => {
    const { engine } = build();
    await engine.load('https://example.test/lecture.m4a');
    const player = MockAudioPlayer.instances[0];
    const claim = player.calls.find((call) => call.method === 'setActiveForLockScreen');
    expect(claim).toBeTruthy();
    expect(claim?.args[0]).toBe(true);
    expect(claim?.args[1]).toMatchObject({
      title: 'Pharmacology week 4',
      artist: 'Lantern Study',
    });
    expect(claim?.args[2]).toEqual({ showSeekForward: true, showSeekBackward: true });
    engine.destroy();
  });

  it('feeds native status frames through the reducer', async () => {
    const { engine } = build();
    await engine.load('https://example.test/lecture.m4a');
    MockAudioPlayer.instances[0].emit({
      isLoaded: true,
      playing: true,
      currentTime: 7,
      duration: 120,
    });
    expect(engine.getState()).toMatchObject({ phase: 'ready', positionMs: 7000, playing: true });
    engine.destroy();
  });

  it('restarts a finished lecture when play is pressed', async () => {
    const { engine } = build();
    await engine.load('https://example.test/lecture.m4a');
    const player = MockAudioPlayer.instances[0];
    player.emit({
      isLoaded: true,
      playing: false,
      currentTime: 120,
      duration: 120,
      didJustFinish: true,
    });
    // The finished frame parks at 0, so nudge to the tail to model a scrub-to-end.
    await engine.command({ type: 'seek', positionMs: 120000 });
    await engine.command({ type: 'toggle' });
    const seeks = player.calls.filter((call) => call.method === 'seekTo');
    expect(seeks[seeks.length - 1]?.args[0]).toBe(0);
    expect(player.calls.some((call) => call.method === 'play')).toBe(true);
    engine.destroy();
  });

  it('pauses rather than replaying when already playing', async () => {
    const { engine } = build();
    await engine.load('https://example.test/lecture.m4a');
    const player = MockAudioPlayer.instances[0];
    player.emit({ isLoaded: true, playing: true, currentTime: 1, duration: 120 });
    await engine.command({ type: 'toggle' });
    expect(player.calls.some((call) => call.method === 'pause')).toBe(true);
    expect(player.calls.some((call) => call.method === 'play')).toBe(false);
    engine.destroy();
  });

  it('routes a lock-screen skip through the same path as the in-app nudge', async () => {
    const { engine } = build();
    await engine.load('https://example.test/lecture.m4a');
    const player = MockAudioPlayer.instances[0];
    player.emit({ isLoaded: true, playing: true, currentTime: 30, duration: 120 });
    await engine.remote('seekForward');
    expect(player.calls.filter((call) => call.method === 'seekTo').pop()?.args[0]).toBe(40);
    expect(engine.getState().positionMs).toBe(40000);
    engine.destroy();
  });

  it('releases the lock-screen session on destroy', async () => {
    const { engine } = build();
    await engine.load('https://example.test/lecture.m4a');
    const player = MockAudioPlayer.instances[0];
    engine.destroy();
    expect(player.calls.some((call) => call.method === 'clearLockScreenControls')).toBe(true);
    expect(player.calls.some((call) => call.method === 'remove')).toBe(true);
  });

  it('surfaces the native reason when a source will not open', async () => {
    MockAudioPlayer.lockScreenError = 'AudioFocus denied by the system.';
    const { engine } = build();
    const result = await engine.load('https://example.test/lecture.m4a');
    expect(result).toEqual({ ok: false, message: 'AudioFocus denied by the system.' });
    // The caller hands the reason back so the student reads it, not a guess.
    engine.markFailed(result.ok ? undefined : result.message);
    expect(engine.getState()).toMatchObject({
      phase: 'failed',
      errorMessage: 'AudioFocus denied by the system.',
    });
    engine.destroy();
  });

  it('fails a source that opens but never reports itself loaded', async () => {
    jest.useFakeTimers();
    try {
      const { engine } = build();
      // `createAudioPlayer` is synchronous and returns a player for a URL it
      // cannot fetch, so nothing throws — only the watchdog notices.
      const result = await engine.load('https://example.test/gone.m4a');
      expect(result).toEqual({ ok: true });
      expect(engine.getState().phase).toBe('loading');
      jest.advanceTimersByTime(LECTURE_AUDIO_LOAD_TIMEOUT_MS + 1);
      expect(engine.getState()).toMatchObject({
        phase: 'failed',
        errorMessage: LECTURE_AUDIO_LOAD_TIMEOUT_MESSAGE,
      });
      engine.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves a source that does report itself loaded alone', async () => {
    jest.useFakeTimers();
    try {
      const { engine } = build();
      await engine.load('https://example.test/lecture.m4a');
      MockAudioPlayer.instances[0].emit({ isLoaded: true, playing: false, duration: 120 });
      jest.advanceTimersByTime(LECTURE_AUDIO_LOAD_TIMEOUT_MS + 1);
      expect(engine.getState().phase).toBe('ready');
      engine.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops emitting state after destroy', async () => {
    const { engine, seen } = build();
    await engine.load('https://example.test/lecture.m4a');
    const player = MockAudioPlayer.instances[0];
    engine.destroy();
    const before = seen.length;
    player.emit({ isLoaded: true, playing: true, currentTime: 99, duration: 120 });
    expect(seen.length).toBe(before);
  });
});

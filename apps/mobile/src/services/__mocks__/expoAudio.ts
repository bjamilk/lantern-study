/**
 * Stand-in for `expo-audio` under jest.
 *
 * The mobile jest run is plain ts-jest on node (see `jest.config.js`) — there
 * is no native runtime, so importing the real package explodes on the
 * `requireNativeModule` call at module scope. `moduleNameMapper` points
 * `expo-audio` here, the same way it already points `@lantern/shared/utils` at
 * a stand-in, so `lectureAudioEngine.ts` can be imported for its pure exports.
 *
 * Deliberately minimal: the engine's reducer, clamping and remote-command
 * mapping are what the tests assert. This records calls so a test can check the
 * native surface is driven at all without pretending to emulate a decoder.
 */

export interface MockAudioPlayerCall {
  method: string;
  args: unknown[];
}

export class MockAudioPlayer {
  static instances: MockAudioPlayer[] = [];
  /** Set by a test to model a device that refuses the lock-screen session. */
  static lockScreenError: string | null = null;
  /** Set by a test to model a native player that will not construct at all. */
  static createError: string | null = null;

  calls: MockAudioPlayerCall[] = [];
  listeners: ((status: unknown) => void)[] = [];
  shouldCorrectPitch = false;

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  addListener(_event: string, listener: (status: unknown) => void) {
    this.listeners.push(listener);
    return {
      remove: () => {
        this.listeners = this.listeners.filter((entry) => entry !== listener);
      },
    };
  }

  emit(status: unknown) {
    for (const listener of [...this.listeners]) listener(status);
  }

  play() {
    this.record('play');
  }

  pause() {
    this.record('pause');
  }

  async seekTo(seconds: number) {
    this.record('seekTo', seconds);
  }

  setPlaybackRate(rate: number, quality?: string) {
    this.record('setPlaybackRate', rate, quality);
  }

  setActiveForLockScreen(active: boolean, metadata?: unknown, options?: unknown) {
    this.record('setActiveForLockScreen', active, metadata, options);
    if (MockAudioPlayer.lockScreenError) {
      throw new Error(MockAudioPlayer.lockScreenError);
    }
  }

  updateLockScreenMetadata(metadata: unknown) {
    this.record('updateLockScreenMetadata', metadata);
  }

  clearLockScreenControls() {
    this.record('clearLockScreenControls');
  }

  remove() {
    this.record('remove');
  }
}

export function createAudioPlayer(_source?: unknown, _options?: unknown) {
  if (MockAudioPlayer.createError) throw new Error(MockAudioPlayer.createError);
  const player = new MockAudioPlayer();
  MockAudioPlayer.instances.push(player);
  return player as unknown as never;
}

export async function setAudioModeAsync(_mode: unknown): Promise<void> {
  // No audio session off-device.
}

export function __resetExpoAudioMock() {
  MockAudioPlayer.instances = [];
  MockAudioPlayer.lockScreenError = null;
  MockAudioPlayer.createError = null;
}

export type AudioPlayer = MockAudioPlayer;
export type AudioStatus = Record<string, unknown>;
export type AudioMetadata = Record<string, unknown>;

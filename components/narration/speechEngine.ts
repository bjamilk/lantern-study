/**
 * The browser's own voice, wrapped so the player never touches
 * `speechSynthesis` directly.
 *
 * This is the only file allowed to know how badly behaved that API is:
 *
 *   - Voices arrive asynchronously. `getVoices()` returns [] on the first call
 *     in Chrome and fills in later via `voiceschanged`.
 *   - Chrome stops speaking after roughly 15 seconds unless something pings
 *     `resume()`. The keep-alive below is the standard, unglamorous fix.
 *   - `cancel()` can still deliver a queued `end` or `boundary` for the
 *     utterance it just killed, so every callback is fenced behind a token and
 *     a cancelled utterance's late events are dropped rather than advancing
 *     the player onto the wrong segment.
 *   - Some engines report `SpeechSynthesisErrorEvent.error === 'interrupted'`
 *     or `'canceled'` for a normal stop. Those are not failures and must not
 *     surface to the student as one.
 *
 * Nothing here is React-aware, and nothing here throws: on a browser with no
 * speech at all every function is a no-op and `isSpeechSupported()` is false,
 * which is what turns the player into an honest closed door instead of a dead
 * play button.
 */
import type { NarrationVoice } from '../../utils/narrationPlayerModel';

/** Errors an engine reports for an ordinary stop. Never shown to a student. */
const BENIGN_ERRORS = new Set(['interrupted', 'canceled', 'cancelled']);

/** Chrome's watchdog fires around 15s; ping well inside that. */
const KEEP_ALIVE_MS = 10_000;

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.speechSynthesis ?? null;
  } catch {
    return null;
  }
}

export function isSpeechSupported(): boolean {
  return Boolean(synth() && typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window);
}

/** The voices the browser has right now, in the player's own shape. */
export function listVoices(): NarrationVoice[] {
  const engine = synth();
  if (!engine) return [];
  try {
    return engine.getVoices().map((voice) => ({
      voiceURI: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      default: voice.default,
      localService: voice.localService,
    }));
  } catch {
    return [];
  }
}

/**
 * Call `onChange` whenever the voice list changes, and once immediately.
 *
 * Chrome's first `getVoices()` is empty, so a player that read the list once
 * at mount would offer no voice picker at all on a cold load.
 */
export function subscribeToVoices(onChange: (voices: NarrationVoice[]) => void): () => void {
  const engine = synth();
  onChange(listVoices());
  if (!engine || typeof engine.addEventListener !== 'function') return () => undefined;
  const handler = () => onChange(listVoices());
  engine.addEventListener('voiceschanged', handler);
  return () => engine.removeEventListener('voiceschanged', handler);
}

export interface SpeakRequest {
  text: string;
  rate: number;
  voiceURI?: string;
  lang?: string;
  onBoundary?: (charIndex: number, charLength?: number) => void;
  /** The utterance finished on its own. Never called for a cancelled one. */
  onEnd?: () => void;
  /** A real failure, already filtered of benign stop reasons. */
  onError?: (reason: string) => void;
}

let activeToken = 0;
let keepAlive: ReturnType<typeof setInterval> | null = null;

function stopKeepAlive(): void {
  if (keepAlive === null) return;
  clearInterval(keepAlive);
  keepAlive = null;
}

function startKeepAlive(engine: SpeechSynthesis): void {
  stopKeepAlive();
  keepAlive = setInterval(() => {
    // Only nudge a speaking-but-not-deliberately-paused engine. Resuming a
    // paused one would restart audio the student stopped on purpose.
    try {
      if (engine.speaking && !engine.paused) {
        engine.pause();
        engine.resume();
      }
    } catch {
      stopKeepAlive();
    }
  }, KEEP_ALIVE_MS);
}

/**
 * Speak one segment. Cancels anything already speaking.
 *
 * Returns a cancel function for this utterance specifically — calling it after
 * something else has started speaking does nothing, so an unmount racing a
 * segment change cannot silence the new segment.
 */
export function speak(request: SpeakRequest): () => void {
  const engine = synth();
  if (!engine || typeof window === 'undefined' || !('SpeechSynthesisUtterance' in window)) {
    return () => undefined;
  }
  const token = ++activeToken;
  try {
    engine.cancel();
  } catch {
    /* an engine that cannot be cancelled will be talked over anyway */
  }

  const utterance = new window.SpeechSynthesisUtterance(request.text);
  utterance.rate = request.rate;
  if (request.lang) utterance.lang = request.lang;
  if (request.voiceURI) {
    const match = engine.getVoices().find((voice) => voice.voiceURI === request.voiceURI);
    if (match) {
      utterance.voice = match;
      // Engines that ignore `voice` still honour `lang`; keeping the two in
      // step stops a US voice reading a line tagged en-GB in a third accent.
      utterance.lang = match.lang;
    }
  }

  utterance.onboundary = (event: SpeechSynthesisEvent) => {
    if (token !== activeToken) return;
    request.onBoundary?.(event.charIndex, (event as { charLength?: number }).charLength);
  };
  utterance.onend = () => {
    if (token !== activeToken) return;
    stopKeepAlive();
    request.onEnd?.();
  };
  utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
    if (token !== activeToken) return;
    stopKeepAlive();
    const reason = String(event?.error ?? 'unknown');
    if (BENIGN_ERRORS.has(reason)) return;
    request.onError?.(reason);
  };

  try {
    engine.speak(utterance);
    startKeepAlive(engine);
  } catch {
    stopKeepAlive();
    request.onError?.('unavailable');
  }

  return () => {
    if (token !== activeToken) return;
    cancelSpeech();
  };
}

/** Stop everything and make sure no late callback can move the player. */
export function cancelSpeech(): void {
  activeToken += 1;
  stopKeepAlive();
  const engine = synth();
  if (!engine) return;
  try {
    engine.cancel();
  } catch {
    /* nothing to stop */
  }
}

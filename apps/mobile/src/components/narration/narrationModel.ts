/**
 * "Read it to me" — the mobile copy and the small decisions around it.
 *
 * The cursor itself is shared with web (`@lantern/shared/notes/narrationPlayer`);
 * this file is what mobile says about it. Pure and import-free at runtime so
 * mobile jest, which runs in node and never imports a React Native module, can
 * test all of it.
 */

import type { NarrationReason } from '../../services/narration';

/**
 * What the screen says when there is nothing to play.
 *
 * Every branch here is a STATE, not an error. The one that matters most is
 * `not_generated`: it is the state every document is in before anyone has
 * asked for a reading, and printing it as a failure would tell a student
 * something is broken when the truth is that they have not pressed the button
 * yet. `schema_missing` is the hand-applied-migration case and follows the
 * page model's own wording — the feature is not on this server yet, which is
 * nothing the student can act on and should not read like their fault.
 */
export function narrationUnavailableCopy(reason: NarrationReason): {
  title: string;
  detail: string;
  /** True when pressing "Read it to me" would actually help. */
  canGenerate: boolean;
} {
  switch (reason) {
    case 'not_generated':
      return {
        title: 'Not read yet',
        detail: 'Nobody has had this document read out loud yet. That takes one go.',
        canGenerate: true,
      };
    case 'schema_missing':
      return {
        title: 'Reading is not on this server yet',
        detail: 'This will work once the update reaches you. Nothing is wrong with your document.',
        canGenerate: false,
      };
    case 'unsupported':
      return {
        title: 'This one cannot be read aloud',
        detail: 'Only PDFs and slide decks have pages to read. A typed note has no pages.',
        canGenerate: false,
      };
    case 'preview_pending':
      return {
        title: 'Still reading the document',
        detail: 'Its pages are still being extracted. Try again in a moment.',
        canGenerate: false,
      };
    case 'source_missing':
      return {
        title: 'The document is missing',
        detail: 'The file this note points at could not be opened.',
        canGenerate: false,
      };
    case 'unreadable':
      return {
        title: 'Nothing readable in here',
        detail: 'No text could be pulled out of this document, so there is nothing to read aloud.',
        canGenerate: false,
      };
    case 'ok':
    default:
      return { title: 'Ready', detail: '', canGenerate: false };
  }
}

/**
 * The tile's second line: what a reading covers and what it costs.
 *
 * "up to N pages" is the honest half. A 60-page book is read to the cap and
 * priced accordingly, and a student who is told "up to 40 pages" before they
 * spend anything cannot be surprised by where the voice stops. The cost string
 * is always passed in from `formatCreditCost` over the shared constant — a
 * number typed in here is how the counter starts lying.
 */
export function narrationTileHint(
  costLabel: string,
  pagesCovered: number,
  alreadyRead: boolean
): string {
  if (alreadyRead) return 'Already read — play it again free';
  if (pagesCovered <= 0) return costLabel;
  return `${costLabel} · up to ${pagesCovered} page${pagesCovered === 1 ? '' : 's'}`;
}

/**
 * Why the tile is disabled, or null when it is not.
 *
 * Ordered by what the student can do about it: no document is a property of
 * the note and cannot be fixed here, so it is said first; credits can be
 * waited out; a reading in flight is a matter of seconds.
 */
export function narrationBlockedReason(input: {
  hasDocument: boolean;
  pagesPending: boolean;
  shortOfCredits: boolean;
  alreadyRunning: boolean;
  alreadyRead: boolean;
}): string | null {
  if (!input.hasDocument) return 'Only PDFs and slide decks have pages';
  if (input.pagesPending) return 'Still reading the document';
  if (input.alreadyRunning) return 'Already being read';
  // A script that exists is replayed for free, so credits stop mattering the
  // moment there is one. Blocking a paid-for reading behind an empty counter
  // would be charging twice for one thing.
  if (input.alreadyRead) return null;
  if (input.shortOfCredits) return 'Not enough AI uses left today';
  return null;
}

/** The Study-stack heading, and the sheet's source line. */
export function narrationTitle(noteTitle?: string | null): string {
  const trimmed = (noteTitle || '').trim();
  return trimmed ? `Reading · ${trimmed}` : 'Reading this document';
}

/* ------------------------------------------------- can this phone speak? -- */

/**
 * Whether there is a voice on this phone to read with.
 *
 * `unknown` is the state before the probe answers, and it exists so the player
 * can hold the play button for the fraction of a second the check takes rather
 * than offering a control that is about to be wrong. On iOS a voice is always
 * present; on Android the TTS engine is a separate installable app, and a
 * phone that shipped without one — or with one that has no data for the
 * device's language — returns an empty list or rejects outright.
 */
export type SpeechAvailability = 'unknown' | 'available' | 'none';

/**
 * Read `Speech.getAvailableVoicesAsync()`'s answer.
 *
 * Both "it rejected" and "it returned nothing" mean the same thing to a
 * student — no voice — so the caller passes the rejection in as `null` and gets
 * one answer back. Anything that is not a non-empty array counts as none: an
 * engine that answers with a shape we did not expect is not evidence that it
 * can speak.
 */
export function speechAvailabilityFromVoices(voices: unknown): SpeechAvailability {
  return Array.isArray(voices) && voices.length > 0 ? 'available' : 'none';
}

/**
 * How long the voice probe may take before it is read as "no voice".
 *
 * On Android `expo-speech` answers `getAvailableVoicesAsync` only AFTER the
 * system TTS engine reports that it initialised — and on a phone with no
 * engine that report never comes, so the promise neither resolves nor
 * rejects. Without a ceiling the player would sit on a disabled play button
 * forever, which is the failure this probe exists to name. A working engine
 * initialises in well under a second even from cold; eight is generous.
 */
export const SPEECH_PROBE_TIMEOUT_MS = 8000;

/**
 * Run the voice probe with the three answers it can really give — a list, a
 * rejection, or silence — folded into one.
 *
 * `probe` is passed in rather than imported so this stays testable in node:
 * the component hands it `Speech.getAvailableVoicesAsync`. A probe that throws
 * synchronously (a module missing from a build) is no voice too.
 */
export function probeSpeechAvailability(
  probe: () => Promise<unknown>,
  timeoutMs: number = SPEECH_PROBE_TIMEOUT_MS
): Promise<SpeechAvailability> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: SpeechAvailability) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish('none'), timeoutMs);
    let pending: Promise<unknown>;
    try {
      pending = probe();
    } catch {
      finish('none');
      return;
    }
    Promise.resolve(pending).then(
      (voices) => finish(speechAvailabilityFromVoices(voices)),
      () => finish('none')
    );
  });
}

/**
 * What the player says on a phone with no voice.
 *
 * It names the fix (install an engine) and the fallback (the words are on the
 * screen already), because the one thing a student must not be left with is a
 * play button that appears to work. Before this existed the engine's `onError`
 * was mapped onto "paragraph finished", so a voiceless phone flew through the
 * whole document in a second and displayed "Finished" having made no sound.
 */
export const NARRATION_NO_VOICE_COPY = {
  title: 'No voice on this phone',
  detail:
    'This phone has no voice installed to read aloud. Install a text-to-speech ' +
    'engine in Android settings, or read the page text here.',
} as const;

/**
 * What the player says when the engine refused one paragraph.
 *
 * Distinct from the no-voice copy on purpose: there IS a voice, it just would
 * not say this. So this one offers the retry, and the no-voice one does not
 * offer anything the phone cannot do.
 */
export function narrationSpeechErrorCopy(reason?: string): { title: string; detail: string } {
  return {
    title: 'That paragraph would not play',
    detail: reason || 'This phone could not read that paragraph out loud.',
  };
}

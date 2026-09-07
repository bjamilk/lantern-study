/**
 * Turning a wall of pasted notes into the one sample the shared preview needs.
 *
 * `previewCard` in `@lantern/shared/flashcards/generationOptions` takes a
 * `{ front, back, sentence }` sample — it does not read raw material, and it
 * should not: picking a representative line out of a note is a client job and
 * differs by surface. This is mobile's picker, kept pure so it is tested.
 */
import type { PreviewSample } from '@lantern/shared/flashcards/generationOptions';

const LINE_PREFIX = /^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)?(.+?)\s*$/;

/** The first heading or sentence of the source, without its markdown. */
export function firstSourceLine(source: string, maxLength = 120): string {
  const text = (source ?? '').replace(/\r/g, '');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const stripped = LINE_PREFIX.exec(line)?.[1]?.trim();
    if (!stripped) continue;
    const sentence = /^(.+?[.!?])(?:\s|$)/.exec(stripped)?.[1] ?? stripped;
    return sentence.length > maxLength
      ? `${sentence.slice(0, maxLength - 1).trimEnd()}…`
      : sentence;
  }
  return '';
}

/** The longest word in a line — what a cloze preview hides. */
export function longestTerm(line: string): string {
  const words = line.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  return words.reduce((best, word) => (word.length > best.length ? word : best), '');
}

/**
 * A preview sample built from the student's own material.
 *
 * `front` is the source's opening line and `back` the word a cloze card would
 * hide, so both halves come from the notes rather than from an invented
 * answer — the sheet labels it an example precisely because nothing has been
 * generated yet.
 */
export function previewSampleFromSource(source: string): PreviewSample | null {
  const line = firstSourceLine(source);
  if (!line) return null;
  const term = longestTerm(line);
  return {
    front: line,
    back: term || line,
    sentence: line,
  };
}

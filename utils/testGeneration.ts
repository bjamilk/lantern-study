import type { Flashcard } from '../types';
import type { TestPlanDraft } from './testBuilder';

/**
 * Turning a deck into something a question generator can read.
 *
 * Pure, and separate from the hook that calls it, because the interesting part
 * is what gets DROPPED: an image-occlusion card has no text a language model
 * can use, and a cloze card's answer lives inside its own prompt. Feeding those
 * through unchanged produced questions whose answer was printed in the stem.
 */

const MAX_CARDS_FOR_GENERATION = 120;

/** One "Q — A" line per usable card. Empty string when nothing is usable. */
export function buildDeckStudyContent(cards: Flashcard[]): string {
  const lines: string[] = [];
  for (const card of cards) {
    if (lines.length >= MAX_CARDS_FOR_GENERATION) break;
    const front = (card.front ?? '').trim();
    const back = (card.back ?? '').trim();
    if (front && back) {
      lines.push(`${front} — ${back}`);
      continue;
    }
    // A cloze card carries its whole sentence, blank included; the sentence
    // itself is the material, so it goes in as one line.
    const cloze = (card.clozeText ?? '').trim();
    if (cloze) lines.push(cloze);
  }
  return lines.join('\n');
}

/**
 * What the generated test is called.
 *
 * One name, "Test" — never "Quiz" on one screen and "Test" on the next. The
 * source is named after it so a list of them is scannable, and the whole thing
 * is capped at the column width the list can actually show.
 */
export function testTitleForSource(plan: Pick<TestPlanDraft, 'source' | 'sourceTitle'>): string {
  const title = plan.sourceTitle?.trim();
  if (!title) return 'Test';
  return `Test · ${title}`.slice(0, 120);
}

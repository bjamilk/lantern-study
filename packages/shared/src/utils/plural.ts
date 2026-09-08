// ===========================================
// Lantern Study - Counting things out loud
// ===========================================
/**
 * One place that turns a number and a noun into a phrase a person would say.
 *
 * The audit found "1 questions" on Downloads, "1 members" in a chat header and
 * "1 members" on a community board, on screens whose neighbours got it right
 * ("1 member" in the communities list). Every one of those was its own inline
 * template literal, so each site had to remember the rule separately and some
 * did not.
 *
 * Rule: regular English plurals get an "s" (or "es" after s/x/z/ch/sh); a noun
 * with no regular plural passes its own. Nothing here is locale-aware on
 * purpose — the app is English-only today, and a fake i18n layer would hide
 * that rather than fix it.
 */

/** "es" rather than "s" — "1 class" / "2 classes", not "2 classs". */
function defaultPlural(noun: string): string {
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/**
 * The noun alone, in the right form for `count`.
 *
 *   pluralUnit(1, 'member')  -> 'member'
 *   pluralUnit(4, 'member')  -> 'members'
 *   pluralUnit(0, 'member')  -> 'members'   (zero takes the plural in English)
 */
export function pluralUnit(count: number, noun: string, plural?: string): string {
  return Math.abs(count) === 1 ? noun : (plural ?? defaultPlural(noun));
}

/**
 * The whole phrase: the count, a space, and the noun in the matching form.
 *
 *   pluralize(1, 'question') -> '1 question'
 *   pluralize(7, 'question') -> '7 questions'
 *   pluralize(1200, 'member') -> '1,200 members'
 *
 * Non-finite counts are treated as zero rather than printing "NaN members".
 */
export function pluralize(count: number, noun: string, plural?: string): string {
  const safe = typeof count === 'number' && Number.isFinite(count) ? count : 0;
  return `${safe.toLocaleString()} ${pluralUnit(safe, noun, plural)}`;
}

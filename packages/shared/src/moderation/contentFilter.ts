/**
 * Content filter for marketplace listings, question-bank packs and notes —
 * the academic-integrity / rights counterpart of ../jobs/scamPlaybook.ts.
 *
 * Two tiers:
 *   block — leaked / unreleased / upcoming exam material. The API refuses the
 *           write (400) with CONTENT_BLOCK_MESSAGE.
 *   flag  — copyright-adjacent phrasing (lecturer slides, textbook PDFs,
 *           solution manuals). The write goes through; hits are stored on the
 *           row (moderation_flags) and an auto content_report is opened so a
 *           human looks.
 *
 * Past questions / past papers are a LEGITIMATE product category (pq_bank) and
 * must never match — every pattern below is anchored on leak/unreleased/
 * upcoming phrasing, not on the word "exam" or "question" alone.
 */
import type { ContentReportReason } from '../types';

export type ContentMatchSeverity = 'block' | 'flag';

export interface ContentMatch {
  /** RegExp source of the pattern that hit (stored verbatim in moderation_flags). */
  pattern: string;
  severity: ContentMatchSeverity;
  /** Report reason the hit maps to when an auto-report is opened. */
  reason: ContentReportReason;
}

const EXAM_WORD = '(?:exam|examination|test|cbt|paper|quiz|assessment)s?';

/** Hard blocks — leaked, unreleased or not-yet-sat exam material. */
export const CONTENT_BLOCK_PATTERNS: RegExp[] = [
  /\bleaked\b/i,
  new RegExp(`\\bleak(?:ed|s|ing)?\\s+${EXAM_WORD}\\b`, 'i'),
  /\bunreleased\b/i,
  new RegExp(`\\bthis\\s+semester['’]?s?\\s+${EXAM_WORD}\\b`, 'i'),
  // "expo" is Nigerian campus slang for exam malpractice material; only the
  // exam-adjacent usages match so "Expo 2026 tickets" / "React Native Expo
  // tutoring" stay sellable.
  new RegExp(`\\b${EXAM_WORD}\\s+expo\\b`, 'i'),
  new RegExp(`\\bexpo\\s+(?:for\\s+)?(?:the\\s+)?${EXAM_WORD}\\b`, 'i'),
  /\bexpo\s+(?:answers?|dubs?|runs)\b/i,
  new RegExp(`\\b${EXAM_WORD}\\s+answers?\\s+before\\b`, 'i'),
  new RegExp(`\\bupcoming\\s+${EXAM_WORD}\\s+(?:questions?|answers?|papers?)\\b`, 'i'),
  new RegExp(
    `\\banswers?\\s+(?:to|for)\\s+(?:the\\s+)?(?:upcoming|tomorrow['’]?s?|next\\s+week['’]?s?|this\\s+week['’]?s?)\\s+${EXAM_WORD}\\b`,
    'i',
  ),
  new RegExp(`\\b(?:tomorrow|next\\s+week)['’]?s?\\s+${EXAM_WORD}\\s+(?:questions?|answers?)\\b`, 'i'),
  new RegExp(`\\b${EXAM_WORD}\\s+(?:malpractice|runs)\\b`, 'i'),
];

/**
 * Advisory flags — copyright-adjacent phrasing. Do not block on their own;
 * the listing is created and a report is opened for review.
 */
export const CONTENT_FLAG_PATTERNS: RegExp[] = [
  /\blecturer['’]?s?\s+slides?\b/i,
  /\btextbook\s+pdf\b/i,
  /\bpdf\s+(?:copy\s+)?of\s+(?:the\s+)?textbook\b/i,
  /\bscanned\s+textbook\b/i,
  /\bsolution\s+manual\b/i,
  /\bcopyrighted\b/i,
  /\bfull\s+textbook\s+(?:pdf|scan|copy|download)\b/i,
];

export const CONTENT_BLOCK_MESSAGE =
  'This looks like leaked or unreleased exam material, which Lantern does not allow. Past questions from exams that have already been sat are fine — remove the leak/unreleased wording and try again.';

export const CONTENT_FLAG_MESSAGE =
  'This mentions copyrighted material (lecturer slides, textbook PDFs or solution manuals). Only share what you created or have the rights to; it may be reviewed by moderation.';

/** Returns block + flag matches for create-time feedback and storage. */
export function findContentMatches(text: string | null | undefined): ContentMatch[] {
  if (!text || !text.trim()) return [];
  const matches: ContentMatch[] = [];
  for (const pattern of CONTENT_BLOCK_PATTERNS) {
    if (pattern.test(text)) {
      matches.push({ pattern: pattern.source, severity: 'block', reason: 'leaked_exam' });
    }
  }
  for (const pattern of CONTENT_FLAG_PATTERNS) {
    if (pattern.test(text)) {
      matches.push({ pattern: pattern.source, severity: 'flag', reason: 'copyright' });
    }
  }
  return matches;
}

/** True when the text hits a hard-block pattern (the API returns 400). */
export function textFailsContentCheck(text: string | null | undefined): boolean {
  return findContentMatches(text).some((m) => m.severity === 'block');
}

/** Flag-tier hits only (advisory; stored in moderation_flags). */
export function textContentFlags(text: string | null | undefined): ContentMatch[] {
  return findContentMatches(text).filter((m) => m.severity === 'flag');
}

/** Join the fields a filter pass should look at (title + description + …). */
export function contentFilterText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join('\n');
}

export function describeContentMatches(matches: ContentMatch[]): string {
  if (matches.some((m) => m.severity === 'block')) return CONTENT_BLOCK_MESSAGE;
  if (matches.some((m) => m.severity === 'flag')) return CONTENT_FLAG_MESSAGE;
  return '';
}

/**
 * Course anchoring for digital study products (question banks + study packs).
 *
 * Why it is mandatory on a NEW publish: an unanchored bank is reachable only
 * through the group that produced it, so it dies with that group's chat.
 * Anchored to a course, a bank published in March is still what a stranger
 * buys in November — the course is the archive spine every browse surface,
 * search and recommendation hangs off.
 *
 * Existing listings published before this rule keep `course_id = null` and stay
 * valid and readable: the rule gates the transition (publish), never the read.
 *
 * One copy of the rule and one copy of the strings, imported by the server
 * refusal, the four publish modals and the browse surfaces, so web and mobile
 * can never disagree about what they said.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A course id that could exist. Existence itself is the server's business. */
export function isCourseAnchorId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export const COURSE_ANCHOR_COPY = {
  /** Field label on every publish form. */
  label: 'Course',
  /** Shown under the picker, on web and mobile alike. */
  hint: 'Buyers browse by course. Filing this under a course is how students find it months from now.',
  placeholder: 'Search your course code, e.g. BIO 201',
  /** The 400 the server returns, and the inline error the forms show. */
  required:
    'Choose the course this is for. Every question bank and study pack must be filed under a course so students can find it later.',
  /** The picker could not be resolved to a real course. */
  invalid: 'That course could not be found. Search for it again or add it.',
  /** Browse surface. */
  browseTitle: 'Browse by course',
  browseSubtitle: 'Question banks and study packs, filed under the course they were made for.',
  browseEmpty: 'No course has a published bank or pack yet.',
  browseEmptyForCourse: 'Nothing has been published for this course yet.',
  browseError: "Couldn't load courses.",
  retry: 'Try again',
  /** Low-data mode: the browse list never fetches listing images. */
  showImages: 'Show images',
  imagesOffNote: 'Images are off to save data.',
} as const;

/**
 * The publish-time rule. Returns the message to show, or null when the
 * anchor is acceptable.
 */
export function validateCourseAnchor(courseId: unknown): string | null {
  if (courseId == null || courseId === '') return COURSE_ANCHOR_COPY.required;
  if (!isCourseAnchorId(courseId)) return COURSE_ANCHOR_COPY.invalid;
  return null;
}

/** Convenience for form `canSubmit` guards. */
export function hasCourseAnchor(courseId: unknown): boolean {
  return validateCourseAnchor(courseId) === null;
}

/** Wire shape of a row on the "Browse by course" list. */
export interface MarketplaceCourseSummary {
  courseId: string;
  code: string;
  title: string;
  institutionId: string | null;
  institutionName: string | null;
  /** Active listings filed under this course. Real count, never padded. */
  listingCount: number;
  questionBankCount: number;
  studyPackCount: number;
}

/** "3 question banks · 1 study pack" — honest zeros are simply omitted. */
export function courseListingCountLabel(summary: {
  listingCount: number;
  questionBankCount: number;
  studyPackCount: number;
}): string {
  const parts: string[] = [];
  if (summary.questionBankCount > 0) {
    parts.push(`${summary.questionBankCount} question bank${summary.questionBankCount === 1 ? '' : 's'}`);
  }
  if (summary.studyPackCount > 0) {
    parts.push(`${summary.studyPackCount} study pack${summary.studyPackCount === 1 ? '' : 's'}`);
  }
  // "other" only means something next to a named part. With no bank and no
  // pack there is nothing to be other THAN, so the plain total is the honest
  // sentence — a unit test caught this saying "3 other listings" to a reader
  // who had been shown no first group.
  if (parts.length === 0) {
    return `${summary.listingCount} listing${summary.listingCount === 1 ? '' : 's'}`;
  }
  const others =
    summary.listingCount - summary.questionBankCount - summary.studyPackCount;
  if (others > 0) {
    parts.push(`${others} other listing${others === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

/** "BIO 201 · Introductory Biology" — the one label every course row uses. */
export function courseAnchorLabel(course: { code: string; title?: string | null }): string {
  const title = (course.title || '').trim();
  const code = (course.code || '').trim();
  if (!title || title.toUpperCase() === code.toUpperCase()) return code;
  return `${code} · ${title}`;
}

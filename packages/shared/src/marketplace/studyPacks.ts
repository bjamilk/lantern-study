/**
 * Study pack content + counts shapes (Phase 2 · G). Shared so the API service,
 * the API client, and both UI clients build the same object. The server
 * re-validates and re-derives counts, so these are the wire shapes, not trust
 * boundaries. Keep in sync with apps/api-server/src/services/marketplaceStudyPacks.ts.
 */

export interface StudyPackCounts {
  guideWords: number;
  summaries: number;
  flashcards: number;
  questions: number;
}

export interface StudyPackTocEntry {
  title: string;
  anchor: string;
}

export interface StudyPackSummaryInput {
  title: string;
  markdown: string;
}

export interface StudyPackFlashcardInput {
  front?: string;
  back?: string;
  type?: string;
  tags?: string[];
}

export interface StudyPackWeakSection {
  title: string;
  reason: string;
}

/** What a client sends when publishing/updating a pack. */
export interface StudyPackContentInput {
  guide?: { markdown?: string; toc?: StudyPackTocEntry[] };
  summaries?: StudyPackSummaryInput[];
  flashcards?: StudyPackFlashcardInput[];
  questions?: unknown[];
  weakSections?: StudyPackWeakSection[];
}

export const STUDY_PACK_CATEGORY = 'study_pack';

/** One AI credit charge to generate a study-pack draft (Phase 2 · H). */
export const STUDY_PACK_DRAFT_CREDITS = 5;

export type StudyPackDraftStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'published';

/** A row from GET /ai/study-pack/drafts (list — no content). */
export interface StudyPackDraftSummary {
  id: string;
  status: StudyPackDraftStatus;
  source_note_ids: string[];
  course_id: string | null;
  counts: Partial<StudyPackCounts> | null;
  suggested_title: string | null;
  suggested_price_kobo: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** A full draft from GET /ai/study-pack/drafts/:id (adds content + suggestions). */
export interface StudyPackDraft extends StudyPackDraftSummary {
  content: StudyPackContentInput | null;
  suggested_description: string | null;
  classification: {
    courseCode?: string;
    level?: string;
    semester?: string;
    institutionId?: string;
  } | null;
  folder_id: string | null;
}

/** Human labels for the digital counts, for compact "12 cards · 20 Qs" summaries. */
export function summarizeStudyPackCounts(counts: Partial<StudyPackCounts> | null | undefined): string {
  const c = counts || {};
  const parts: string[] = [];
  if (c.guideWords) parts.push(`${c.guideWords}-word guide`);
  if (c.summaries) parts.push(`${c.summaries} ${c.summaries === 1 ? 'summary' : 'summaries'}`);
  if (c.flashcards) parts.push(`${c.flashcards} ${c.flashcards === 1 ? 'card' : 'cards'}`);
  if (c.questions) parts.push(`${c.questions} ${c.questions === 1 ? 'question' : 'questions'}`);
  return parts.join(' · ');
}

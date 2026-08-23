/**
 * AI Study Product Factory (Phase 2 · H). Turns a student's note / folder /
 * course into a `study_pack_drafts` row: one AI credit charge enqueues a
 * background job that summarises the sources into a guide, generates flashcards
 * and questions, classifies the course and suggests a price, then leaves a
 * `ready` draft the student reviews and publishes (POST
 * /marketplace/study-packs/publish { draftId }).
 *
 * The generated `content` matches marketplace_study_packs.content so the publish
 * path consumes it verbatim.
 *
 * NOTE: this first increment generates MCQ questions via the shared question
 * generator; the contract's ≤5 essay variant (with a marking rubric) is a
 * follow-up — the content shape already carries a `kind` on each question.
 */
import type { SupabaseService } from './supabase';
import { PublicError } from '../utils/safeError';
import { logger } from '../utils/logger';
import {
  summarizeNoteContent,
  generateFlashcardsFromNotes,
  generateQuestionsFromNotes,
  generateEssayQuestionsFromNotes,
  generateListingDescription,
} from './aiService';

/** One AI credit charge per draft (contract §2). */
export const STUDY_PACK_DRAFT_CREDIT_COST = 5;

const MAX_SOURCE_NOTES = 12;
const MAX_SUMMARY_SOURCES = 8;
const MAX_FLASHCARDS = 60;
const MAX_QUESTIONS = 40;
const PRICE_CAP_NAIRA = 5000;

export interface CreateStudyPackDraftInput {
  noteIds?: string[];
  folderId?: string | null;
  courseId?: string | null;
  title?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nowIso() {
  return new Date().toISOString();
}

function stripHtml(input: string): string {
  return String(input || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wordCount(markdown: string): number {
  const t = String(markdown || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

function slugify(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'section';
}

/** Map a generated question to the pack's question_data shape (options carry isCorrect for grading). */
function mapQuestion(q: any, index: number) {
  const options = Array.isArray(q.options)
    ? q.options.map((text: unknown, j: number) => ({
        id: String.fromCharCode(97 + j),
        text: String(text ?? ''),
        isCorrect: String(text ?? '') === String(q.correctAnswer ?? ''),
      }))
    : [];
  return {
    id: `spq-${index}`,
    kind: 'mcq' as const,
    type: q.type || 'multiple_choice',
    questionType: q.type || 'multiple_choice',
    questionStem: String(q.text ?? ''),
    text: String(q.text ?? ''),
    options,
    correctAnswer: String(q.correctAnswer ?? ''),
    explanation: String(q.explanation ?? ''),
    difficulty: q.difficulty || 'medium',
    topic: String(q.topic ?? 'General'),
  };
}

export class StudyPackFactoryService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** Resolve which of the user's notes seed the draft (explicit ids, a folder, or a course). */
  private async resolveSourceNoteIds(userId: string, input: CreateStudyPackDraftInput): Promise<string[]> {
    if (Array.isArray(input.noteIds) && input.noteIds.length > 0) {
      const ids = input.noteIds.filter((id) => UUID_RE.test(String(id))).slice(0, MAX_SOURCE_NOTES);
      if (ids.length === 0) return [];
      const { data } = await this.db
        .from('notes')
        .select('id')
        .eq('user_id', userId)
        .in('id', ids);
      return (data || []).map((r: any) => String(r.id));
    }
    if (input.folderId && UUID_RE.test(String(input.folderId))) {
      const { data } = await this.db
        .from('notes')
        .select('id')
        .eq('user_id', userId)
        .eq('folder_id', input.folderId)
        .order('updated_at', { ascending: false })
        .limit(MAX_SOURCE_NOTES);
      return (data || []).map((r: any) => String(r.id));
    }
    if (input.courseId && UUID_RE.test(String(input.courseId))) {
      const { data } = await this.db
        .from('notes')
        .select('id')
        .eq('user_id', userId)
        .eq('course_id', input.courseId)
        .order('updated_at', { ascending: false })
        .limit(MAX_SOURCE_NOTES);
      return (data || []).map((r: any) => String(r.id));
    }
    return [];
  }

  /** Create the draft row (status 'queued'); the generation job fills it in. */
  async createDraft(
    userId: string,
    input: CreateStudyPackDraftInput,
  ): Promise<{ draftId: string; sourceNoteIds: string[] }> {
    if (input.courseId != null && input.courseId !== '' && !UUID_RE.test(String(input.courseId))) {
      throw new PublicError('courseId must be a valid course id');
    }
    const noteIds = await this.resolveSourceNoteIds(userId, input);
    if (noteIds.length === 0) {
      throw new PublicError('No notes found to build a study pack from');
    }
    const { data, error } = await this.db
      .from('study_pack_drafts')
      .insert({
        user_id: userId,
        source_note_ids: noteIds,
        folder_id: input.folderId || null,
        course_id: input.courseId || null,
        status: 'queued',
        suggested_title: (input.title || '').trim() || null,
      })
      .select('id')
      .single();
    if (error || !data) throw error || new Error('Could not create study pack draft');
    return { draftId: String(data.id), sourceNoteIds: noteIds };
  }

  async attachJobId(draftId: string, jobId: string): Promise<void> {
    await this.db
      .from('study_pack_drafts')
      .update({ job_id: jobId, updated_at: nowIso() })
      .eq('id', draftId);
  }

  /**
   * The generation pipeline — runs in the worker (or synchronously when BullMQ
   * is disabled). Throws on total failure so the job's failure-refund fires;
   * individual AI steps are best-effort so one flaky call doesn't sink the pack.
   */
  async generate(draftId: string): Promise<{ draftId: string; status: 'ready' }> {
    const { data: draft } = await this.db
      .from('study_pack_drafts')
      .select('*')
      .eq('id', draftId)
      .maybeSingle();
    if (!draft) throw new Error('Study pack draft not found');
    const userId = String(draft.user_id);

    await this.db
      .from('study_pack_drafts')
      .update({ status: 'generating', updated_at: nowIso() })
      .eq('id', draftId);

    try {
      // 1. Resolve note content (+ attachments' extracted text).
      const noteIds = (Array.isArray(draft.source_note_ids) ? draft.source_note_ids : []).map(String);
      const sources: Array<{ title: string; body: string }> = [];
      for (const nid of noteIds) {
        try {
          const note = await this.supabaseService.getNote(nid, userId);
          const attachments = await this.supabaseService.getNoteAttachments(nid);
          const attachText = attachments
            .map((a: any) => a.extractedText)
            .filter(Boolean)
            .join('\n\n');
          const body = [stripHtml((note as any).body || ''), attachText].filter(Boolean).join('\n\n');
          if (body.trim().length >= 40) {
            sources.push({ title: String((note as any).title || 'Note'), body });
          }
        } catch (err) {
          logger.warn('Study pack draft: skipping unreadable note', { draftId, noteId: nid });
        }
      }
      if (sources.length === 0) throw new Error('No readable note content to build a pack from');

      const combined = sources.map((s) => `# ${s.title}\n${s.body}`).join('\n\n').slice(0, 12000);
      const title = String(draft.suggested_title || sources[0].title || 'Study pack');

      // 2. Guide: a deep summary per source, assembled with a TOC.
      const summaries: Array<{ title: string; markdown: string }> = [];
      for (const s of sources.slice(0, MAX_SUMMARY_SOURCES)) {
        try {
          const { summary } = await summarizeNoteContent(s.body.slice(0, 6000), {
            title: s.title,
            depth: 'deep',
          });
          if (summary && summary.trim()) summaries.push({ title: s.title, markdown: summary.trim() });
        } catch {
          /* best-effort */
        }
      }
      const guideMarkdown = summaries.map((s) => `## ${s.title}\n\n${s.markdown}`).join('\n\n');
      const toc = summaries.map((s) => ({ title: s.title, anchor: slugify(s.title) }));

      // 3. Flashcards.
      let flashcards: Array<{ front: string; back: string }> = [];
      try {
        const r = await generateFlashcardsFromNotes(combined, { count: 20 });
        flashcards = (r.flashcards || [])
          .slice(0, MAX_FLASHCARDS)
          .map((c) => ({ front: String(c.front || ''), back: String(c.back || '') }))
          .filter((c) => c.front && c.back);
      } catch {
        /* best-effort */
      }

      // 4. Questions: MCQ (via the shared generator) + up to 5 essay questions
      // with a marking rubric.
      let questions: Array<Record<string, unknown>> = [];
      try {
        const r = await generateQuestionsFromNotes(combined, { count: 15 });
        questions = (r.questions || []).slice(0, MAX_QUESTIONS).map(mapQuestion);
      } catch {
        /* best-effort */
      }
      try {
        const er = await generateEssayQuestionsFromNotes(combined, { count: 5 });
        const essays = (er.questions || []).map((e, i) => ({
          id: `spe-${i}`,
          kind: 'essay' as const,
          type: 'essay',
          questionType: 'essay',
          questionStem: e.text,
          text: e.text,
          rubric: e.rubric,
          options: [],
        }));
        questions = [...questions, ...essays];
      } catch {
        /* best-effort — essays are a bonus on top of the MCQ set */
      }

      const hasContent =
        guideMarkdown.trim().length > 0 ||
        summaries.length > 0 ||
        flashcards.length > 0 ||
        questions.length > 0;
      if (!hasContent) throw new Error('Generation produced nothing usable');

      // 5. Weak-section flags: summaries that came back thin.
      const weakSections = summaries
        .filter((s) => wordCount(s.markdown) < 40)
        .map((s) => ({ title: s.title, reason: 'Thin coverage — expand this before selling.' }));

      // 6. Classification from the note's course (best-effort).
      const classification = await this.classify(String(draft.course_id || ''));

      // 7. Listing description.
      let description = '';
      try {
        const r = await generateListingDescription({
          title,
          category: 'study_pack',
          courseCode: classification.courseCode,
        });
        description = String(r.description || '');
      } catch {
        /* best-effort */
      }

      const counts = {
        guideWords: wordCount(guideMarkdown),
        summaries: summaries.length,
        flashcards: flashcards.length,
        questions: questions.length,
      };

      // 8. Price suggestion.
      const suggestedPriceKobo = await this.suggestPriceKobo(
        String(draft.course_id || ''),
        classification.institutionId,
        counts,
      );

      const content = {
        guide: { markdown: guideMarkdown, toc },
        summaries,
        flashcards,
        questions,
        weakSections,
      };

      await this.db
        .from('study_pack_drafts')
        .update({
          status: 'ready',
          content,
          counts,
          suggested_title: title,
          suggested_description: description || null,
          suggested_price_kobo: suggestedPriceKobo,
          classification,
          error: null,
          updated_at: nowIso(),
        })
        .eq('id', draftId);

      return { draftId, status: 'ready' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Best-effort: only fail a draft still 'generating' (a later retry may fix it).
      await this.db
        .from('study_pack_drafts')
        .update({ status: 'failed', error: message, updated_at: nowIso() })
        .eq('id', draftId)
        .eq('status', 'generating');
      throw err; // → the job's failure-refund hands the credits back
    }
  }

  private async classify(
    courseId: string,
  ): Promise<{ courseCode?: string; level?: string; semester?: string; institutionId?: string }> {
    if (!courseId || !UUID_RE.test(courseId)) return {};
    try {
      const { data } = await this.db
        .from('courses')
        .select('code, level, institution_id')
        .eq('id', courseId)
        .maybeSingle();
      if (!data) return {};
      return {
        courseCode: (data as any).code || undefined,
        level: (data as any).level != null ? String((data as any).level) : undefined,
        institutionId: (data as any).institution_id || undefined,
      };
    } catch {
      return {};
    }
  }

  /**
   * Median active study_pack price for the same course (else same institution),
   * else a counts-based floor: ₦500 + ₦5/card + ₦10/question, capped ₦5,000.
   */
  private async suggestPriceKobo(
    courseId: string,
    institutionId: string | undefined,
    counts: { flashcards: number; questions: number },
  ): Promise<number> {
    const byCounts = Math.min(
      PRICE_CAP_NAIRA,
      500 + 5 * (counts.flashcards || 0) + 10 * (counts.questions || 0),
    );

    const median = (prices: number[]): number | null => {
      const vals = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
      if (vals.length === 0) return null;
      const mid = Math.floor(vals.length / 2);
      return vals.length % 2 ? vals[mid] : Math.round((vals[mid - 1] + vals[mid]) / 2);
    };

    try {
      if (courseId && UUID_RE.test(courseId)) {
        const { data } = await this.db
          .from('marketplace_study_packs')
          .select('listing_id, course_id, marketplace_listings!inner(price, status, listing_kind)')
          .eq('course_id', courseId);
        const prices = (data || [])
          .map((r: any) => r.marketplace_listings)
          .filter((l: any) => l && l.status === 'active' && Number(l.price) > 0)
          .map((l: any) => Number(l.price));
        const m = median(prices);
        if (m != null) return Math.round(m * 100);
      }
    } catch {
      /* fall through to the counts floor */
    }

    return Math.round(byCounts * 100);
  }

  async listDrafts(userId: string) {
    const { data, error } = await this.db
      .from('study_pack_drafts')
      .select('id, status, source_note_ids, course_id, counts, suggested_title, suggested_price_kobo, error, created_at, updated_at')
      .eq('user_id', userId)
      .neq('status', 'published')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  async getDraft(userId: string, draftId: string) {
    const { data, error } = await this.db
      .from('study_pack_drafts')
      .select('*')
      .eq('id', draftId)
      .maybeSingle();
    if (error) throw error;
    if (!data || String(data.user_id) !== userId) throw new PublicError('Draft not found');
    return data;
  }

  async deleteDraft(userId: string, draftId: string): Promise<void> {
    const { error } = await this.db
      .from('study_pack_drafts')
      .delete()
      .eq('id', draftId)
      .eq('user_id', userId);
    if (error) throw error;
  }
}

let service: StudyPackFactoryService | null = null;

export function getStudyPackFactoryService(supabaseService: SupabaseService): StudyPackFactoryService {
  if (!service) service = new StudyPackFactoryService(supabaseService);
  return service;
}

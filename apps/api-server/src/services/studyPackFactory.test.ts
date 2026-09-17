/**
 * Study Product Factory: draft creation gating and the generation pipeline —
 * a ready draft carries guide/flashcards/questions + counts; a run that finds
 * no readable content fails (which triggers the job-level credit refund).
 */
const mockSummarize = jest.fn();
const mockFlashcards = jest.fn();
const mockQuestions = jest.fn();
const mockEssays = jest.fn();
const mockDescription = jest.fn();
const mockGetOverview = jest.fn();

jest.mock('./aiService', () => ({
  summarizeNoteContent: (...a: unknown[]) => mockSummarize(...a),
  generateFlashcardsFromNotes: (...a: unknown[]) => mockFlashcards(...a),
  generateQuestionsFromNotes: (...a: unknown[]) => mockQuestions(...a),
  generateEssayQuestionsFromNotes: (...a: unknown[]) => mockEssays(...a),
  generateListingDescription: (...a: unknown[]) => mockDescription(...a),
}));

jest.mock('./librarySearch', () => ({
  getLibrarySearchService: () => ({ getOverview: (...a: unknown[]) => mockGetOverview(...a) }),
}));

import { StudyPackFactoryService } from './studyPackFactory';
import { PublicError } from '../utils/safeError';

type TableResult = { data: unknown; error?: unknown };

function makeDb(tables: Record<string, TableResult | TableResult[]>) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const queues = new Map<string, TableResult[]>();
  const nextResult = (table: string): TableResult => {
    const configured = tables[table];
    if (configured === undefined) return { data: null, error: null };
    if (!Array.isArray(configured)) return configured;
    if (!queues.has(table)) queues.set(table, [...configured]);
    const q = queues.get(table)!;
    return q.length > 1 ? q.shift()! : q[0];
  };
  const from = (table: string) => {
    const result = nextResult(table);
    const api: any = {};
    const self = () => api;
    api.select = self;
    api.eq = self;
    api.neq = self;
    api.in = self;
    api.limit = self;
    api.order = self;
    api.delete = () => {
      writes.push({ table, op: 'delete', payload: null });
      return api;
    };
    api.insert = (payload: unknown) => {
      writes.push({ table, op: 'insert', payload });
      return api;
    };
    api.update = (payload: unknown) => {
      writes.push({ table, op: 'update', payload });
      return api;
    };
    api.single = async () => result;
    api.maybeSingle = async () => result;
    api.then = (resolve: (v: TableResult) => unknown) => Promise.resolve(result).then(resolve);
    return api;
  };
  return { db: { from }, writes };
}

const NOTE_BODY = 'Photosynthesis converts light energy into chemical energy. '.repeat(4);

function makeService(overrides: {
  tables?: Record<string, TableResult | TableResult[]>;
  note?: { title?: string; body?: string } | null;
  attachments?: Array<{ extractedText?: string }>;
}) {
  const { db, writes } = makeDb(overrides.tables || {});
  const supabaseService: any = {
    getClient: () => db,
    notes: {
      getNote: jest.fn(async () => overrides.note ?? { title: 'Bio 101', body: NOTE_BODY }),
      getNoteAttachments: jest.fn(async () => overrides.attachments ?? []),
    },
  };
  return { service: new StudyPackFactoryService(supabaseService), writes, supabaseService };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSummarize.mockResolvedValue({ summary: 'A thorough summary of photosynthesis. '.repeat(10), provider: 'x' });
  mockFlashcards.mockResolvedValue({
    flashcards: [{ front: 'What makes ATP?', back: 'Mitochondria' }],
    provider: 'x',
  });
  mockQuestions.mockResolvedValue({
    questions: [
      { text: 'What is 1+1?', type: 'multiple_choice', options: ['2', '3'], correctAnswer: '2', explanation: 'e' },
    ],
    provider: 'x',
  });
  mockEssays.mockResolvedValue({
    questions: [{ text: 'Explain photosynthesis.', rubric: '- light\n- ATP' }],
    provider: 'x',
  });
  mockDescription.mockResolvedValue({ description: 'A complete Bio 101 study pack.', provider: 'x' });
});

describe('createDraft', () => {
  it('resolves the note ids and inserts a queued draft', async () => {
    const { service, writes } = makeService({
      tables: {
        notes: { data: [{ id: 'n1' }, { id: 'n2' }], error: null },
        study_pack_drafts: { data: { id: 'draft-1' }, error: null },
      },
    });
    const result = await service.createDraft('user-1', {
      noteIds: ['0b6f3a3e-2c8e-4c3f-9d1a-7f2e5b1c9a10'],
    });
    expect(result.draftId).toBe('draft-1');
    const insert = writes.find((w) => w.table === 'study_pack_drafts' && w.op === 'insert');
    expect(insert?.payload).toMatchObject({ user_id: 'user-1', status: 'queued' });
  });

  it('rejects when no notes are found', async () => {
    const { service } = makeService({ tables: { notes: { data: [], error: null } } });
    await expect(
      service.createDraft('user-1', { noteIds: ['0b6f3a3e-2c8e-4c3f-9d1a-7f2e5b1c9a10'] })
    ).rejects.toBeInstanceOf(PublicError);
  });
});

describe('generate', () => {
  const DRAFT = {
    id: 'draft-1',
    user_id: 'user-1',
    source_note_ids: ['0b6f3a3e-2c8e-4c3f-9d1a-7f2e5b1c9a10'],
    course_id: null,
    suggested_title: 'Bio 101 Study Pack',
    status: 'queued',
  };

  it('produces a ready draft with guide, flashcards, questions and counts', async () => {
    const { service, writes } = makeService({
      tables: {
        study_pack_drafts: { data: DRAFT, error: null },
        courses: { data: null, error: null },
        marketplace_study_packs: { data: [], error: null },
      },
    });

    const result = await service.generate('draft-1');
    expect(result).toEqual({ draftId: 'draft-1', status: 'ready' });

    const ready = writes.find(
      (w) => w.table === 'study_pack_drafts' && w.op === 'update' && (w.payload as any).status === 'ready'
    );
    expect(ready).toBeTruthy();
    const payload = ready!.payload as any;
    // 1 MCQ + 1 essay
    expect(payload.counts).toMatchObject({ flashcards: 1, questions: 2, summaries: 1 });
    expect(payload.content.questions[0]).toMatchObject({ kind: 'mcq', questionStem: 'What is 1+1?' });
    // options carry an isCorrect marker for grading
    expect(payload.content.questions[0].options[0]).toMatchObject({ text: '2', isCorrect: true });
    expect(payload.content.questions[1]).toMatchObject({ kind: 'essay', rubric: '- light\n- ATP' });
    expect(payload.suggested_price_kobo).toBeGreaterThan(0);
    expect(payload.content.examChecklist.length).toBeGreaterThan(0);
    expect(payload.content.cover).toMatchObject({ title: expect.any(String) });
  });

  it('fails the draft (and rethrows for refund) when no readable content', async () => {
    const { service, writes } = makeService({
      note: { title: 'Empty', body: '' },
      tables: { study_pack_drafts: { data: DRAFT, error: null } },
    });
    await expect(service.generate('draft-1')).rejects.toThrow();
    const failed = writes.find(
      (w) => w.table === 'study_pack_drafts' && w.op === 'update' && (w.payload as any).status === 'failed'
    );
    expect(failed).toBeTruthy();
  });
});

describe('proposeSemester', () => {
  it('proposes one pack per enrolled course that has notes', async () => {
    mockGetOverview.mockResolvedValue({
      years: [
        {
          academicYear: '2025/2026',
          courses: [
            {
              course: { id: '0b6f3a3e-2c8e-4c3f-9d1a-7f2e5b1c9a10', code: 'BIO 201', title: 'Cell Biology' },
              enrolment: { status: 'active' },
              counts: { notes: 8 },
            },
            {
              course: { id: '1c7f4b4f-3d9f-5d40-ae2b-8f3f6c2d0b21', code: 'CHM 101', title: 'Chem' },
              enrolment: { status: 'archived' },
              counts: { notes: 4 },
            },
            {
              course: { id: '2d8f5c50-4e0a-6e51-bf3c-9f407d3e1c32', code: 'PHY 102', title: 'Physics' },
              enrolment: { status: 'active' },
              counts: { notes: 0 },
            },
          ],
        },
      ],
    });
    const { service } = makeService({
      tables: {
        courses: { data: { code: 'BIO 201', level: 200, institution_id: null }, error: null },
        marketplace_study_packs: { data: [], error: null },
      },
    });
    const result = await service.proposeSemester('user-1', '2025/2026');
    expect(result.academicYear).toBe('2025/2026');
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      courseCode: 'BIO 201',
      suggestedTitle: 'BIO 201 Complete Exam Pack',
      creditCost: 5,
      noteCount: 8,
    });
  });
});

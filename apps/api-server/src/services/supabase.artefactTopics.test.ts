/**
 * Topic write-through (Phase 1 · A). course_topics and the topic_id columns
 * existed before anything wrote to them, so these lock the two halves that make
 * the schema real:
 *
 *  1. Every artefact write that already accepts a courseId now resolves the
 *     topic through CourseTopicsService.resolveForArtefact FIRST, against the
 *     course the row ENDS UP with — so a topic from another course, or a topic
 *     with no course, is a PublicError (400) and nothing is written; and a
 *     patch that unfiles the artefact takes the topic with it.
 *  2. topic_id comes back out again — projected by the lists, mapped onto the
 *     records — and, while 20260826120000 is unapplied, its absence degrades to
 *     "no topics" instead of 42703-ing a screen that works today.
 */
import { createDataLayer } from './data';
import { PublicError } from '../utils/safeError';

type Result = { data: unknown; error?: unknown };
type Call = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  select?: string;
  payload?: any;
  filters: unknown[][];
};

let responders: Record<string, (call: Call, index: number) => Result> = {};
let calls: Call[] = [];
let perTable = new Map<string, number>();

const client = {
  from(table: string) {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const api: any = {};
    for (const m of ['eq', 'is', 'in', 'not', 'neq', 'ilike', 'or', 'order', 'limit', 'range', 'gte', 'lte']) {
      api[m] = (...args: unknown[]) => {
        call.filters.push([m, ...args]);
        return api;
      };
    }
    api.select = (cols?: string) => {
      if (cols !== undefined) call.select = cols;
      return api;
    };
    api.insert = (payload: unknown) => {
      call.op = 'insert';
      call.payload = payload;
      return api;
    };
    api.update = (payload: unknown) => {
      call.op = 'update';
      call.payload = payload;
      return api;
    };
    api.delete = () => {
      call.op = 'delete';
      return api;
    };
    const settle = () => {
      const index = perTable.get(table) ?? 0;
      perTable.set(table, index + 1);
      const responder = responders[table];
      return Promise.resolve(responder ? responder(call, index) : { data: null, error: null });
    };
    api.single = () => settle();
    api.maybeSingle = () => settle();
    api.then = (onOk: any, onErr?: any) => settle().then(onOk, onErr);
    return api;
  },
};

// ONE layer for the whole file: getCourseTopicsService memoises the first host
// it is handed, so every test has to drive the same client.
//
// HARNESS (monolith lane M3, Phase B): this used to be
// `Object.create(SupabaseService.prototype)` with the client hung off it. It
// is a real `createDataLayer(...)` over the SAME fake client now, and `service`
// is four arrows into it — kept under that name and shape so the two
// assertions on `service.updateNote` below do not have to change.
const layer = createDataLayer({
  client: client as never,
  supabaseUrl: 'https://example.supabase.co',
  host: { legacyService: undefined } as never,
});
const service: any = {
  supabase: client,
  getClient: () => client,
  createNote: (...args: any[]) => (layer.notes.createNote as any)(...args),
  updateNote: (...args: any[]) => (layer.notes.updateNote as any)(...args),
  getDecks: (...args: any[]) => (layer.decks.getDecks as any)(...args),
  updateDeck: (...args: any[]) => (layer.decks.updateDeck as any)(...args),
};

const COURSE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_COURSE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOPIC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOTE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DECK = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const USER = 'user-1';

const missingColumn = (table: string) => ({
  data: null,
  error: { code: '42703', message: `column ${table}.topic_id does not exist` },
});
const missingColumnOnWrite = (table: string) => ({
  data: null,
  error: {
    code: 'PGRST204',
    message: `Could not find the 'topic_id' column of '${table}' in the schema cache`,
  },
});

const noteRow = (over: Record<string, unknown> = {}) => ({
  id: NOTE,
  user_id: USER,
  title: 'Gas exchange',
  body: '',
  course_id: COURSE,
  topic_id: TOPIC,
  version: 1,
  created_at: '2026-08-26T00:00:00.000Z',
  updated_at: '2026-08-26T00:00:00.000Z',
  ...over,
});

const callsTo = (table: string, op?: Call['op']) =>
  calls.filter((c) => c.table === table && (op ? c.op === op : true));
const filterOf = (call: Call, name: string, column: string) =>
  call.filters.find((f) => f[0] === name && f[1] === column);

beforeEach(() => {
  responders = {};
  calls = [];
  perTable = new Map();
  (layer.notes as any).resolveNoteAccess = jest.fn(async () => ({
    noteId: NOTE,
    ownerId: USER,
    accessRole: 'owner',
    canEdit: true,
    isOwner: true,
  }));
  (layer.offlineBundles as any).verifyDeckAccess = jest.fn(async () => true);
});

describe('createNote — the topic is validated before the insert', () => {
  it('persists topic_id and hands it back, scoped to the note\'s course', async () => {
    responders.course_topics = () => ({ data: { id: TOPIC }, error: null });
    responders.notes = () => ({ data: noteRow(), error: null });

    const note = await service.createNote(USER, {
      title: 'Gas exchange',
      courseId: COURSE,
      topicId: TOPIC,
    });

    const lookup = callsTo('course_topics')[0];
    expect(filterOf(lookup, 'eq', 'id')).toEqual(['eq', 'id', TOPIC]);
    // Scoped to the course, so a topic of another course can never resolve.
    expect(filterOf(lookup, 'eq', 'course_id')).toEqual(['eq', 'course_id', COURSE]);

    expect(callsTo('notes', 'insert')[0].payload).toMatchObject({
      course_id: COURSE,
      topic_id: TOPIC,
    });
    expect(note.topicId).toBe(TOPIC);
  });

  it('rejects a topic from another course and writes nothing', async () => {
    // No row for (topic, course) — the topic belongs to a different course.
    responders.course_topics = () => ({ data: null, error: null });

    await expect(
      service.createNote(USER, { title: 'x', courseId: OTHER_COURSE, topicId: TOPIC })
    ).rejects.toBeInstanceOf(PublicError);

    expect(callsTo('notes', 'insert')).toHaveLength(0);
  });

  it('rejects a topic with no course before it touches the database', async () => {
    await expect(
      service.createNote(USER, { title: 'x', topicId: TOPIC })
    ).rejects.toThrow(/needs a course/i);

    expect(calls).toHaveLength(0);
  });

  it('never names topic_id when no topic is sent (the column may not exist yet)', async () => {
    responders.notes = () => ({ data: noteRow({ topic_id: undefined }), error: null });

    await service.createNote(USER, { title: 'x', courseId: COURSE });

    const insert = callsTo('notes', 'insert')[0];
    expect('topic_id' in insert.payload).toBe(false);
    expect(callsTo('course_topics')).toHaveLength(0);
  });
});

describe('updateNote — the topic follows the course it belongs to', () => {
  it('clears the topic when the course is cleared', async () => {
    responders.notes = (call) => {
      if (call.op === 'update') {
        return { data: noteRow({ course_id: null, topic_id: null }), error: null };
      }
      if (call.select === 'course_id') return { data: { course_id: COURSE }, error: null };
      return { data: { updated_at: '2026-08-26T00:00:00.000Z', version: 1 }, error: null };
    };

    const note = await service.updateNote(USER, NOTE, { courseId: null });

    expect(callsTo('notes', 'update')[0].payload).toMatchObject({
      course_id: null,
      topic_id: null,
    });
    expect(note.topicId).toBeNull();
  });

  it('validates a topic-only edit against the course the note already has', async () => {
    responders.course_topics = () => ({ data: { id: TOPIC }, error: null });
    responders.notes = (call) => {
      if (call.op === 'update') return { data: noteRow(), error: null };
      if (call.select === 'course_id') return { data: { course_id: COURSE }, error: null };
      return { data: { updated_at: '2026-08-26T00:00:00.000Z', version: 1 }, error: null };
    };

    await service.updateNote(USER, NOTE, { topicId: TOPIC });

    // The course came from the ROW, not the request body.
    expect(filterOf(callsTo('course_topics')[0], 'eq', 'course_id')).toEqual([
      'eq',
      'course_id',
      COURSE,
    ]);
    expect(callsTo('notes', 'update')[0].payload.topic_id).toBe(TOPIC);
  });

  it('fails the write when the current-course read errors, instead of clearing the topic', async () => {
    // The data-loss case: re-filing a note under the course it is ALREADY in.
    // supabase-js resolves on a Postgres error, so an unchecked read reports
    // "no course", which reads as a course CHANGE and nulls topic_id — quietly
    // destroying the student's filing on an unrelated edit.
    responders.notes = (call) => {
      if (call.select === 'course_id') {
        return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
      }
      if (call.op === 'update') return { data: noteRow(), error: null };
      return { data: { updated_at: '2026-08-26T00:00:00.000Z', version: 1 }, error: null };
    };

    await expect(service.updateNote(USER, NOTE, { courseId: COURSE })).rejects.toMatchObject({
      code: '57014',
    });
    expect(callsTo('notes', 'update')).toHaveLength(0);
  });

  it('fails a topic-only edit when the current-course read errors, rather than rejecting a valid topic', async () => {
    responders.course_topics = () => ({ data: { id: TOPIC }, error: null });
    responders.notes = (call) => {
      if (call.select === 'course_id') {
        return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
      }
      if (call.op === 'update') return { data: noteRow(), error: null };
      return { data: { updated_at: '2026-08-26T00:00:00.000Z', version: 1 }, error: null };
    };

    // Not a PublicError("A topic needs a course") — that would blame the student
    // for a database failure on a note that has a course.
    await expect(service.updateNote(USER, NOTE, { topicId: TOPIC })).rejects.not.toBeInstanceOf(PublicError);
    expect(callsTo('notes', 'update')).toHaveLength(0);
  });

  it('leaves the topic alone on an edit that mentions neither course nor topic', async () => {
    responders.notes = (call) =>
      call.op === 'update'
        ? { data: noteRow(), error: null }
        : { data: { updated_at: '2026-08-26T00:00:00.000Z', version: 1 }, error: null };

    await service.updateNote(USER, NOTE, { title: 'renamed' });

    expect('topic_id' in callsTo('notes', 'update')[0].payload).toBe(false);
    // No wasted read of the note's current course either.
    expect(calls.filter((c) => c.select === 'course_id')).toHaveLength(0);
  });
});

describe('the artefact lists round-trip the topic', () => {
  it('projects topic_id and returns it on every deck', async () => {
    responders.decks = () => ({
      data: [{ id: DECK, name: 'Respiration', course_id: COURSE, topic_id: TOPIC }],
      error: null,
    });

    const decks = await service.getDecks('deck-reader', false, {});

    expect(callsTo('decks')[0].select).toContain('topic_id');
    expect(decks[0]).toMatchObject({ id: DECK, topic_id: TOPIC });
  });

  it('drops topic_id from the projection instead of 42703-ing the whole list', async () => {
    responders.decks = (call, index) =>
      index === 0
        ? missingColumn('decks')
        : { data: [{ id: DECK, name: 'Respiration', course_id: COURSE }], error: null };

    const decks = await service.getDecks('deck-reader-premigration', false, {});

    const [first, second] = callsTo('decks');
    expect(first.select).toContain('topic_id');
    expect(second.select).not.toContain('topic_id');
    expect(decks[0]).toMatchObject({ id: DECK });
  });

  it('matches nothing for a named topic while the column is missing', async () => {
    responders.decks = () => missingColumn('decks');

    const decks = await service.getDecks('deck-reader-filtered', false, {
      topicFilter: { kind: 'course', id: TOPIC },
    });

    // Nothing can carry a topic yet, so "decks in topic X" is honestly empty —
    // not every deck the student owns.
    expect(decks).toEqual([]);
  });
});

describe('writes survive the unapplied migration', () => {
  it('retries without topic_id when clearing a topic the column cannot hold', async () => {
    responders.decks = (call) => {
      if (call.op === 'update') {
        return 'topic_id' in call.payload
          ? missingColumnOnWrite('decks')
          : { data: { id: DECK, name: 'Renamed', course_id: COURSE }, error: null };
      }
      return { data: { course_id: COURSE }, error: null };
    };

    const deck = await service.updateDeck(DECK, { name: 'Renamed', topicId: null }, USER);

    const updates = callsTo('decks', 'update');
    expect('topic_id' in updates[0].payload).toBe(true);
    expect('topic_id' in updates[1].payload).toBe(false);
    // The rest of the edit still landed.
    expect(deck).toMatchObject({ id: DECK, name: 'Renamed' });
  });
});

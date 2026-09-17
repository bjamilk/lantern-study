/**
 * Scoping the companion to one page of a document.
 *
 * The walk-through's "explain this page" reuses the tutor, and the tutor
 * already has an honesty rule: it may only say "answered from your notes" when
 * note excerpts were actually put in front of the model. The page scope is
 * built to inherit that rule instead of adding a second one — the trusted
 * context becomes the page and NOTHING else, so:
 *   a page with text  → excerpts from that page, and the badge is true
 *   a blank page      → no excerpts at all, and the existing clamp says
 *                       "answered from general knowledge" on its own
 * The failure modes (unapplied migration, missing page, a page belonging to
 * another note) all land in the same place, which is why there is no separate
 * honesty path to get wrong.
 */
jest.mock('./topicMastery', () => ({
  getTopicMasteryService: () => ({ weakTopics: async () => [] }),
}));
jest.mock('./classSections', () => ({
  getClassSectionsService: () => ({ corpusForCompanion: async () => 'CLASS CORPUS TEXT' }),
}));
jest.mock('./notePages', () => ({ getPageText: jest.fn() }));

import { buildTrustedCompanionContext } from './companionContext';
import { getPageText } from './notePages';

const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222';

const NOTE_ROW = {
  id: NOTE_ID,
  title: 'Cell respiration',
  body: 'WHOLE NOTE BODY about every page of the document.',
  summary: 'WHOLE NOTE SUMMARY',
  source_type: 'pdf',
  user_id: 'u1',
};

function mockSupabase() {
  const table = (name: string) => {
    const result =
      name === 'notes'
        ? { data: NOTE_ROW }
        : name === 'profiles'
          ? { data: { name: 'Ada', first_name: 'Ada', settings: {} } }
          : { data: [] };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      limit: async () => result,
      maybeSingle: async () => result,
      order: () => chain,
      then: undefined,
    };
    return chain;
  };
  return {
    getClient: () => ({ from: table }),
    tests: { fetchTestResults: async () => [] },
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('a companion turn scoped to one page', () => {
  it('replaces the whole note with that page, and drops the class corpus', async () => {
    (getPageText as jest.Mock).mockResolvedValue({
      available: true,
      reason: 'ok',
      text: 'PAGE SEVEN TEXT about the Krebs cycle.',
      pageCount: 12,
    });

    const context = await buildTrustedCompanionContext(mockSupabase(), 'u1', {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      pageIndex: 6,
    } as any);

    expect(context.noteContext).toBe('PAGE SEVEN TEXT about the Krebs cycle.');
    expect(context.pageIndex).toBe(6);
    expect(context.attachmentId).toBe(ATTACHMENT_ID);
    // Neither the rest of the note nor the class corpus may ride along: an
    // answer badged "from your notes" has to be from the page on screen.
    expect(context.noteContext).not.toContain('WHOLE NOTE BODY');
    expect(context.noteContext).not.toContain('CLASS CORPUS TEXT');
  });

  it('leaves a blank page with no context at all, so the badge stays honest', async () => {
    (getPageText as jest.Mock).mockResolvedValue({
      available: true,
      reason: 'ok',
      text: '   ',
      pageCount: 12,
    });

    const context = await buildTrustedCompanionContext(mockSupabase(), 'u1', {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      pageIndex: 3,
    } as any);

    // No excerpts → companionChat's clamp reports 'general'. Falling back to
    // the note body here is exactly the bug this asserts against.
    expect(context.noteContext).toBeUndefined();
    expect(context.pageIndex).toBe(3);
  });

  it('says nothing rather than guessing when the pages table is not there yet', async () => {
    (getPageText as jest.Mock).mockResolvedValue({
      available: false,
      reason: 'schema_missing',
      text: '',
      pageCount: 0,
    });

    const context = await buildTrustedCompanionContext(mockSupabase(), 'u1', {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
      pageIndex: 0,
    } as any);

    expect(context.noteContext).toBeUndefined();
  });

  it('ignores a page scope that is not a real attachment id', async () => {
    const context = await buildTrustedCompanionContext(mockSupabase(), 'u1', {
      noteId: NOTE_ID,
      attachmentId: 'not-a-uuid',
      pageIndex: 2,
    } as any);

    // Falls back to the ordinary whole-note turn instead of a half-scoped one.
    expect(getPageText).not.toHaveBeenCalled();
    expect(context.pageIndex).toBeUndefined();
    expect(context.noteContext).toContain('WHOLE NOTE BODY');
  });

  it('leaves an ordinary note turn exactly as it was', async () => {
    const context = await buildTrustedCompanionContext(mockSupabase(), 'u1', {
      noteId: NOTE_ID,
    } as any);

    expect(getPageText).not.toHaveBeenCalled();
    expect(context.noteContext).toContain('WHOLE NOTE BODY');
    expect(context.noteContext).toContain('CLASS CORPUS TEXT');
  });
});

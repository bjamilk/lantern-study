import {
  LESSON_PAGE_CAP,
  applyLessonCommand,
  canOpenPage,
  canOpenTopic,
  clampLessonPages,
  composeLessonNoteBody,
  isLessonGeneratorMissing,
  isLessonNote,
  lessonFromMaterial,
  lessonProgress,
  lessonStudioPriceLine,
  newLessonNoteTitle,
  normalizeGeneratedLesson,
  parseLessonCommand,
  parseLessonNoteBody,
  quizItemsFromLesson,
  resolveLessonStudioNote,
  startLessonSession,
  lessonSourceNotes,
} from './lessonStudio';

const pages = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    title: `P${i + 1}`,
    body: `Body ${i + 1}`,
  }));

function twoTopicSession(mode: 'explore' | 'mastery' = 'mastery') {
  return startLessonSession({
    mode,
    sourceNoteId: 'n1',
    sourceTitle: 'Membranes',
    topics: [
      { title: 'Structure', pages: [{ title: 'Bilayer', body: 'Two layers of lipids.' }] },
      {
        title: 'Transport',
        pages: [
          {
            title: 'Diffusion',
            body: 'High to low.',
            check: {
              stem: 'Diffusion moves from?',
              type: 'short_answer',
              correctAnswer: 'high to low',
            },
          },
        ],
      },
    ],
  });
}

describe('lesson studio', () => {
  it('caps pages at 40', () => {
    const session = startLessonSession({
      mode: 'explore',
      sourceNoteId: 'n1',
      sourceTitle: 'Long',
      topics: [{ title: 'All', pages: pages(50) }],
    });
    expect(session.pages).toHaveLength(LESSON_PAGE_CAP);
    expect(clampLessonPages(pages(50))).toHaveLength(40);
  });

  it('lets Explore skip ahead and keeps Mastery in order', () => {
    const mastery = twoTopicSession('mastery');
    expect(canOpenTopic(mastery, mastery.plan.topics[1].id)).toBe(false);
    expect(canOpenPage(mastery, 1)).toBe(false);
    const jumped = applyLessonCommand(mastery, { type: 'jump', topicNumber: 2 });
    expect(jumped.pageIndex).toBe(0);

    const explore = twoTopicSession('explore');
    expect(canOpenTopic(explore, explore.plan.topics[1].id)).toBe(true);
    const skipped = applyLessonCommand(explore, { type: 'jump', topicNumber: 2 });
    expect(skipped.pageIndex).toBe(1);
  });

  it('marks a Mastery topic complete and opens the next one', () => {
    const next = applyLessonCommand(twoTopicSession('mastery'), { type: 'complete' });
    expect(next.completedTopicIds).toEqual(['topic-1']);
    expect(next.pageIndex).toBe(1);
    expect(lessonProgress(next).percent).toBe(50);
  });

  it('parses spoken commands and leaves unknown lines as chat', () => {
    expect(parseLessonCommand('Quiz me')).toEqual({ type: 'quiz_me' });
    expect(parseLessonCommand('slower please')).toEqual({ type: 'slower' });
    expect(parseLessonCommand('jump to topic 4')).toEqual({ type: 'jump', topicNumber: 4 });
    expect(parseLessonCommand('why does this happen?')).toEqual({
      type: 'chat',
      text: 'why does this happen?',
    });
  });

  it('round-trips a session through the note body', () => {
    const session = twoTopicSession('explore');
    const opened = applyLessonCommand(session, { type: 'jump', topicNumber: 2 });
    const body = composeLessonNoteBody(opened);
    expect(isLessonNote({ title: newLessonNoteTitle('explore', 'Membranes'), body })).toBe(true);
    const parsed = parseLessonNoteBody(body);
    expect(parsed?.pageIndex).toBe(1);
    expect(parsed?.mode).toBe('explore');
    expect(parsed?.pages[1]?.title).toBe('Diffusion');
  });

  it('turns page checks into quiz items and builds from headings when AI is absent', () => {
    const session = twoTopicSession('explore');
    expect(quizItemsFromLesson(session).map((item) => item.stem)).toEqual(['Diffusion moves from?']);

    const fromNotes = lessonFromMaterial({
      mode: 'explore',
      sourceNoteId: 'n1',
      sourceTitle: 'Notes',
      notes: '# One\n\nAlpha.\n\n# Two\n\nBeta.',
      questions: [{ text: 'Q?', type: 'short_answer', correctAnswer: 'A' }],
    });
    expect(fromNotes.pages.map((page) => page.title)).toEqual(['One', 'Two']);
    expect(fromNotes.pages[0]?.check?.stem).toBe('Q?');
  });

  it('normalises a generated payload and names the door note', () => {
    const session = normalizeGeneratedLesson(
      {
        topics: [
          {
            title: 'Intro',
            pages: [{ title: 'Hi', body: 'Hello.', check: { stem: 'x', type: 'true_false', correctAnswer: 'True' } }],
          },
        ],
      },
      { mode: 'mastery', sourceNoteId: 'n1', sourceTitle: 'Cell' }
    );
    expect(session.pages).toHaveLength(1);
    expect(newLessonNoteTitle('mastery', 'Cell')).toBe('Lesson — Mastery · Cell');
    expect(lessonStudioPriceLine()).toMatch(/1 AI use/);
    expect(resolveLessonStudioNote({ lessons: [{ id: 'a' }, { id: 'b' }], selectedNoteId: 'b' })).toEqual(
      { action: 'resume', noteId: 'b' }
    );
    expect(resolveLessonStudioNote({ lessons: [] })).toEqual({ action: 'start' });
  });

  it('treats API 404 payloads as a missing lesson generator', () => {
    expect(isLessonGeneratorMissing({ status: 404, message: 'Error' })).toBe(true);
    expect(
      isLessonGeneratorMissing({
        message: 'Error',
        body: { error: 'Error', message: 'Not found - /api/v1/ai/generate-lesson' },
      })
    ).toBe(true);
    expect(isLessonGeneratorMissing({ status: 503, message: 'Failed to generate a lesson.' })).toBe(
      false
    );
  });

  it('puts ordinary notes ahead of lectures as lesson sources', () => {
    const body = 'Pharmacokinetics is how the body handles a drug over time.'.repeat(2);
    const notes = [
      { id: 'l', title: 'Lecture — 11 Sep', body, sourceType: 'audio' as const },
      { id: 'n', title: 'Pulmonary Embolism', body },
    ];
    expect(lessonSourceNotes(notes).map((note) => note.id)).toEqual(['n', 'l']);
  });
});

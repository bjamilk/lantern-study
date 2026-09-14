import {
  CREATE_FROM_SOURCE_NOUN,
  QUIZ_FROM_CARDS_COUNT,
  normalizeTopicBrief,
  normalizeTopicNoteDrafts,
  sourceCardCopy,
  sourcesForKind,
  splitNoteBodyByChapters,
  starterNoteCountForLevel,
  studyTestDoor,
  topicBriefError,
} from './createFromSource';

describe('createFromSource', () => {
  it('offers flashcards only on the quiz door, and topic on cards', () => {
    expect(sourcesForKind('quiz')).toEqual(['materials', 'flashcards', 'topic', 'scratch']);
    expect(sourcesForKind('cards')).toEqual(['materials', 'topic', 'scratch', 'import']);
    expect(sourcesForKind('lesson')).toEqual(['materials', 'topic', 'scratch']);
    expect(sourcesForKind('notes')).toEqual(['materials', 'topic', 'scratch']);
    expect(sourcesForKind('materials')).toEqual(['topic']);
  });

  it('never describes "from a topic" as picking an existing note', () => {
    const copy = sourceCardCopy('topic', 'cards');
    expect(copy.promise.toLowerCase()).not.toMatch(/use notes already|pick a note|open the materials/);
    expect(sourceCardCopy('flashcards', 'quiz').promise).toContain(String(QUIZ_FROM_CARDS_COUNT));
  });

  it('names the thing each door produces', () => {
    expect(CREATE_FROM_SOURCE_NOUN.cards).toBe('deck');
    expect(CREATE_FROM_SOURCE_NOUN.materials).toBe('notes');
  });

  it('accepts a two-character topic and a skill level', () => {
    expect(normalizeTopicBrief({ title: '  PE  ', level: 'exam', subject: ' Nursing ' })).toEqual({
      title: 'PE',
      level: 'exam',
      subject: 'Nursing',
    });
    expect(normalizeTopicBrief({ title: 'x' })).toBeNull();
    expect(topicBriefError('x')).toMatch(/two characters/);
  });

  it('scales starter notes with the skill level', () => {
    expect(starterNoteCountForLevel('intro')).toBe(3);
    expect(starterNoteCountForLevel('intermediate')).toBe(5);
    expect(starterNoteCountForLevel('exam')).toBe(8);
  });

  it('keeps 3–8 notes with real bodies and drops empty ones', () => {
    const drafts = normalizeTopicNoteDrafts(
      {
        notes: [
          { title: 'One', body: 'A'.repeat(50) },
          { title: 'Thin', body: 'no' },
          { title: 'Two', body: 'B'.repeat(50) },
          { title: 'Three', body: 'C'.repeat(50) },
        ],
      },
      'SDOH',
      5
    );
    expect(drafts).toHaveLength(3);
    expect(drafts[0]?.title).toBe('One');
  });

  it('splits a paste on chapter headings and leaves a single block alone', () => {
    const split = splitNoteBodyByChapters(
      'Notes',
      '# Chapter 1 Heart\n\nThe myocardium pumps blood through the body.\n\n# Chapter 2 Lungs\n\nGas exchange happens in the alveoli of the lung.'
    );
    expect(split).toHaveLength(2);
    expect(split[0]?.title).toMatch(/Heart/);
    expect(splitNoteBodyByChapters('Notes', 'Just one paragraph about the heart and lungs together.')).toEqual([
      { title: 'Notes', body: 'Just one paragraph about the heart and lungs together.' },
    ]);
  });
});

describe('studyTestDoor', () => {
  it('honours an explicit stamp, then attempt kind, then a Quiz: title', () => {
    expect(studyTestDoor({ studyDoor: 'quiz', title: 'Exam' })).toBe('quiz');
    expect(studyTestDoor({ attemptKind: 'exam', title: 'Quiz: cells' })).toBe('test');
    expect(studyTestDoor({ title: 'Quiz: cells' })).toBe('quiz');
    expect(studyTestDoor({ title: 'Practice test' })).toBe('test');
  });
});

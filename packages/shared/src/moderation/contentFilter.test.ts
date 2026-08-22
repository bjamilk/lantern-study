import {
  CONTENT_BLOCK_MESSAGE,
  CONTENT_FLAG_MESSAGE,
  contentFilterText,
  describeContentMatches,
  findContentMatches,
  textContentFlags,
  textFailsContentCheck,
} from './contentFilter';

describe('content filter — block tier (leaked / unreleased exams)', () => {
  it.each([
    'Leaked CHM 101 exam questions, DM me',
    'leak exam paper for tomorrow',
    'Unreleased 2026 GST test',
    "This semester's exam questions and answers",
    'exam expo available',
    'Expo for the CBT — pay before 8am',
    'exam answers before the paper starts',
    'upcoming exam questions for MTH 102',
    'answers to tomorrow’s exam',
    "next week's test answers guaranteed",
    'cbt runs and expo dubs',
  ])('blocks %j', (text) => {
    expect(textFailsContentCheck(text)).toBe(true);
    const matches = findContentMatches(text);
    expect(matches.some((m) => m.severity === 'block' && m.reason === 'leaked_exam')).toBe(true);
    expect(describeContentMatches(matches)).toBe(CONTENT_BLOCK_MESSAGE);
  });
});

describe('content filter — past questions are legitimate', () => {
  it.each([
    'BIO 201 past questions 2019–2025 with worked answers',
    'Past papers bundle for 200 level Chemistry',
    'Compiled past questions and answers, first semester',
    'Last semester’s past questions — verified',
    'Expo 2026 tickets for sale',
    'React Native Expo tutoring for final-year projects',
    'Exam prep tutoring: practice CBT questions',
    'Used Engineering Mathematics textbook, good condition',
  ])('allows %j', (text) => {
    expect(textFailsContentCheck(text)).toBe(false);
    expect(findContentMatches(text)).toEqual([]);
  });
});

describe('content filter — flag tier (copyright-adjacent)', () => {
  it.each([
    "Lecturer's slides for PHY 101, all topics",
    'Textbook PDF — Stroud Engineering Mathematics',
    'Scanned textbook, every chapter',
    'Solution manual for Thomas Calculus',
    'Copyrighted lecture pack, do not share',
    'PDF of the textbook in one zip',
  ])('flags %j without blocking', (text) => {
    expect(textFailsContentCheck(text)).toBe(false);
    const flags = textContentFlags(text);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((m) => m.severity === 'flag' && m.reason === 'copyright')).toBe(true);
    expect(describeContentMatches(flags)).toBe(CONTENT_FLAG_MESSAGE);
  });

  it('stores the regex source so moderation_flags can be audited', () => {
    const flags = textContentFlags('solution manual');
    expect(flags[0]?.pattern).toContain('solution');
  });
});

describe('contentFilterText', () => {
  it('joins the fields a pass should look at and skips blanks', () => {
    expect(contentFilterText('Title', '', null, undefined, 'Body')).toBe('Title\nBody');
    expect(findContentMatches(contentFilterText('Notes', 'leaked exam inside'))).toHaveLength(2);
  });

  it('returns no matches for empty input', () => {
    expect(findContentMatches('')).toEqual([]);
    expect(findContentMatches(null)).toEqual([]);
    expect(describeContentMatches([])).toBe('');
  });
});

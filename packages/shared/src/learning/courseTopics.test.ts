import {
  COURSE_TOPIC_COPY,
  TOPIC_TITLE_MAX,
  compareCourseTopics,
  formatAddTopicOffer,
  formatDeleteTopicTitle,
  sortCourseTopics,
  upsertCourseTopic,
} from './courseTopics';

const topic = (id: string, title: string, position: number) => ({ id, title, position });

describe('compareCourseTopics', () => {
  it('orders by position first', () => {
    expect(compareCourseTopics(topic('a', 'Zebra', 10), topic('b', 'Alpha', 20))).toBeLessThan(0);
    expect(compareCourseTopics(topic('a', 'Alpha', 30), topic('b', 'Zebra', 20))).toBeGreaterThan(0);
  });

  it('falls back to a case-insensitive title when positions are equal', () => {
    expect(compareCourseTopics(topic('b', 'alpha', 10), topic('a', 'Beta', 10))).toBeLessThan(0);
    expect(compareCourseTopics(topic('a', 'BETA', 10), topic('b', 'alpha', 10))).toBeGreaterThan(0);
    // Same title in different case is not a title tiebreak at all.
    expect(compareCourseTopics(topic('a', 'Gas exchange', 10), topic('b', 'GAS EXCHANGE', 10))).toBeLessThan(0);
  });

  it('falls back to id as the last resort, making the order total', () => {
    expect(compareCourseTopics(topic('a', 'Same', 10), topic('b', 'Same', 10))).toBeLessThan(0);
    expect(compareCourseTopics(topic('b', 'Same', 10), topic('a', 'Same', 10))).toBeGreaterThan(0);
    expect(compareCourseTopics(topic('a', 'Same', 10), topic('a', 'Same', 10))).toBe(0);
  });

  it('treats a missing position/title/id as 0 / empty rather than throwing', () => {
    expect(compareCourseTopics({ id: 'a', title: 'Alpha' }, topic('b', 'Beta', 10))).toBeLessThan(0);
    expect(compareCourseTopics({ id: 'a' }, { id: 'b' })).toBeLessThan(0);
    expect(compareCourseTopics(null, undefined)).toBe(0);
  });
});

describe('sortCourseTopics', () => {
  const outline = [topic('c', 'Enzymes', 30), topic('a', 'gas exchange', 10), topic('b', 'Gas Exchange', 10)];

  it('returns outline order without mutating the input', () => {
    const sorted = sortCourseTopics(outline);
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(outline.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('survives a non-array', () => {
    expect(sortCourseTopics(undefined as never)).toEqual([]);
  });
});

describe('upsertCourseTopic', () => {
  const outline = [topic('a', 'Cells', 10), topic('c', 'Enzymes', 30)];

  it('slots a new topic into position order rather than appending it', () => {
    expect(upsertCourseTopic(outline, topic('b', 'Diffusion', 20)).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('replaces an existing topic by id instead of duplicating it', () => {
    const next = upsertCourseTopic(outline, topic('a', 'Cell biology', 10));
    expect(next).toHaveLength(2);
    expect(next[0].title).toBe('Cell biology');
  });

  it('ignores a topic with no id', () => {
    expect(upsertCourseTopic(outline, { id: '', title: 'Nameless', position: 5 })).toHaveLength(2);
  });
});

describe('COURSE_TOPIC_COPY', () => {
  it('caps titles with the one value the server enforces', () => {
    expect(TOPIC_TITLE_MAX).toBe(120);
    expect(COURSE_TOPIC_COPY.titleTooLong).toContain('120');
  });

  it('warns that the outline is shared and that no work is deleted', () => {
    expect(COURSE_TOPIC_COPY.deleteBody).toMatch(/shared/i);
    expect(COURSE_TOPIC_COPY.deleteBody).toMatch(/no work is lost/i);
    expect(COURSE_TOPIC_COPY.deleteBody).toContain(COURSE_TOPIC_COPY.none);
  });
});

describe('copy formatters', () => {
  it('builds the create-row and delete-heading labels', () => {
    expect(formatAddTopicOffer(' Gas exchange ')).toBe('Add ‘Gas exchange’');
    expect(formatDeleteTopicTitle('Gas exchange')).toBe('Delete ‘Gas exchange’?');
    expect(formatDeleteTopicTitle('  ')).toBe(COURSE_TOPIC_COPY.deleteTitle);
    expect(formatDeleteTopicTitle(null)).toBe(COURSE_TOPIC_COPY.deleteTitle);
  });
});

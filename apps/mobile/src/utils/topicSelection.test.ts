import type { CourseTopic } from '@lantern/shared/types';
import { COURSE_TOPIC_COPY } from '@lantern/shared/learning';
import {
  filterTopics,
  formatTopicLabel,
  normalizeTopicTitle,
  suggestTopicCreation,
  topicIdAfterCourseChange,
} from './topicSelection';

const topic = (id: string, title: string, position = 10): CourseTopic => ({
  id,
  courseId: 'course-1',
  title,
  position,
});

describe('topic title normalisation', () => {
  it('mirrors the server: trims and collapses runs of whitespace', () => {
    expect(normalizeTopicTitle('  Gas   exchange \n')).toBe('Gas exchange');
    expect(formatTopicLabel(topic('t1', ' Acid–base  balance '))).toBe('Acid–base balance');
  });

  it('falls back for a blank title instead of rendering an invisible row', () => {
    // Parity with web: an empty label would still be tappable, so the list looks
    // broken rather than showing one damaged topic.
    expect(formatTopicLabel(topic('t1', '   '))).toBe(COURSE_TOPIC_COPY.untitled);
  });
});

describe('filterTopics', () => {
  const outline = [topic('t1', 'Gas exchange', 10), topic('t2', 'Renal clearance', 20)];

  it('is case-insensitive and keeps syllabus order', () => {
    expect(filterTopics(outline, 'GAS').map(t => t.id)).toEqual(['t1']);
    expect(filterTopics(outline, '').map(t => t.id)).toEqual(['t1', 't2']);
  });
});

describe('suggestTopicCreation', () => {
  it('offers the normalised title when nothing matches', () => {
    expect(suggestTopicCreation('  Gas   exchange ', [])).toBe('Gas exchange');
  });

  it('never offers a duplicate — the server unique index is case-insensitive', () => {
    // "gas exchange" would find-or-create the SAME row as "Gas Exchange", so an
    // Add offer here would promise a new topic and silently select the old one.
    expect(suggestTopicCreation('gas exchange', [topic('t1', 'Gas Exchange')])).toBeNull();
  });

  it('refuses a title past the server cap instead of offering a doomed create', () => {
    // Finding #10: past TOPIC_TITLE_MAX the Add row must be absent because the
    // server would reject it — not because the input silently swallowed it.
    expect(suggestTopicCreation('x'.repeat(120), [])).toBe('x'.repeat(120));
    expect(suggestTopicCreation('x'.repeat(121), [])).toBeNull();
  });

  it('offers nothing for an empty query', () => {
    expect(suggestTopicCreation('   ', [])).toBeNull();
  });
});

describe('topicIdAfterCourseChange — a topic may never outlive its course', () => {
  it('keeps the topic when the course is unchanged', () => {
    expect(topicIdAfterCourseChange('t1', 'course-1', 'course-1')).toBe('t1');
  });

  it('drops the topic when the course changes', () => {
    expect(topicIdAfterCourseChange('t1', 'course-1', 'course-2')).toBeNull();
  });

  it('drops the topic when the course is cleared', () => {
    expect(topicIdAfterCourseChange('t1', 'course-1', null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_ACTIVITIES,
  TURN_INTO_TARGETS,
  courseWorkspaceLabel,
  isLectureNote,
  isWalkableAttachment,
  materialsForCourse,
  testsFiledInCourse,
  upsertWorkspaceRecent,
} from './courseWorkspace';

describe('course workspace helpers', () => {
  it('lists eleven activities and only Wave A ones as ready', () => {
    expect(WORKSPACE_ACTIVITIES.map((a) => a.id)).toEqual([
      'notes',
      'walkthrough',
      'cards',
      'quiz',
      'test',
      'lecture',
      'lesson',
      'recap',
      'play',
      'plan',
      'essay',
    ]);
    const ready = WORKSPACE_ACTIVITIES.filter((a) => a.status === 'ready').map((a) => a.id);
    expect(ready).toEqual(['notes', 'walkthrough', 'cards', 'test', 'lecture', 'play', 'plan']);
  });

  it('offers cards and a practice test as Turn into targets', () => {
    expect(TURN_INTO_TARGETS.map((t) => t.id)).toEqual(['cards', 'test']);
  });

  it('keeps recents newest-first, unique, and capped', () => {
    const first = upsertWorkspaceRecent([], 'bio', 10);
    const second = upsertWorkspaceRecent(first, 'csc', 20);
    const again = upsertWorkspaceRecent(second, 'bio', 30);
    expect(again.map((r) => r.courseId)).toEqual(['bio', 'csc']);
    const capped = upsertWorkspaceRecent(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => ({ courseId: id, openedAt: i })),
      'z',
      99,
      8
    );
    expect(capped).toHaveLength(8);
    expect(capped[0]).toEqual({ courseId: 'z', openedAt: 99 });
  });

  it('filters materials by course id, including the mobile snake_case field', () => {
    const notes = [
      { id: '1', courseId: 'bio' },
      { id: '2', courseId: 'csc' },
      { id: '3', courseId: null },
      { id: '4', course_id: 'bio' },
    ];
    expect(materialsForCourse(notes, 'bio').map((n) => n.id)).toEqual(['1', '4']);
  });

  it('files tests by course, source note, or source deck', () => {
    const noteIds = new Set(['n1']);
    const deckIds = new Set(['d1']);
    const tests = [
      { id: 'a', courseId: 'bio' },
      { id: 'b', sourceNoteId: 'n1' },
      { id: 'c', sourceDeckId: 'd1' },
      { id: 'd', deckId: 'other' },
    ];
    expect(testsFiledInCourse(tests, 'bio', noteIds, deckIds).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('recognises lecture notes by title or audio source', () => {
    expect(isLectureNote({ title: 'Lecture — 6 Sep' })).toBe(true);
    expect(isLectureNote({ title: 'Week 3', sourceType: 'audio' })).toBe(true);
    expect(isLectureNote({ title: 'Week 3', sourceType: 'typed' })).toBe(false);
  });

  it('labels a course as code · title', () => {
    expect(courseWorkspaceLabel({ code: 'BIO 201', title: 'Cell Biology' })).toBe(
      'BIO 201 · Cell Biology'
    );
    expect(courseWorkspaceLabel({ code: 'BIO 201', title: 'BIO 201' })).toBe('BIO 201');
  });

  it('only walks uploaded documents', () => {
    expect(isWalkableAttachment({ id: 'a', type: 'pdf' })).toBe(true);
    expect(isWalkableAttachment({ id: 'a', type: 'photos' })).toBe(false);
    expect(isWalkableAttachment({ type: 'pdf' })).toBe(false);
  });
});

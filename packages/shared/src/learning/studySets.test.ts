import { describe, expect, it } from 'vitest';
import {
  isValidStudySetTitle,
  materialsForStudySet,
  normalizeStudySetTitle,
  pickOpenStudySetId,
  studySetLabel,
  studySetNotePayload,
  testsFiledInStudySet,
} from './studySets';
import { STUDY_SET_HOME_PRIMARY_TOOL_IDS, STUDY_SET_HOME_TOOLS } from './studySetHome';

describe('study sets', () => {
  it('normalises and validates titles', () => {
    expect(normalizeStudySetTitle('  Midterm   review  ')).toBe('Midterm review');
    expect(isValidStudySetTitle('')).toBe(false);
    expect(isValidStudySetTitle('Midterm review')).toBe(true);
  });

  it('labels an unnamed set', () => {
    expect(studySetLabel({ title: '  ' })).toBe('Study set');
    expect(studySetLabel({ title: 'PHARM notes' })).toBe('PHARM notes');
  });

  it('filters materials by study set id, including snake_case', () => {
    const notes = [
      { id: '1', studySetId: 'set-a' },
      { id: '2', studySetId: 'set-b' },
      { id: '3', study_set_id: 'set-a' },
      { id: '4', studySetId: null },
    ];
    expect(materialsForStudySet(notes, 'set-a').map((n) => n.id)).toEqual(['1', '3']);
  });

  it('files tests by set, source note, or source deck', () => {
    const noteIds = new Set(['n1']);
    const deckIds = new Set(['d1']);
    const tests = [
      { id: 'a', studySetId: 'set-a' },
      { id: 'b', sourceNoteId: 'n1' },
      { id: 'c', sourceDeckId: 'd1' },
      { id: 'd', deckId: 'other' },
    ];
    expect(testsFiledInStudySet(tests, 'set-a', noteIds, deckIds).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('opens the last set when it still exists, otherwise the first', () => {
    const sets = [{ id: 'a' }, { id: 'b' }];
    expect(pickOpenStudySetId([], 'a')).toBeNull();
    expect(pickOpenStudySetId(sets, 'b')).toBe('b');
    expect(pickOpenStudySetId(sets, 'z')).toBe('a');
    expect(pickOpenStudySetId(sets, null)).toBe('a');
  });

  it('stamps course and set only when they are present', () => {
    expect(studySetNotePayload({ courseId: '', studySetId: 'set-a' })).toEqual({
      studySetId: 'set-a',
    });
    expect(studySetNotePayload({ courseId: 'bio', studySetId: 'set-a' })).toEqual({
      courseId: 'bio',
      studySetId: 'set-a',
    });
  });

  it('lists the StudyFetch study-set tools', () => {
    expect(STUDY_SET_HOME_TOOLS.map((tool) => tool.id)).toEqual([
      'import',
      'quiz',
      'cards',
      'ask',
      'lesson',
      'recap',
      'lecture',
      'play',
      'notes',
      'walkthrough',
      'test',
      'plan',
      'essay',
    ]);
    expect(STUDY_SET_HOME_PRIMARY_TOOL_IDS).toEqual([
      'import',
      'quiz',
      'cards',
      'ask',
      'lesson',
      'recap',
      'lecture',
      'play',
    ]);
  });
});

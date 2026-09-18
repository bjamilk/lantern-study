/**
 * The stepper's numbers, per kind and per path.
 *
 * It fails the way the regression would arrive: someone adds a screen to the
 * quiz path and the header still says "of 4", or a kind that never asked how
 * many questions starts being asked.
 */
import { describe, expect, it } from 'vitest';
import {
  CREATE_FROM_SOURCE_NOUN,
  sourcesForKind,
  type CreateFromSourceId,
  type CreateFromSourceKind,
} from '@lantern/shared';
import { longestSourceForKind, wizardSteps, wizardStepIndex } from './wizardSteps';

const KINDS: CreateFromSourceKind[] = [
  'quiz',
  'cards',
  'recap',
  'lesson',
  'play',
  'essay',
  'test',
  'materials',
  'notes',
];

const ids = (kind: CreateFromSourceKind, source: CreateFromSourceId | null) =>
  wizardSteps(kind, source).map((step) => step.id);

describe('wizardSteps', () => {
  it('always opens on the source screen', () => {
    for (const kind of KINDS) {
      expect(ids(kind, null)[0]).toBe('source');
      for (const source of sourcesForKind(kind)) {
        expect(ids(kind, source)[0]).toBe('source');
      }
    }
  });

  it('asks the quiz door how many, then which types, then a name', () => {
    expect(ids('quiz', 'materials')).toEqual(['source', 'materials', 'count', 'types', 'details']);
  });

  it('asks no other kind how many or which types from materials', () => {
    for (const kind of KINDS) {
      if (kind === 'quiz') continue;
      expect(ids(kind, 'materials')).not.toContain('count');
      expect(ids(kind, 'materials')).not.toContain('types');
    }
  });

  it('keeps the name screen for the four kinds that had one', () => {
    for (const kind of ['quiz', 'recap', 'lesson', 'essay'] as CreateFromSourceKind[]) {
      expect(ids(kind, 'materials')).toContain('details');
    }
    for (const kind of ['cards', 'play', 'test', 'materials', 'notes'] as CreateFromSourceKind[]) {
      expect(ids(kind, 'materials')).not.toContain('details');
    }
  });

  it('splits the topic screen in two on every kind that offers it', () => {
    for (const kind of KINDS) {
      if (!sourcesForKind(kind).includes('topic')) continue;
      expect(ids(kind, 'topic')).toEqual(['source', 'topic', 'depth']);
    }
  });

  it('gives the deck picker and the paste box one screen each', () => {
    expect(ids('quiz', 'flashcards')).toEqual(['source', 'decks']);
    expect(ids('cards', 'import')).toEqual(['source', 'anki']);
  });

  it('ends the wizard on the source screen for from scratch', () => {
    expect(ids('quiz', 'scratch')).toEqual(['source']);
  });

  it('numbers step one against the longest path the kind can take', () => {
    // Quiz: materials is five screens, topic three, flashcards two.
    expect(longestSourceForKind('quiz')).toBe('materials');
    expect(wizardSteps('quiz', null)).toHaveLength(5);
    // Cards: materials stops at the picker, so the topic path is the long one.
    expect(longestSourceForKind('cards')).toBe('topic');
    expect(wizardSteps('cards', null)).toHaveLength(3);
  });

  it('never lets the preview be shorter than a path the student can pick', () => {
    for (const kind of KINDS) {
      const preview = wizardSteps(kind, null).length;
      for (const source of sourcesForKind(kind)) {
        expect(wizardSteps(kind, source).length).toBeLessThanOrEqual(preview);
      }
    }
  });

  it('asks exactly one question on every screen, and names the kind on the first', () => {
    for (const kind of KINDS) {
      for (const source of [null, ...sourcesForKind(kind)] as Array<CreateFromSourceId | null>) {
        for (const step of wizardSteps(kind, source)) {
          expect(step.question.trim().length).toBeGreaterThan(0);
          // One question mark at most, and never two sentences stapled together.
          expect(step.question.split('?').length).toBeLessThanOrEqual(2);
          if (step.accent) expect(step.question).toContain(step.accent);
        }
      }
      expect(wizardSteps(kind, null)[0].question).toContain(CREATE_FROM_SOURCE_NOUN[kind]);
    }
  });

  it('gives every screen a distinct id so an index is unambiguous', () => {
    for (const kind of KINDS) {
      for (const source of sourcesForKind(kind)) {
        const list = ids(kind, source);
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });

  it('finds a screen by id, and falls back to step one for a screen not on this path', () => {
    const steps = wizardSteps('quiz', 'materials');
    expect(wizardStepIndex(steps, 'types')).toBe(3);
    expect(wizardStepIndex(steps, 'topic')).toBe(0);
  });
});

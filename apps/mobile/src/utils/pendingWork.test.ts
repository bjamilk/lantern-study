import {
  pendingWorkKindForEntity,
  pendingWorkItemLabel,
  summarisePendingWork,
} from './pendingWork';

describe('pendingWorkKindForEntity', () => {
  it('maps queue entity types onto student-facing kinds', () => {
    expect(pendingWorkKindForEntity('message')).toBe('message');
    expect(pendingWorkKindForEntity('flashcard')).toBe('flashcard');
    expect(pendingWorkKindForEntity('flashcard_review')).toBe('flashcardReview');
    expect(pendingWorkKindForEntity('deck')).toBe('deck');
    expect(pendingWorkKindForEntity('note')).toBe('note');
    expect(pendingWorkKindForEntity('test_result')).toBe('testResult');
  });

  it('falls back to a generic change rather than dropping unknown work', () => {
    expect(pendingWorkKindForEntity('budget')).toBe('other');
    expect(pendingWorkKindForEntity('something-new')).toBe('other');
  });
});

describe('pendingWorkItemLabel', () => {
  it('pluralises', () => {
    expect(pendingWorkItemLabel('message', 1)).toBe('1 message');
    expect(pendingWorkItemLabel('message', 2)).toBe('2 messages');
    expect(pendingWorkItemLabel('testResult', 1)).toBe('1 test result');
    expect(pendingWorkItemLabel('testResult', 3)).toBe('3 test results');
    expect(pendingWorkItemLabel('other', 2)).toBe('2 changes');
  });
});

describe('summarisePendingWork', () => {
  it('reports nothing pending honestly', () => {
    const summary = summarisePendingWork({});
    expect(summary.total).toBe(0);
    expect(summary.breakdown).toEqual([]);
    expect(summary.breakdownLabel).toBe('');
    expect(summary.label).toBe('Everything is synced');
  });

  it('counts all three sources into one total', () => {
    const summary = summarisePendingWork({
      queueEntityTypes: ['message', 'flashcard'],
      pendingResults: 2,
      pendingScores: 1,
    });
    expect(summary.total).toBe(5);
    expect(summary.breakdownLabel).toBe(
      '1 message, 1 flashcard, 2 test results, 1 quiz score'
    );
    expect(summary.label).toBe(
      '5 items waiting to sync: 1 message, 1 flashcard, 2 test results, 1 quiz score'
    );
  });

  it('matches the copy in the brief for one message plus one flashcard', () => {
    expect(
      summarisePendingWork({ queueEntityTypes: ['message', 'flashcard'] }).label
    ).toBe('2 items waiting to sync: 1 message, 1 flashcard');
  });

  it('does not repeat itself when only one kind is pending', () => {
    expect(summarisePendingWork({ queueEntityTypes: ['flashcard'] }).label).toBe(
      '1 flashcard waiting to sync'
    );
    expect(summarisePendingWork({ pendingResults: 3 }).label).toBe(
      '3 test results waiting to sync'
    );
  });

  it('groups repeated entity types and keeps a stable order', () => {
    const summary = summarisePendingWork({
      queueEntityTypes: ['deck', 'message', 'flashcard', 'message', 'note'],
    });
    expect(summary.total).toBe(5);
    expect(summary.breakdown.map(i => i.kind)).toEqual([
      'message',
      'flashcard',
      'deck',
      'note',
    ]);
    expect(summary.breakdown[0]).toEqual({
      kind: 'message',
      count: 2,
      label: '2 messages',
    });
  });

  it('counts a queued flashcard even when there are no offline test results', () => {
    // The device bug this module exists for: pendingResults was the only
    // source, so this case showed "Pending Sync 0".
    const summary = summarisePendingWork({
      queueEntityTypes: ['flashcard'],
      pendingResults: 0,
      pendingScores: 0,
    });
    expect(summary.total).toBe(1);
  });

  it('folds unknown entity types into "changes" instead of losing them', () => {
    const summary = summarisePendingWork({
      queueEntityTypes: ['budget', 'transaction', 'message'],
    });
    expect(summary.total).toBe(3);
    expect(summary.breakdownLabel).toBe('1 message, 2 changes');
  });

  it('ignores nonsense counts rather than rendering NaN', () => {
    const summary = summarisePendingWork({
      pendingResults: Number.NaN,
      pendingScores: -4,
      queueEntityTypes: ['message'],
    });
    expect(summary.total).toBe(1);
    expect(summary.label).toBe('1 message waiting to sync');
  });
});

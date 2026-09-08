import { classifyJobFailure } from './jobsCore';
import { jobSheetState } from '../components/jobs/jobSheetModel';

describe('classifyJobFailure', () => {
  it('treats a 429 as a daily-cap limit that retrying cannot fix', () => {
    expect(classifyJobFailure({ status: 429, message: 'Daily limit reached' })).toBe('limit');
    expect(classifyJobFailure({ code: 'AI_LIMIT_REACHED' })).toBe('limit');
  });

  it('treats a provider outage as retryable', () => {
    expect(classifyJobFailure({ status: 503 })).toBe('unavailable');
    expect(classifyJobFailure(new Error('AI is temporarily unavailable. Please try again in a moment.'))).toBe('unavailable');
  });

  it('falls back to other for anything else', () => {
    expect(classifyJobFailure(new Error('boom'))).toBe('other');
    expect(classifyJobFailure(null)).toBe('other');
  });
});

describe('failed job sheet actions', () => {
  const base = {
    id: 'j1',
    kind: 'flashcards' as const,
    status: 'failed' as const,
    startedAt: 0,
    sourceTitle: 'SDOH',
    requestedCount: 10,
  };

  it('drops Retry when the job failed on a daily cap', () => {
    const model = jobSheetState({ ...base, failureKind: 'limit', error: 'You have used today\'s runs.' } as never, 1000);
    expect(model.actions).toEqual(['dismiss']);
  });

  it('keeps Retry for a provider outage', () => {
    const model = jobSheetState({ ...base, failureKind: 'unavailable', error: 'AI is temporarily unavailable.' } as never, 1000);
    expect(model.actions).toEqual(['retry', 'dismiss']);
  });
});

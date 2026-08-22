import {
  ALREADY_REPORTED_MESSAGE,
  describeReportError,
  isAlreadyReportedError,
} from './reportErrors';

describe('isAlreadyReportedError', () => {
  it('recognises the shared client 409 (VersionConflictError shape)', () => {
    const conflict = Object.assign(new Error('You have already reported this. Our team will review it.'), {
      name: 'VersionConflictError',
      status: 409,
      code: 'version_conflict',
    });
    expect(isAlreadyReportedError(conflict)).toBe(true);
    expect(isAlreadyReportedError({ status: 409 })).toBe(true);
  });

  it('recognises the sentence even without a status', () => {
    expect(isAlreadyReportedError(new Error('Already reported'))).toBe(true);
  });

  it('does not flag other failures', () => {
    expect(isAlreadyReportedError(Object.assign(new Error('Listing not found'), { status: 404 }))).toBe(false);
    expect(isAlreadyReportedError(new Error('Network request failed'))).toBe(false);
    expect(isAlreadyReportedError(null)).toBe(false);
  });
});

describe('describeReportError', () => {
  it('maps a duplicate to the friendly sentence and keeps other server messages', () => {
    expect(describeReportError({ status: 409 })).toBe(ALREADY_REPORTED_MESSAGE);
    expect(describeReportError(new Error('Invalid reason'))).toBe('Invalid reason');
    expect(describeReportError(undefined)).toMatch(/Could not submit/);
  });
});

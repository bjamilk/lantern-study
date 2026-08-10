import { errorMessage, statusCode } from './jobsBoard';

/**
 * Regression guard: `DELETE /postings/:id/save` used to answer 500 for a
 * malformed uuid. The service hands the raw Postgres error straight up, and
 * 22P02 (invalid_text_representation) carries no `statusCode`, so it fell
 * through to the 500 default.
 */
describe('jobs board error mapping', () => {
  const malformedId = { code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' };

  it('maps a malformed uuid to 400, not 500', () => {
    expect(statusCode(malformedId)).toBe(400);
  });

  it('gives a malformed uuid an actionable message in every environment', () => {
    expect(errorMessage(malformedId)).toBe('Invalid id');
  });

  it('still honours an explicit statusCode on the error', () => {
    expect(statusCode(Object.assign(new Error('Job not found'), { statusCode: 404 }))).toBe(404);
  });

  it('leaves genuine server faults on the fallback', () => {
    expect(statusCode(new Error('connection terminated'))).toBe(500);
    expect(statusCode({ code: '23505' })).toBe(500);
  });

  it('honours a caller-supplied fallback for validation-shaped routes', () => {
    expect(statusCode(new Error('bad payload'), 400)).toBe(400);
  });
});

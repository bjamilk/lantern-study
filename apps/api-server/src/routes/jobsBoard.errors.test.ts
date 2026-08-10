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

/**
 * The three routes without their own try/catch (GET /postings/:id,
 * GET /companies/:id, POST /postings/:id/reports) forward through asyncHandler,
 * so the router-scoped handler is the only thing standing between a malformed
 * :id and a 500. Exercise it directly.
 */
describe('jobs board router error middleware', () => {
  const router = require('./jobsBoard').default;
  const layer = router.stack.filter((l: any) => l.handle.length === 4).pop();

  const run = (err: unknown) => {
    let status: number | undefined;
    let body: unknown;
    let passedOn = false;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    };
    layer.handle(err, {}, res, () => {
      passedOn = true;
    });
    return { status, body, passedOn };
  };

  it('is registered as a 4-arg error handler', () => {
    expect(layer).toBeDefined();
  });

  it('turns a malformed uuid into a 400 instead of letting it reach the 500 handler', () => {
    const out = run({ code: '22P02', message: 'invalid input syntax for type uuid' });
    expect(out.status).toBe(400);
    expect(out.body).toEqual({ success: false, error: 'Invalid id' });
    expect(out.passedOn).toBe(false);
  });

  it('passes every other error through to the global handler', () => {
    const out = run(new Error('connection terminated'));
    expect(out.passedOn).toBe(true);
    expect(out.status).toBeUndefined();
  });
});

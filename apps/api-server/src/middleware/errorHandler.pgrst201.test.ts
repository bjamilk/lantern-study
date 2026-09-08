/**
 * PGRST201 (PostgREST ambiguous embedding) is OUR bug, not the client's, so it
 * must surface as a 5xx that alerting sees — never a 400 that blames the
 * student and hides the failure. This pins the 2026-09-08 roster-outage lesson
 * at the error-handler boundary: see services/postgrestEmbedDisambiguation.test.ts
 * for the query-side guard.
 */
import type { Request, Response, NextFunction } from 'express';
import { ApiError, supabaseErrorHandler, errorHandler } from './errorHandler';

function runSupabaseHandler(err: any): ApiError {
  let captured: unknown;
  const next = ((e: unknown) => {
    captured = e;
  }) as unknown as NextFunction;
  supabaseErrorHandler(err, {} as Request, {} as Response, next);
  expect(captured).toBeInstanceOf(ApiError);
  return captured as ApiError;
}

describe('supabaseErrorHandler maps PostgREST codes', () => {
  it('treats PGRST201 (ambiguous embed) as a 5xx server fault', () => {
    const apiError = runSupabaseHandler({
      code: 'PGRST201',
      message:
        "Could not embed because more than one relationship was found for 'community_members' and 'profiles'",
    });
    // The load-bearing assertion: reverting this to 400 (the pre-fix behaviour
    // that hid the outage from 5xx alerting) fails here.
    expect(apiError.statusCode).toBeGreaterThanOrEqual(500);
    // Marked a genuine server fault, like an unhandled 500 — so errorHandler
    // collapses it to a generic student message in production.
    expect(apiError.isOperational).toBe(false);
    // The server must not hand the vendor phrase to a student.
    expect(apiError.message).not.toContain('Invalid reference or relationship');
  });

  it('still maps the sibling PostgREST codes it always did', () => {
    expect(runSupabaseHandler({ code: 'PGRST116' }).statusCode).toBe(404);
    expect(runSupabaseHandler({ code: '23505' }).statusCode).toBe(409);
    expect(runSupabaseHandler({ code: '42501' }).statusCode).toBe(403);
  });
});

describe('errorHandler renders a PGRST201 failure safely to a student', () => {
  const OLD_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
  });

  function render(apiError: ApiError): { status: number; body: any } {
    let status = 0;
    let body: any;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: any) {
        body = payload;
        return this;
      },
    } as unknown as Response;
    const req = {
      url: '/api/v1/communities/x/members',
      originalUrl: '/api/v1/communities/x/members',
      method: 'GET',
      get: () => undefined,
      params: {},
      query: {},
      body: {},
    } as unknown as Request;
    errorHandler(apiError, req, res, (() => {}) as NextFunction);
    return { status, body };
  }

  it('responds 5xx and never leaks the vendor phrase in production', () => {
    process.env.NODE_ENV = 'production';
    const apiError = runSupabaseHandler({
      code: 'PGRST201',
      message: 'Invalid reference or relationship',
    });
    const { status, body } = render(apiError);
    expect(status).toBeGreaterThanOrEqual(500);
    expect(status).toBeLessThan(600);
    expect(body.message).not.toContain('Invalid reference or relationship');
    expect(body.message).toBe('Something went wrong');
  });
});

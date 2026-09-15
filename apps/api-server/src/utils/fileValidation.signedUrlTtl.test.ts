/**
 * `clampSignedUrlTtl` used to return the 24 h MAXIMUM when no TTL was supplied,
 * for every bucket alike. Most callers supply nothing, so in practice every
 * signed URL the API minted was a day-long bearer token — including links to
 * `job-resumes`, where the object is an applicant's CV.
 *
 * These pin the two halves of the F10 fix: a conservative default, and a lower
 * ceiling for the buckets whose objects are somebody's personal details.
 */
import {
  clampSignedUrlTtl,
  STORAGE_SIGNED_URL_DEFAULT_TTL,
  STORAGE_SIGNED_URL_MAX_TTL,
  STORAGE_SIGNED_URL_MIN_TTL,
} from './fileValidation';

const HOUR = 60 * 60;

describe('clampSignedUrlTtl', () => {
  it('defaults to one hour, not the 24 h maximum', () => {
    expect(STORAGE_SIGNED_URL_DEFAULT_TTL).toBe(HOUR);
    expect(clampSignedUrlTtl()).toBe(HOUR);
    expect(clampSignedUrlTtl(undefined)).toBe(HOUR);
    expect(clampSignedUrlTtl(Number.NaN)).toBe(HOUR);
    expect(clampSignedUrlTtl('3600' as unknown as number)).toBe(HOUR);
  });

  it('still honours an explicit TTL inside the bounds', () => {
    expect(clampSignedUrlTtl(6 * HOUR)).toBe(6 * HOUR);
    expect(clampSignedUrlTtl(900)).toBe(900);
  });

  it('keeps the existing floor and ceiling for ordinary buckets', () => {
    expect(clampSignedUrlTtl(1)).toBe(STORAGE_SIGNED_URL_MIN_TTL);
    expect(clampSignedUrlTtl(99 * HOUR)).toBe(STORAGE_SIGNED_URL_MAX_TTL);
    expect(clampSignedUrlTtl(99 * HOUR, 'marketplace-images')).toBe(STORAGE_SIGNED_URL_MAX_TTL);
  });

  it('caps a sensitive bucket at an hour however long the caller asks for', () => {
    expect(clampSignedUrlTtl(24 * HOUR, 'job-resumes')).toBe(HOUR);
    expect(clampSignedUrlTtl(6 * HOUR, 'job-resumes')).toBe(HOUR);
    // Shorter is always allowed — the dedicated download route asks for ten
    // minutes and must keep getting ten minutes.
    expect(clampSignedUrlTtl(600, 'job-resumes')).toBe(600);
    expect(clampSignedUrlTtl(undefined, 'job-resumes')).toBe(HOUR);
  });

  it('never lets the 5-minute floor push a sensitive bucket above its ceiling', () => {
    // Belt and braces: the floor is applied before the ceiling, so the two
    // bounds cannot be reordered into a TTL longer than the bucket allows.
    expect(clampSignedUrlTtl(0, 'job-resumes')).toBeLessThanOrEqual(HOUR);
    expect(clampSignedUrlTtl(-1, 'job-resumes')).toBe(STORAGE_SIGNED_URL_MIN_TTL);
  });
});

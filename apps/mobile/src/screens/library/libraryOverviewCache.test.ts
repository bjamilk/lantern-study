import type { LibraryOverview } from '@lantern/shared/types';
import {
  libraryOverviewCacheKey,
  parseCachedOverview,
  serializeCachedOverview,
} from './libraryOverviewCache';

const overview = { courses: [{ id: 'c1' }] } as unknown as LibraryOverview;

describe('libraryOverviewCache', () => {
  it('keeps two accounts on one phone apart', () => {
    expect(libraryOverviewCacheKey('user-a')).not.toBe(libraryOverviewCacheKey('user-b'));
  });

  it('round-trips the courses so offline shows the list the student already has', () => {
    const parsed = parseCachedOverview(serializeCachedOverview(overview, 1757260000000));
    expect(parsed?.overview).toEqual(overview);
    expect(parsed?.savedAt).toBe(1757260000000);
  });

  it('treats a missing or corrupt cache as "not got it yet", never as "no courses"', () => {
    expect(parseCachedOverview(null)).toBeNull();
    expect(parseCachedOverview('')).toBeNull();
    expect(parseCachedOverview('{ not json')).toBeNull();
    expect(parseCachedOverview('"a string"')).toBeNull();
    expect(parseCachedOverview('{"savedAt":1}')).toBeNull();
  });

  it('survives a blob written before savedAt existed', () => {
    expect(parseCachedOverview(JSON.stringify({ overview }))?.savedAt).toBe(0);
  });
});

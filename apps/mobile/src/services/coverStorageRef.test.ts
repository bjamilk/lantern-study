/**
 * The cover reference, and the blank tile it used to cause.
 *
 * `POST /decks|notes|study-sets/:id/cover` answers with the raw object path
 * (`{owner}/{scope}/{id}/{ts}-name.webp`) — no bucket segment. The generic
 * storage parser needs one, returned null, and the caller then handed that
 * bare path to `<Image>`, which drew an empty box over the tile art. These
 * tests pin both halves: the path parses against `cover-images`, and nothing
 * that cannot be signed is ever returned as a URI.
 */
import {
  parseCoverStorageRef,
  resolveCoverDisplayUrl,
  resolveStorageDisplayUrl,
} from './storageUrls';

jest.mock('./supabase', () => ({
  API_BASE_URL: 'https://api.example.test',
  getAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer test' })),
}));

const OWNER = '1e547f81-77c8-437a-8154-c84e8cf2045e';

describe('parseCoverStorageRef', () => {
  it.each(['decks', 'notes', 'study-sets'])(
    'signs a bare %s cover path against cover-images',
    scope => {
      const path = `${OWNER}/${scope}/abc123/1757000000000-cover.webp`;
      expect(parseCoverStorageRef(path)).toEqual({ bucket: 'cover-images', path });
    }
  );

  it('accepts a path that already carries the bucket', () => {
    const parsed = parseCoverStorageRef(`cover-images/${OWNER}/decks/abc/x.webp`);
    expect(parsed).toEqual({ bucket: 'cover-images', path: `${OWNER}/decks/abc/x.webp` });
  });

  it('refuses traversal and paths that are not cover objects', () => {
    expect(parseCoverStorageRef(`${OWNER}/decks/../../secrets/x.webp`)).toBeNull();
    expect(parseCoverStorageRef(`${OWNER}/invoices/abc/x.webp`)).toBeNull();
    expect(parseCoverStorageRef(`${OWNER}/decks`)).toBeNull();
    expect(parseCoverStorageRef('')).toBeNull();
    expect(parseCoverStorageRef(null)).toBeNull();
  });
});

describe('resolveCoverDisplayUrl', () => {
  it('returns undefined — never the raw path — for a reference it cannot sign', async () => {
    await expect(resolveCoverDisplayUrl(`${OWNER}/invoices/abc/x.webp`)).resolves.toBeUndefined();
  });

  it('passes a local pick through untouched', async () => {
    const uri = 'file:///data/user/0/com.lanternstudy.app/cache/pick.jpg';
    await expect(resolveCoverDisplayUrl(uri)).resolves.toBe(uri);
  });
});

describe('resolveStorageDisplayUrl', () => {
  it('never hands a schemeless path to <Image>', async () => {
    // A legacy cover-shaped path is now recognised and signed (shared
    // normaliser); the schemeless guard is exercised with a non-cover path.
    await expect(resolveStorageDisplayUrl('uploads/misc/x.webp')).resolves.toBeUndefined();
  });
});

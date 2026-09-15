/**
 * F6 — account deletion actually erases, and says so honestly.
 *
 * The three things that were broken, each pinned by a test here:
 *  - the storage walk was one non-recursive `list(prefix, {limit:1000})`, so
 *    anything nested (every note file, every chat attachment) survived, and the
 *    1000-entry page was never continued;
 *  - `STORAGE_BUCKETS` never touched `job-resumes`, `cover-images` or
 *    `job-company-logos`, so uploaded CVs outlived the account;
 *  - the function returned a bare `true`, so a caller could not tell a complete
 *    erasure from one that left files behind.
 */
jest.mock('./cache', () => ({
  cacheService: {
    invalidateUserCache: jest.fn(async () => {}),
    deletePattern: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
  },
}));

jest.mock('../middleware/aiRateLimit', () => ({
  resetAIUsageForUser: jest.fn(async () => {}),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { deleteUserAccountFully } from './userDataLifecycle';

const USER_ID = 'user-f6';

type BucketState = { objects: string[]; listError?: string; removeError?: string };

interface Fixture {
  buckets: Record<string, BucketState>;
  removed: Array<{ bucket: string; paths: string[] }>;
  listCalls: Array<{ bucket: string; prefix: string; offset: number }>;
  companies: Array<{ id: string }>;
  companyMembers: Array<{ company_id: string; user_id: string }>;
  listings: Array<{ images: unknown }>;
  profileExists: boolean;
  authDeleted: boolean;
}

function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    buckets: {},
    removed: [],
    listCalls: [],
    companies: [],
    companyMembers: [],
    listings: [],
    profileExists: true,
    authDeleted: false,
    ...overrides,
  };
}

/** Immediate children of `prefix`, in the shape Supabase storage returns. */
function listChildren(objects: string[], prefix: string) {
  const base = prefix ? `${prefix}/` : '';
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const path of objects) {
    if (base && !path.startsWith(base)) continue;
    const rest = path.slice(base.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash === -1) files.add(rest);
    else folders.add(rest.slice(0, slash));
  }
  return [
    // Folders come back WITHOUT id/metadata — the only reliable marker.
    ...[...folders].sort().map((name) => ({ name, id: null, metadata: null })),
    ...[...files].sort().map((name) => ({ name, id: `id-${name}`, metadata: { size: 1 } })),
  ];
}

function makeService(fx: Fixture) {
  const client = {
    storage: {
      from(bucket: string) {
        const state = fx.buckets[bucket] || { objects: [] };
        return {
          async list(prefix: string, opts: { limit: number; offset: number }) {
            fx.listCalls.push({ bucket, prefix, offset: opts.offset });
            if (state.listError) return { data: null, error: { message: state.listError } };
            const all = listChildren(state.objects, prefix);
            return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null };
          },
          async remove(paths: string[]) {
            if (state.removeError) return { data: null, error: { message: state.removeError } };
            fx.removed.push({ bucket, paths });
            state.objects = state.objects.filter((p) => !paths.includes(p));
            return { data: paths.map((p) => ({ name: p })), error: null };
          },
        };
      },
    },
    auth: {
      admin: {
        async getUserById() {
          return { data: { user: { id: USER_ID } }, error: null };
        },
        async deleteUser() {
          fx.authDeleted = true;
          return { data: null, error: null };
        },
      },
    },
    from(table: string) {
      const result = (data: unknown) => ({ data, error: null });
      const thenable = (data: unknown) => {
        const p: any = Promise.resolve(result(data));
        p.eq = () => thenable(data);
        p.in = () => thenable(data);
        p.maybeSingle = async () => result(data);
        return p;
      };
      const rowsFor = () => {
        if (table === 'profiles') return fx.profileExists ? { id: USER_ID } : null;
        if (table === 'job_companies') return fx.companies;
        if (table === 'job_company_members') return fx.companyMembers;
        if (table === 'marketplace_listings') return fx.listings;
        if (table === 'dm_threads') return [];
        return [];
      };
      return {
        select: () => thenable(rowsFor()),
        delete: () => thenable([]),
      };
    },
  };
  return { getClient: () => client } as any;
}

describe('deleteUserAccountFully — storage erasure', () => {
  it('walks nested folders recursively instead of only immediate children', async () => {
    const fx = makeFixture({
      buckets: {
        'note-files': {
          objects: [
            `${USER_ID}/flat.pdf`,
            `${USER_ID}/chat/group-1/photo.jpg`,
            `${USER_ID}/chat/dm/thread-1/voice/clip.m4a`,
          ],
        },
      },
    });

    const result = await deleteUserAccountFully(makeService(fx), USER_ID);

    const noteRemovals = fx.removed.filter((r) => r.bucket === 'note-files').flatMap((r) => r.paths);
    expect(noteRemovals.sort()).toEqual([
      `${USER_ID}/chat/dm/thread-1/voice/clip.m4a`,
      `${USER_ID}/chat/group-1/photo.jpg`,
      `${USER_ID}/flat.pdf`,
    ]);
    expect(fx.buckets['note-files']!.objects).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
  });

  it('continues listing past the 1000-entry page and removes in batches of 100', async () => {
    const objects = Array.from({ length: 1205 }, (_, i) => `${USER_ID}/f${String(i).padStart(4, '0')}.png`);
    const fx = makeFixture({ buckets: { 'flashcard-images': { objects: [...objects] } } });

    const result = await deleteUserAccountFully(makeService(fx), USER_ID);

    const batches = fx.removed.filter((r) => r.bucket === 'flashcard-images');
    expect(batches.every((b) => b.paths.length <= 100)).toBe(true);
    expect(batches.flatMap((b) => b.paths)).toHaveLength(1205);
    expect(result.purged.storageObjects).toBe(1205);

    // Pagination actually happened: a second page was requested at offset 1000.
    const paged = fx.listCalls.filter((c) => c.bucket === 'flashcard-images' && c.prefix === USER_ID);
    expect(paged.some((c) => c.offset === 1000)).toBe(true);
  });

  it('purges the three buckets the old list never touched', async () => {
    const fx = makeFixture({
      buckets: {
        'job-resumes': { objects: [`${USER_ID}/cv-uuid.pdf`] },
        'cover-images': { objects: [`${USER_ID}/notes/note-1/cover.webp`] },
        'job-company-logos': { objects: ['company-1/1700-logo.png'] },
      },
      companies: [{ id: 'company-1' }],
      companyMembers: [{ company_id: 'company-1', user_id: USER_ID }],
    });

    const result = await deleteUserAccountFully(makeService(fx), USER_ID);

    expect(fx.buckets['job-resumes']!.objects).toEqual([]);
    expect(fx.buckets['cover-images']!.objects).toEqual([]);
    expect(fx.buckets['job-company-logos']!.objects).toEqual([]);
    expect(result.purged.companyLogoObjects).toBe(1);
    expect(result.ok).toBe(true);
  });

  it('leaves a shared company logo alone and records the skip', async () => {
    const fx = makeFixture({
      buckets: { 'job-company-logos': { objects: ['company-1/1700-logo.png'] } },
      companies: [{ id: 'company-1' }],
      companyMembers: [
        { company_id: 'company-1', user_id: USER_ID },
        { company_id: 'company-1', user_id: 'other-user' },
      ],
    });

    const result = await deleteUserAccountFully(makeService(fx), USER_ID);

    expect(fx.buckets['job-company-logos']!.objects).toEqual(['company-1/1700-logo.png']);
    expect(result.purged.companyLogoObjects).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ bucket: 'job-company-logos', path: 'company-1/' }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('never removes a listing image outside this user\'s own prefix', async () => {
    const fx = makeFixture({
      listings: [
        {
          images: [
            `https://x.supabase.co/storage/v1/object/public/marketplace-images/${USER_ID}/listings/l1/a.jpg`,
            'https://x.supabase.co/storage/v1/object/public/marketplace-images/victim-user/listings/l9/b.jpg',
          ],
        },
      ],
      buckets: { 'marketplace-images': { objects: [] } },
    });

    const result = await deleteUserAccountFully(makeService(fx), USER_ID);

    const removedPaths = fx.removed.filter((r) => r.bucket === 'marketplace-images').flatMap((r) => r.paths);
    expect(removedPaths).toEqual([`${USER_ID}/listings/l1/a.jpg`]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ path: 'victim-user/listings/l9/b.jpg' }),
    ]);
  });
});

describe('deleteUserAccountFully — honest reporting', () => {
  it('reports a partial deletion when a bucket removal fails, and keeps going', async () => {
    const fx = makeFixture({
      buckets: {
        'job-resumes': { objects: [`${USER_ID}/cv.pdf`], removeError: 'storage unavailable' },
        'note-files': { objects: [`${USER_ID}/deep/a.pdf`] },
      },
    });

    const result = await deleteUserAccountFully(makeService(fx), USER_ID);

    expect(result.found).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      expect.objectContaining({ stage: 'storage', bucket: 'job-resumes', message: 'storage unavailable' }),
    ]);
    // The failure did not abort the run: the other bucket was still purged and
    // the auth user was still deleted.
    expect(fx.buckets['note-files']!.objects).toEqual([]);
    expect(fx.authDeleted).toBe(true);
  });

  it('records a listing failure without losing the rest of the purge', async () => {
    const fx = makeFixture({
      buckets: {
        'question-images': { objects: [`${USER_ID}/q1.png`], listError: 'storage backend unavailable' },
        'note-files': { objects: [`${USER_ID}/n1.pdf`] },
      },
    });

    const result = await deleteUserAccountFully(makeService(fx), USER_ID);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.bucket === 'question-images')).toBe(true);
    expect(result.purged.storageObjects).toBe(1);
  });

  it('does not call a lazily-created bucket that does not exist a failure', async () => {
    // `cover-images` only exists once someone uploads a cover. A project where
    // nobody has must not turn every deletion into a false PARTIAL_DELETION.
    const fx = makeFixture({
      buckets: { 'cover-images': { objects: [], listError: 'Bucket not found' } },
    });

    const result = await deleteUserAccountFully(makeService(fx), USER_ID);

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('returns found:false for an account that is already gone', async () => {
    const fx = makeFixture({ profileExists: false });
    const service = makeService(fx);
    service.getClient().auth.admin.getUserById = async () => ({ data: { user: null }, error: null });

    const result = await deleteUserAccountFully(service, USER_ID);

    expect(result).toEqual(
      expect.objectContaining({ ok: false, found: false, failures: [], skipped: [] })
    );
    expect(fx.authDeleted).toBe(false);
  });
});

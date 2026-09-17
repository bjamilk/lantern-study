/**
 * HARNESS (monolith lane M3, Phase B, PR 4): this suite used to construct a
 * real `SupabaseService` and spy on its methods. The class is deleted in this
 * PR. `makeService()` builds the data layer over the same config and hands
 * back the four entry points this suite drives, under the names it already
 * used, plus the client it spies on for storage. The spies move to the
 * namespace that OWNS each collaborator — `storageAcl.createSignedStorageUrl*`
 * and `offlineBundles.verifyDeckAccess` — which is where the deps arrows read
 * them at call time. Every `it` title, every `expect` and every fixture is
 * unchanged.
 */
/**
 * Cover images, service half.
 *
 * Three things have to hold or covers become a support problem:
 *   1. bytes that are not an image are refused BEFORE anything is stored —
 *      a .exe renamed to .png must not land in a bucket;
 *   2. a database without the cover_path column is reported as "not migrated"
 *      (CoverColumnMissingError), not as a generic failure;
 *   3. the bucket is ACL'd: a stranger cannot re-sign someone else's cover,
 *      while a reader of the shared deck/note can.
 */
import {
  COVER_IMAGE_BUCKET,
  COVER_IMAGE_MIGRATION,
  CoverColumnMissingError,
  isMissingCoverPathColumn,
} from './data/coverImages';
import { createDataLayer } from './data';
import { createDataClient } from './data/client';

/** A real 1x1 PNG, so the magic-byte check sees an actual image. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * `client` replaces the service-role client for the tests that used to
 * reassign `(service as any).supabase` after construction — the layer binds its
 * client once, so the substitution happens here instead.
 */
function makeService(client?: unknown) {
  const supabase = (client ??
    createDataClient({
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    } as never)) as never;
  const layer = createDataLayer({
    client: supabase,
    supabaseUrl: 'https://test.supabase.co',
  });
  return {
    supabase: supabase as any,
    layer,
    uploadCoverImage: layer.uploads.uploadCoverImage,
    fetchDeckRecord: layer.offlineBundles.fetchDeckRecord,
    assertCoverColumn: layer.uploads.assertCoverColumn,
    setDeckCoverPath: layer.uploads.setDeckCoverPath,
    canAccessStorageObject: layer.storageAcl.canAccessStorageObject,
  };
}

describe('uploadCoverImage', () => {
  it('refuses bytes that are not an image before touching storage', async () => {
    const service = makeService();
    const storage = jest.spyOn(service.supabase.storage as any, 'from');

    await expect(
      service.uploadCoverImage({
        userId: 'user-1',
        kind: 'deck',
        id: 'deck-1',
        fileName: 'trojan.png',
        base64Data: Buffer.from('MZ\x90\x00 not an image at all').toString('base64'),
        contentType: 'image/png',
      })
    ).rejects.toThrow();

    expect(storage).not.toHaveBeenCalled();
  });

  it('refuses an oversized payload before decoding it as an image', async () => {
    const service = makeService();
    const storage = jest.spyOn(service.supabase.storage as any, 'from');

    await expect(
      service.uploadCoverImage({
        userId: 'user-1',
        kind: 'note',
        id: 'note-1',
        fileName: 'huge.png',
        base64Data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
        contentType: 'image/png',
      })
    ).rejects.toThrow(/10 MB/);

    expect(storage).not.toHaveBeenCalled();
  });

  it('stores under {owner}/{kind}/{id}/ and returns the path, not a persisted URL', async () => {
    const service = makeService();
    const uploads: Array<{ bucket: string; path: string }> = [];
    jest.spyOn(service.supabase.storage as any, 'from').mockImplementation((bucket: any) => ({
      upload: async (path: string) => {
        uploads.push({ bucket, path });
        return { data: { path }, error: null };
      },
    }));
    jest
      .spyOn(service.layer.storageAcl, 'createSignedStorageUrl')
      .mockResolvedValue('https://signed.example/cover?token=abc');
    jest
      .spyOn(service.layer.storageAcl, 'createSignedStorageUrlWithVariant')
      .mockResolvedValue('https://signed.example/cover.thumb?token=abc');

    const result = await service.uploadCoverImage({
      userId: 'user-1',
      kind: 'deck',
      id: 'deck-9',
      fileName: 'my cover!.png',
      base64Data: PNG_BASE64,
      contentType: 'image/png',
    });

    expect(uploads[0].bucket).toBe(COVER_IMAGE_BUCKET);
    // The OBJECT is stored bare under the bucket...
    expect(uploads[0].path).toMatch(/^user-1\/decks\/deck-9\/\d+-my_cover_\.webp$/);
    // ...but the REF handed back and persisted is bucket-qualified. A bare ref
    // makes parseStoredStorageRef return null on every client, which hands the
    // raw path to <img> and draws a blank tile.
    expect(result.path).toMatch(
      /^cover-images\/user-1\/decks\/deck-9\/\d+-my_cover_\.webp$/,
    );
    // The durable value is a path; the signed URL is display-only (24h).
    expect(result.path).not.toMatch(/^https?:/);
    expect(result.url).toBe('https://signed.example/cover?token=abc');
  });

  it('creates the bucket on the first ever cover and retries the upload', async () => {
    const service = makeService();
    let attempts = 0;
    jest.spyOn(service.supabase.storage as any, 'from').mockImplementation(() => ({
      // The sibling thumb uploads through the same mock; count only the
      // cover object's own attempts.
      upload: async (path: string) => {
        if (path.includes('.thumb.')) return { data: { path }, error: null };
        attempts += 1;
        return attempts === 1
          ? { data: null, error: { message: 'Bucket not found' } }
          : { data: { path }, error: null };
      },
    }));
    const createBucket = jest
      .spyOn((service as any).supabase.storage, 'createBucket')
      .mockResolvedValue({ data: { name: COVER_IMAGE_BUCKET }, error: null } as any);
    jest.spyOn(service.layer.storageAcl, 'createSignedStorageUrl').mockResolvedValue('https://signed/x');
    jest.spyOn(service.layer.storageAcl, 'createSignedStorageUrlWithVariant').mockResolvedValue('https://signed/x.thumb');

    const result = await service.uploadCoverImage({
      userId: 'user-1', kind: 'deck', id: 'deck-9',
      fileName: 'c.png', base64Data: PNG_BASE64, contentType: 'image/png',
    });

    expect(createBucket).toHaveBeenCalledWith(COVER_IMAGE_BUCKET, expect.objectContaining({ public: false }));
    expect(attempts).toBe(2);
    expect(result.path).toContain('cover-images/user-1/decks/deck-9/');
  });

  it('surfaces a storage failure as its own error, not a blank one', async () => {
    // The live 500 said only "Failed to set cover image". A bucket that cannot
    // be created has to be nameable from the response and the logs.
    const service = makeService();
    jest.spyOn(service.supabase.storage as any, 'from').mockImplementation(() => ({
      upload: async () => ({ data: null, error: { message: 'Bucket not found' } }),
    }));
    jest
      .spyOn((service as any).supabase.storage, 'createBucket')
      .mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy' } } as any);

    await expect(
      service.uploadCoverImage({
        userId: 'user-1', kind: 'note', id: 'note-1',
        fileName: 'c.png', base64Data: PNG_BASE64, contentType: 'image/png',
      })
    ).rejects.toMatchObject({
      name: 'CoverStorageUnavailableError',
      message: 'Cover storage is not ready',
      detail: expect.stringContaining('row-level security'),
    });
  });

  it('reports an upload that fails for any other storage reason', async () => {
    const service = makeService();
    jest.spyOn(service.supabase.storage as any, 'from').mockImplementation(() => ({
      upload: async () => ({ data: null, error: { message: 'mime type image/webp is not supported' } }),
    }));

    await expect(
      service.uploadCoverImage({
        userId: 'user-1', kind: 'deck', id: 'deck-1',
        fileName: 'c.png', base64Data: PNG_BASE64, contentType: 'image/png',
      })
    ).rejects.toMatchObject({
      name: 'CoverStorageUnavailableError',
      detail: expect.stringContaining('mime type'),
    });
  });
});

describe('isMissingCoverPathColumn', () => {
  it('recognises an unapplied migration', () => {
    expect(
      isMissingCoverPathColumn({ code: '42703', message: 'column decks.cover_path does not exist' })
    ).toBe(true);
    expect(
      isMissingCoverPathColumn({ code: 'PGRST204', message: "Could not find the 'cover_path' column" })
    ).toBe(true);
  });

  it('does not swallow an unrelated missing column', () => {
    expect(
      isMissingCoverPathColumn({ code: '42703', message: 'column decks.topic_id does not exist' })
    ).toBe(false);
    expect(isMissingCoverPathColumn(null)).toBe(false);
  });

  it('reads the column name out of details or hint too', () => {
    // PostgREST does not always put the column in `message`; a detector that
    // only reads `message` answers false and the route 500s.
    expect(
      isMissingCoverPathColumn({
        code: 'PGRST204',
        message: 'Bad Request',
        details: "Could not find the 'cover_path' column of 'study_sets' in the schema cache",
      })
    ).toBe(true);
    expect(
      isMissingCoverPathColumn({
        message: "Could not find the 'cover_path' column of 'notes' in the schema cache",
      })
    ).toBe(true);
  });

  it('tells the student to retry and the operator which migration to apply', () => {
    // The student sees a plain sentence; the machine-readable migration name
    // rides on its own field so the message never has to carry a filename.
    const err = new CoverColumnMissingError();
    expect(err.message).toBe('Covers need a server update — try again later');
    expect(err.migration).toBe(COVER_IMAGE_MIGRATION);
    expect(COVER_IMAGE_MIGRATION).toBe('20260913120000_cover_images.sql');
  });
});

describe('assertCoverColumn', () => {
  function probing(result: any) {
    const service = makeService();
    const calls: Array<{ table: string; columns: string }> = [];
    jest.spyOn(service.supabase as any, 'from').mockImplementation((table: any) => ({
      select: (columns: string) => {
        calls.push({ table, columns });
        return { limit: async () => result };
      },
    }));
    return { service, calls };
  }

  it('probes the right table for one cover_path row', async () => {
    const { service, calls } = probing({ data: [], error: null });
    await service.assertCoverColumn('study-set');
    expect(calls).toEqual([{ table: 'study_sets', columns: 'cover_path' }]);
    await service.assertCoverColumn('deck');
    await service.assertCoverColumn('note');
    expect(calls.map((c) => c.table)).toEqual(['study_sets', 'decks', 'notes']);
  });

  it('throws the migration error when the column is not there', async () => {
    const { service } = probing({
      data: null,
      error: { code: '42703', message: 'column decks.cover_path does not exist' },
    });
    await expect(service.assertCoverColumn('deck')).rejects.toBeInstanceOf(CoverColumnMissingError);
  });

  it('does not refuse the upload for an unrelated read failure', async () => {
    // A probe that fails for any other reason (RLS on an empty table, a blip)
    // must not turn every cover upload into a 503.
    const { service } = probing({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(service.assertCoverColumn('note')).resolves.toBeUndefined();
  });
});

describe('setDeckCoverPath', () => {
  function clientReturning(readResult: any) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => readResult }),
          }),
        }),
        update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    };
  }

  it('reports an unapplied migration as CoverColumnMissingError', async () => {
    const service = makeService(clientReturning({
      data: null,
      error: { code: '42703', message: 'column decks.cover_path does not exist' },
    }));

    await expect(service.setDeckCoverPath('deck-1', 'user-1', 'p.webp')).rejects.toBeInstanceOf(
      CoverColumnMissingError
    );
  });

  it('returns the replaced path so the old object can be deleted', async () => {
    const service = makeService(clientReturning({
      data: { id: 'deck-1', cover_path: 'user-1/decks/deck-1/1-old.webp' },
      error: null,
    }));

    const { previousPath } = await service.setDeckCoverPath('deck-1', 'user-1', 'new.webp');
    expect(previousPath).toBe('user-1/decks/deck-1/1-old.webp');
  });
});

describe('canAccessStorageObject cover-images', () => {
  it('allows the owner without any database round trip', async () => {
    const service = makeService();
    const deckAccess = jest.spyOn(service.layer.offlineBundles, 'verifyDeckAccess');
    await expect(
      service.canAccessStorageObject('user-1', COVER_IMAGE_BUCKET, 'user-1/decks/deck-1/c.webp')
    ).resolves.toBe(true);
    expect(deckAccess).not.toHaveBeenCalled();
  });

  it('denies a signed-out viewer another user cover', async () => {
    const service = makeService();
    await expect(
      service.canAccessStorageObject(null, COVER_IMAGE_BUCKET, 'user-1/decks/deck-1/c.webp')
    ).resolves.toBe(false);
  });

  it('lets a reader of the shared deck re-sign its cover', async () => {
    const service = makeService();
    jest.spyOn(service.layer.offlineBundles, 'verifyDeckAccess').mockResolvedValue(true);
    await expect(
      service.canAccessStorageObject('viewer', COVER_IMAGE_BUCKET, 'user-1/decks/deck-1/c.webp')
    ).resolves.toBe(true);
  });

  it('denies a stranger who cannot read the deck', async () => {
    const service = makeService();
    jest.spyOn(service.layer.offlineBundles, 'verifyDeckAccess').mockResolvedValue(false);
    await expect(
      service.canAccessStorageObject('stranger', COVER_IMAGE_BUCKET, 'user-1/decks/deck-1/c.webp')
    ).resolves.toBe(false);
  });

  it('denies a path outside the known deck/note prefixes', async () => {
    const service = makeService();
    await expect(
      service.canAccessStorageObject('viewer', COVER_IMAGE_BUCKET, 'user-1/secrets/x.webp')
    ).resolves.toBe(false);
  });
});

/**
 * Rows written before covers were persisted bucket-qualified still hold a bare
 * object path. They are qualified on READ, so production covers render with no
 * backfill and no migration.
 */
describe('cover ref normalisation on read', () => {
  it('qualifies a legacy deck cover path on the deck read projection', async () => {
    const service = makeService({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 'deck-9',
                name: 'Deck',
                cover_path: 'user-1/decks/deck-9/1700000000-cover.webp',
              },
              error: null,
            }),
          }),
        }),
      }),
    });

    // fetchDeckRecord is the projection every deck read funnels through.
    const deck = await service.fetchDeckRecord('deck-9');
    expect(deck.coverPath).toBe(
      'cover-images/user-1/decks/deck-9/1700000000-cover.webp',
    );
  });

  it('leaves an already-qualified path alone', async () => {
    const qualified = 'cover-images/user-1/decks/deck-9/1-cover.webp';
    const service = makeService({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'deck-9', name: 'Deck', cover_path: qualified },
              error: null,
            }),
          }),
        }),
      }),
    });

    // fetchDeckRecord is the projection every deck read funnels through.
    const deck = await service.fetchDeckRecord('deck-9');
    expect(deck.coverPath).toBe(qualified);
  });

  it('reports a missing cover as null rather than a bare string', async () => {
    const service = makeService({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'deck-9', name: 'Deck', cover_path: null },
              error: null,
            }),
          }),
        }),
      }),
    });

    // fetchDeckRecord is the projection every deck read funnels through.
    const deck = await service.fetchDeckRecord('deck-9');
    expect(deck.coverPath).toBeNull();
  });
});

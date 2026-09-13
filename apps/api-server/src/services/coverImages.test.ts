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
  SupabaseService,
  COVER_IMAGE_BUCKET,
  COVER_IMAGE_MIGRATION,
  CoverColumnMissingError,
  isMissingCoverPathColumn,
} from './supabase';

/** A real 1x1 PNG, so the magic-byte check sees an actual image. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makeService() {
  return new SupabaseService({
    url: 'https://test.supabase.co',
    serviceRoleKey: 'test-service-role-key',
  });
}

describe('uploadCoverImage', () => {
  it('refuses bytes that are not an image before touching storage', async () => {
    const service = makeService();
    const storage = jest.spyOn((service as any).supabase.storage, 'from');

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
    const storage = jest.spyOn((service as any).supabase.storage, 'from');

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
    jest.spyOn((service as any).supabase.storage, 'from').mockImplementation((bucket: any) => ({
      upload: async (path: string) => {
        uploads.push({ bucket, path });
        return { data: { path }, error: null };
      },
    }));
    jest
      .spyOn(service, 'createSignedStorageUrl')
      .mockResolvedValue('https://signed.example/cover?token=abc');
    jest
      .spyOn(service, 'createSignedStorageUrlWithVariant')
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
    expect(result.path).toMatch(/^user-1\/decks\/deck-9\/\d+-my_cover_\.webp$/);
    // The durable value is a path; the signed URL is display-only (24h).
    expect(result.path).not.toMatch(/^https?:/);
    expect(result.url).toBe('https://signed.example/cover?token=abc');
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

  it('names the migration a operator has to apply', () => {
    expect(new CoverColumnMissingError().message).toContain(COVER_IMAGE_MIGRATION);
    expect(COVER_IMAGE_MIGRATION).toBe('20260913120000_cover_images.sql');
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
    const service = makeService();
    (service as any).supabase = clientReturning({
      data: null,
      error: { code: '42703', message: 'column decks.cover_path does not exist' },
    });

    await expect(service.setDeckCoverPath('deck-1', 'user-1', 'p.webp')).rejects.toBeInstanceOf(
      CoverColumnMissingError
    );
  });

  it('returns the replaced path so the old object can be deleted', async () => {
    const service = makeService();
    (service as any).supabase = clientReturning({
      data: { id: 'deck-1', cover_path: 'user-1/decks/deck-1/1-old.webp' },
      error: null,
    });

    const { previousPath } = await service.setDeckCoverPath('deck-1', 'user-1', 'new.webp');
    expect(previousPath).toBe('user-1/decks/deck-1/1-old.webp');
  });
});

describe('canAccessStorageObject cover-images', () => {
  it('allows the owner without any database round trip', async () => {
    const service = makeService();
    const deckAccess = jest.spyOn(service, 'verifyDeckAccess');
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
    jest.spyOn(service, 'verifyDeckAccess').mockResolvedValue(true);
    await expect(
      service.canAccessStorageObject('viewer', COVER_IMAGE_BUCKET, 'user-1/decks/deck-1/c.webp')
    ).resolves.toBe(true);
  });

  it('denies a stranger who cannot read the deck', async () => {
    const service = makeService();
    jest.spyOn(service, 'verifyDeckAccess').mockResolvedValue(false);
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

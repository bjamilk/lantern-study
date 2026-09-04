import { createSignedUrlBatcher, signedUrlRequestKey } from './signedUrlBatch';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createSignedUrlBatcher', () => {
  it('turns a screenful of photos into ONE request', async () => {
    const batches: Array<Array<{ path: string }>> = [];
    const batcher = createSignedUrlBatcher({
      sign: async (items) => {
        batches.push(items.map((item) => ({ path: item.path })));
        return items.map((item) => ({ signedUrl: `signed:${item.path}` }));
      },
    });

    const urls = await Promise.all(
      ['a', 'b', 'c'].map((path) =>
        batcher.request({ bucket: 'note-files', path, variant: 'original' }, 3600),
      ),
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(urls).toEqual(['signed:a', 'signed:b', 'signed:c']);
  });

  it('asks for the same object once however many cards render it', async () => {
    let signCalls = 0;
    const batcher = createSignedUrlBatcher({
      sign: async (items) => {
        signCalls += 1;
        return items.map((item) => ({ signedUrl: `signed:${item.path}` }));
      },
    });

    const [first, second] = await Promise.all([
      batcher.request({ bucket: 'note-files', path: 'a', variant: 'original' }, 3600),
      batcher.request({ bucket: 'note-files', path: 'a', variant: 'original' }, 3600),
    ]);

    expect(signCalls).toBe(1);
    expect(first).toBe(second);
  });

  it('keeps thumb and original apart', async () => {
    const seen: string[] = [];
    const batcher = createSignedUrlBatcher({
      sign: async (items) => {
        for (const item of items) seen.push(signedUrlRequestKey(item));
        return items.map((item) => ({ signedUrl: `signed:${item.variant}` }));
      },
    });

    const [thumb, original] = await Promise.all([
      batcher.request({ bucket: 'note-files', path: 'a', variant: 'thumb' }, 3600),
      batcher.request({ bucket: 'note-files', path: 'a', variant: 'original' }, 3600),
    ]);

    expect(seen.sort()).toEqual(['note-files:a:original', 'note-files:a:thumb']);
    expect(thumb).toBe('signed:thumb');
    expect(original).toBe('signed:original');
  });

  it('never exceeds the route cap of 40 references per request', async () => {
    const sizes: number[] = [];
    const batcher = createSignedUrlBatcher({
      sign: async (items) => {
        sizes.push(items.length);
        return items.map((item) => ({ signedUrl: `signed:${item.path}` }));
      },
    });

    await Promise.all(
      Array.from({ length: 95 }, (_, i) =>
        batcher.request({ bucket: 'note-files', path: `p${i}`, variant: 'original' }, 3600),
      ),
    );

    expect(sizes).toEqual([40, 40, 15]);
  });

  it('rejects the one item the server refused, not the whole batch', async () => {
    const batcher = createSignedUrlBatcher({
      sign: async (items) =>
        items.map((item) =>
          item.path === 'denied'
            ? { signedUrl: null, error: 'access_denied' }
            : { signedUrl: `signed:${item.path}` },
        ),
    });

    const ok = batcher.request({ bucket: 'note-files', path: 'a', variant: 'original' }, 3600);
    const bad = batcher.request(
      { bucket: 'note-files', path: 'denied', variant: 'original' },
      3600,
    );

    await expect(ok).resolves.toBe('signed:a');
    await expect(bad).rejects.toThrow('access_denied');
  });

  it('rejects every waiter when the request itself fails', async () => {
    const batcher = createSignedUrlBatcher({
      sign: async () => {
        throw new Error('offline');
      },
    });

    await expect(
      batcher.request({ bucket: 'note-files', path: 'a', variant: 'original' }, 3600),
    ).rejects.toThrow('offline');
  });

  it('starts a fresh batch for work that arrives after the flush', async () => {
    let signCalls = 0;
    const batcher = createSignedUrlBatcher({
      sign: async (items) => {
        signCalls += 1;
        return items.map((item) => ({ signedUrl: `signed:${item.path}` }));
      },
    });

    await batcher.request({ bucket: 'note-files', path: 'a', variant: 'original' }, 3600);
    await tick();
    await batcher.request({ bucket: 'note-files', path: 'b', variant: 'original' }, 3600);

    expect(signCalls).toBe(2);
  });

  it('signs a chunk for the shortest TTL anyone in it asked for', async () => {
    const ttls: number[] = [];
    const batcher = createSignedUrlBatcher({
      sign: async (items, expiresInSeconds) => {
        ttls.push(expiresInSeconds);
        return items.map((item) => ({ signedUrl: `signed:${item.path}` }));
      },
    });

    await Promise.all([
      batcher.request({ bucket: 'note-files', path: 'a', variant: 'original' }, 3600),
      batcher.request({ bucket: 'note-files', path: 'b', variant: 'original' }, 900),
    ]);

    expect(ttls).toEqual([900]);
  });
});

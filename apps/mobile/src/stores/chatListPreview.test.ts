import {
  lastDeliveredMessage,
  previewFromServerAndCache,
  resolveGroupPreview,
  type DeliverableMessage,
  type PreviewTimestamped,
} from './chatListPreview';

type Row = PreviewTimestamped &
  DeliverableMessage & { id?: string; text?: string };

const at = (iso: string, extra: Omit<Row, 'createdAt'> = {}): Row => ({
  createdAt: iso,
  ...extra,
});

describe('lastDeliveredMessage', () => {
  it('takes the newest row that actually reached the server', () => {
    const list = [
      at('2026-09-01T10:00:00.000Z', { id: 'a' }),
      at('2026-09-02T10:00:00.000Z', { id: 'b' }),
      at('2026-09-03T10:00:00.000Z', { id: 'c', deliveryState: 'pending' as const }),
      at('2026-09-04T10:00:00.000Z', { id: 'd', deliveryState: 'failed' as const }),
    ];
    expect(lastDeliveredMessage(list)).toMatchObject({ id: 'b' });
  });

  it('skips removed rows and returns undefined when nothing is delivered', () => {
    expect(lastDeliveredMessage([at('2026-09-01T10:00:00.000Z', { isRemoved: true })])).toBeUndefined();
    expect(lastDeliveredMessage([at('2026-09-01T10:00:00.000Z', { removedAt: '2026-09-02' })])).toBeUndefined();
    expect(lastDeliveredMessage([])).toBeUndefined();
  });
});

describe('resolveGroupPreview', () => {
  it('prefers the cached message when the server summary is stale', () => {
    const server = at('2026-07-29T10:00:00.000Z', { text: 'Sure, go ahead' });
    const cached = at('2026-09-05T10:00:00.000Z', { text: 'See you at 4' });
    expect(resolveGroupPreview(server, cached)).toBe(cached);
  });

  it('keeps the server summary when it is the newer one', () => {
    const server = at('2026-09-05T10:00:00.000Z', { text: 'newest' });
    const cached = at('2026-09-01T10:00:00.000Z', { text: 'older' });
    expect(resolveGroupPreview(server, cached)).toBe(server);
  });

  it('breaks a tie in favour of the server copy', () => {
    const server = at('2026-09-05T10:00:00.000Z', { text: 'server' });
    const cached = at('2026-09-05T10:00:00.000Z', { text: 'cached' });
    expect(resolveGroupPreview(server, cached)).toBe(server);
  });

  it('falls back rather than dropping a preview', () => {
    const server = at('2026-09-05T10:00:00.000Z');
    const cached = at('2026-09-01T10:00:00.000Z');
    expect(resolveGroupPreview(undefined, cached)).toBe(cached);
    expect(resolveGroupPreview(server, undefined)).toBe(server);
    expect(resolveGroupPreview(undefined, undefined)).toBeUndefined();
  });

  it('ignores unparseable timestamps instead of letting NaN decide', () => {
    const server = at('2026-09-01T10:00:00.000Z', { text: 'server' });
    const broken = at('not a date', { text: 'cached' });
    expect(resolveGroupPreview(server, broken)).toBe(server);
    expect(resolveGroupPreview(at('nonsense', { text: 's' }), at('2026-09-01T10:00:00.000Z', { text: 'c' })))
      .toMatchObject({ text: 'c' });
  });
});

describe('previewFromServerAndCache', () => {
  it('reconciles a stale list preview with the newer cached thread', () => {
    const server = at('2026-07-29T10:00:00.000Z', { text: 'Sure, go ahead' });
    const cache = [
      at('2026-07-29T10:00:00.000Z', { text: 'Sure, go ahead' }),
      at('2026-09-05T09:00:00.000Z', { text: 'Lecture moved' }),
    ];
    expect(previewFromServerAndCache(server, cache)).toMatchObject({ text: 'Lecture moved' });
  });

  it('never previews a queued message the recipient cannot see yet', () => {
    const server = at('2026-09-04T10:00:00.000Z', { text: 'delivered' });
    const cache = [
      at('2026-09-04T10:00:00.000Z', { text: 'delivered' }),
      at('2026-09-05T10:00:00.000Z', { text: 'queued', deliveryState: 'pending' as const }),
    ];
    expect(previewFromServerAndCache(server, cache)).toMatchObject({ text: 'delivered' });
  });

  it('handles a group with no cached messages', () => {
    const server = at('2026-09-04T10:00:00.000Z', { text: 'only' });
    expect(previewFromServerAndCache(server, undefined)).toBe(server);
  });
});

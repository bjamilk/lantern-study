import {
  DeliveryIntentRegistry,
  reconcileDeliveredItem,
  retryUncertainDelivery,
} from './deliveryIntegrity';

describe('delivery integrity utilities', () => {
  it('reconciles optimistic and realtime aliases into one confirmed item', () => {
    const confirmed = { id: 'server-1', text: 'Hello' };
    const result = reconcileDeliveredItem(
      [
        { id: 'client-1', text: 'Hello' },
        { id: 'server-1', text: 'Hello' },
        { id: 'other', text: 'Later' },
      ],
      confirmed,
      ['client-1']
    );

    expect(result).toEqual([confirmed, { id: 'other', text: 'Later' }]);
  });

  it('keeps repeated reception of one server id at one item', () => {
    const first = reconcileDeliveredItem([], { id: 'server-1', text: 'Hello' });
    const replay = reconcileDeliveredItem(first, { id: 'server-1', text: 'Hello again' });

    expect(replay).toEqual([{ id: 'server-1', text: 'Hello again' }]);
  });

  it('retries an uncertain request once', async () => {
    const request = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('confirmed');

    await expect(retryUncertainDelivery(request)).resolves.toBe('confirmed');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not retry a definitive rejection', async () => {
    const request = jest.fn<Promise<string>, []>().mockRejectedValue(new Error('Forbidden'));

    await expect(retryUncertainDelivery(request)).rejects.toThrow('Forbidden');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reuses an uncertain operation id for a manual retry', () => {
    const registry = new DeliveryIntentRegistry(1_000);
    registry.markUncertain('group:1', 'same payload', 'operation-1', 100);

    expect(registry.resolve('group:1', 'same payload', () => 'operation-2', 200)).toBe(
      'operation-1'
    );

    registry.clear('group:1', 'same payload', 'operation-1');
    expect(registry.resolve('group:1', 'same payload', () => 'operation-2', 300)).toBe(
      'operation-2'
    );
  });
});

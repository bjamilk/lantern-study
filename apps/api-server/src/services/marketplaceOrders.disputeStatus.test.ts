/**
 * #72: the two refusals `resolveDisputeAsAdmin` raises carry their own HTTP
 * status, so the admin console can tell a bad order id from an outage.
 *
 * The status used to be recovered downstream by substring-matching the message
 * ('not found' → 404, 'Only disputed' → 400), which meant rewording either
 * message here silently turned it into a 500 with nothing failing at the throw
 * site. This test is that missing failure.
 */
import { MarketplaceOrdersService } from './marketplaceOrders';
import { PublicError } from '../utils/safeError';

function serviceReading(order: unknown) {
  const svc = new MarketplaceOrdersService({ getClient: () => ({}) } as any);
  (svc as any).getOrderByIdAdmin = jest.fn(async () => order);
  return svc;
}

const statusOf = (err: unknown) => (err as { statusCode?: number }).statusCode;

describe('resolveDisputeAsAdmin raises typed, status-carrying refusals', () => {
  it('raises a 404 PublicError when there is no such order', async () => {
    const svc = serviceReading(null);
    const err = await svc.resolveDisputeAsAdmin('ord_missing', 'refund_buyer').catch((e) => e);

    expect(err).toBeInstanceOf(PublicError);
    expect(statusOf(err)).toBe(404);
  });

  it('raises a 400 PublicError when the order is not disputed', async () => {
    const svc = serviceReading({ id: 'ord_1', status: 'paid', seller_id: 's1' });
    const err = await svc.resolveDisputeAsAdmin('ord_1', 'release_to_seller').catch((e) => e);

    expect(err).toBeInstanceOf(PublicError);
    expect(statusOf(err)).toBe(400);
  });

  it('carries the status independently of the wording, so a reworded message stays a 4xx', async () => {
    // What the console branches on is the statusCode, not these words.
    const missing = await serviceReading(null)
      .resolveDisputeAsAdmin('ord_missing', 'refund_buyer')
      .catch((e) => e);
    const notDisputed = await serviceReading({ id: 'ord_1', status: 'completed', seller_id: 's1' })
      .resolveDisputeAsAdmin('ord_1', 'refund_buyer')
      .catch((e) => e);

    expect([statusOf(missing), statusOf(notDisputed)].every((s) => s! < 500)).toBe(true);
  });
});

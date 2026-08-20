/**
 * Self-minted verified reviews. canUserReviewListing treats an inquiry the
 * SELLER marked 'purchased' as verified-purchase evidence. Before this guard a
 * BUYER could PUT their own inquiry to 'purchased' and then post a fake
 * "verified purchase" review without ever buying. updateInquiryStatus now lets
 * only the seller assert 'purchased'; buyers keep open/negotiating/closed.
 *
 * Drives the prototype method against a stubbed `this` so the huge service is
 * never constructed.
 */
import { SupabaseService } from './supabase';

function chain(result: { data: unknown; error: unknown }) {
  const api: any = {};
  const self = () => api;
  api.select = self;
  api.eq = self;
  api.update = self;
  api.single = async () => result;
  return api;
}

function fakeService(inquiry: Record<string, unknown> | null) {
  return {
    supabase: {
      from: () => chain({ data: inquiry, error: null }),
    },
  };
}

const INQUIRY = { buyer_id: 'buyer-1', seller_id: 'seller-1' };

const call = (self: unknown, status: string, userId: string) =>
  SupabaseService.prototype.updateInquiryStatus.call(self as any, 'inq-1', status, userId);

describe('updateInquiryStatus purchase attestation', () => {
  it("rejects a buyer setting status='purchased' with 403", async () => {
    await expect(call(fakeService(INQUIRY), 'purchased', 'buyer-1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("lets the seller set status='purchased'", async () => {
    await expect(call(fakeService(INQUIRY), 'purchased', 'seller-1')).resolves.toBeTruthy();
  });

  it("lets a buyer set a non-purchase status (e.g. 'closed')", async () => {
    await expect(call(fakeService(INQUIRY), 'closed', 'buyer-1')).resolves.toBeTruthy();
  });

  it('rejects a non-participant with 404', async () => {
    await expect(call(fakeService(INQUIRY), 'purchased', 'stranger-1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

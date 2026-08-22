/**
 * A seller must not be able to push new content into a question bank whose
 * listing moderation took down (read-only once moderated).
 */
jest.mock('./marketplacePayments', () => ({
  marketplacePaystackEnabled: () => false,
  getMarketplacePaymentsService: () => ({ assertSellerCanReceivePayout: jest.fn() }),
}));

import { MarketplaceQuestionBanksService } from './marketplaceQuestionBanks';

function serviceFor(listingStatus: string) {
  const writes: unknown[] = [];
  const db = {
    from: (_table: string) => {
      const api: any = {};
      api.update = (payload: unknown) => {
        writes.push(payload);
        return api;
      };
      api.eq = () => api;
      api.select = async () => ({ data: [{ listing_id: 'listing-1' }], error: null });
      return api;
    },
  };
  const self: any = Object.create(MarketplaceQuestionBanksService.prototype);
  self.supabaseService = {
    getClient: () => db,
    getMarketplaceListingById: jest.fn(async () => ({ id: 'listing-1', user_id: 'seller-1', status: listingStatus })),
  };
  self.validateContent = () => 1;
  self.getBankForListing = async () => ({ listing_id: 'listing-1', version: 3 });
  return { self, writes };
}

const content = { config: {}, questions: [{ id: 'q1' }] } as any;

describe('updateQuestionBankContent moderation guard', () => {
  it('refuses when the listing was taken down by moderation', async () => {
    const { self, writes } = serviceFor('removed_by_admin');
    await expect(
      MarketplaceQuestionBanksService.prototype.updateQuestionBankContent.call(self, 'listing-1', 'seller-1', content, {
        attestation: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/Lantern moderation/) });
    expect(writes).toHaveLength(0);
  });

  it('still lets the seller update an active listing', async () => {
    const { self, writes } = serviceFor('active');
    await expect(
      MarketplaceQuestionBanksService.prototype.updateQuestionBankContent.call(self, 'listing-1', 'seller-1', content, {
        attestation: true,
      }),
    ).resolves.toMatchObject({ version: 4 });
    // First write is the bank content bump; the second keeps the listing's question count honest.
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes[0]).toMatchObject({ version: 4, question_count: 1 });
  });
});

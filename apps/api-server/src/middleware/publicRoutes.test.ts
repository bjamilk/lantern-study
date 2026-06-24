import { isPublicMarketplaceReadPath, isPublicReadRequest } from '../middleware/publicRoutes';

describe('publicRoutes', () => {
  it('detects marketplace listing browse paths', () => {
    expect(isPublicMarketplaceReadPath('/listings')).toBe(true);
    expect(isPublicMarketplaceReadPath('/listings/550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isPublicMarketplaceReadPath('/listings/550e8400-e29b-41d4-a716-446655440000/reviews')).toBe(true);
    expect(isPublicMarketplaceReadPath('/orders')).toBe(false);
  });

  it('detects public read requests on marketplace mount', () => {
    const req = {
      method: 'GET',
      baseUrl: '/api/v1/marketplace',
      path: '/listings',
    } as any;
    expect(isPublicReadRequest(req)).toBe(true);
  });
});

import { mapMarketplaceListingGeography } from './marketplaceListingMapping';

describe('mobile marketplace listing mapping', () => {
  it('preserves campus id and nested campus metadata', () => {
    const campus = {
      id: 'campus-123',
      name: 'Example University',
      city: 'Abuja',
      state: 'FCT',
      slug: 'example-university',
      country_code: 'NG',
    };

    expect(
      mapMarketplaceListingGeography({
        campus_id: 'campus-123',
        country_code: 'NG',
        currency: 'NGN',
        campus,
      })
    ).toEqual({
      campus_id: 'campus-123',
      country_code: 'NG',
      currency: 'NGN',
      campus,
    });
  });

  it('recovers campus id and country from nested metadata', () => {
    const campus = {
      id: 'nested-campus',
      country_code: 'NG',
    };

    expect(mapMarketplaceListingGeography({ campus })).toEqual({
      campus_id: 'nested-campus',
      country_code: 'NG',
      currency: undefined,
      campus,
    });
  });
});

import { mapMarketplaceReviewRow } from './marketplaceReviewMapping';

describe('mapMarketplaceReviewRow', () => {
  const baseRow = {
    id: 'review-1',
    listing_id: 'listing-1',
    reviewer_id: 'user-1',
    rating: 5,
    comment: 'Great notes',
    created_at: '2026-07-23T12:00:00.000Z',
  };

  it('maps a joined profile name for logged-in reviewers', () => {
    const mapped = mapMarketplaceReviewRow({
      ...baseRow,
      profiles: {
        id: 'user-1',
        name: 'Ada Lovelace',
        username: 'ada',
        avatar_url: 'https://example.com/ada.png',
      },
    });

    expect(mapped.reviewer).toEqual({
      id: 'user-1',
      name: 'Ada Lovelace',
      username: 'ada',
      avatar_url: 'https://example.com/ada.png',
    });
  });

  it('unwraps array-shaped nested profiles from PostgREST', () => {
    const mapped = mapMarketplaceReviewRow({
      ...baseRow,
      profiles: [
        {
          id: 'user-1',
          name: 'Ada Lovelace',
          username: 'ada',
          avatar_url: null,
        },
      ],
    });

    expect(mapped.reviewer?.name).toBe('Ada Lovelace');
  });

  it('falls back to username when profile name is blank', () => {
    const mapped = mapMarketplaceReviewRow({
      ...baseRow,
      profiles: {
        id: 'user-1',
        name: '   ',
        username: 'ada',
        avatar_url: null,
      },
    });

    expect(mapped.reviewer?.name).toBe('ada');
  });

  it('never returns an empty reviewer name for a known reviewer id', () => {
    const mapped = mapMarketplaceReviewRow({
      ...baseRow,
      profiles: null,
    });

    expect(mapped.reviewer).toEqual({
      id: 'user-1',
      name: 'User',
      username: undefined,
      avatar_url: undefined,
    });
  });
});

export type MarketplaceReviewerProfile = {
  id?: string;
  name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
};

export type MarketplaceReviewRow = {
  id: string;
  listing_id: string;
  reviewer_id: string;
  rating: number;
  comment?: string | null;
  created_at: string;
  profiles?: MarketplaceReviewerProfile | MarketplaceReviewerProfile[] | null;
  reviewer?: MarketplaceReviewerProfile | MarketplaceReviewerProfile[] | null;
};

function resolveNestedProfile(
  profiles: MarketplaceReviewerProfile | MarketplaceReviewerProfile[] | null | undefined
): MarketplaceReviewerProfile | null {
  if (Array.isArray(profiles)) return profiles[0] ?? null;
  return profiles ?? null;
}

/** Normalize a marketplace review row so clients always receive a reviewer display name. */
export function mapMarketplaceReviewRow(row: MarketplaceReviewRow) {
  const profile = resolveNestedProfile(row.profiles ?? row.reviewer);
  const reviewerId = row.reviewer_id || profile?.id || '';
  const displayName =
    (typeof profile?.name === 'string' && profile.name.trim()) ||
    (typeof profile?.username === 'string' && profile.username.trim()) ||
    '';

  return {
    id: row.id,
    listing_id: row.listing_id,
    reviewer_id: reviewerId,
    rating: row.rating,
    comment: row.comment ?? undefined,
    created_at: row.created_at,
    reviewer: reviewerId
      ? {
          id: profile?.id || reviewerId,
          name: displayName || 'User',
          username: profile?.username || undefined,
          avatar_url: profile?.avatar_url || undefined,
        }
      : undefined,
  };
}

export const MARKETPLACE_REVIEW_SELECT = `
  id,
  listing_id,
  reviewer_id,
  rating,
  comment,
  created_at,
  profiles!reviewer_id (
    id,
    name,
    username,
    avatar_url
  )
`;

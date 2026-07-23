interface CampusMetadata {
  id: string;
  country_code?: string;
}

interface RemoteListingGeography<TCampus extends CampusMetadata> {
  campus_id?: string | null;
  country_code?: string;
  currency?: string;
  campus?: TCampus;
}

export function mapMarketplaceListingGeography<TCampus extends CampusMetadata>(
  listing: RemoteListingGeography<TCampus>
) {
  return {
    campus_id:
      listing.campus_id === undefined ? listing.campus?.id : listing.campus_id,
    country_code: listing.country_code ?? listing.campus?.country_code,
    currency: listing.currency,
    campus: listing.campus,
  };
}

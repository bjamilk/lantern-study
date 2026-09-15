/**
 * Geography normaliser for a remote marketplace listing row.
 *
 * The API returns campus/country on the listing itself for some rows and only
 * on the embedded `campus` relation for others; this picks whichever is
 * present so mappers do not each re-implement the fallback.
 *
 * Main export: `mapMarketplaceListingGeography` (used by marketplaceStore's
 * `mapRemoteListing`). Pure — no store, API or native access.
 *
 * Gotchas: the `campus_id` fallback is `undefined`-only, so an explicit null
 * campus_id stays null and does NOT fall back to `campus.id`.
 */
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

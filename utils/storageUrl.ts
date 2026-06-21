import {
  normalizeStorageUrl,
  normalizeStorageUrls,
} from '@lantern/shared/utils/storageUrl';

export { normalizeStorageUrl, normalizeStorageUrls };

export function normalizeListingImages(images?: string[] | null): string[] {
  return normalizeStorageUrls(images);
}

export function normalizeListingRecord<T extends { images?: string[] | null }>(listing: T): T {
  if (!listing?.images?.length) return listing;
  return {
    ...listing,
    images: normalizeListingImages(listing.images),
  };
}

export function normalizeInquiryRecord<T extends { listing?: { images?: string[] | null } | null }>(
  inquiry: T
): T {
  if (!inquiry?.listing) return inquiry;
  return {
    ...inquiry,
    listing: normalizeListingRecord(inquiry.listing),
  };
}

export function normalizeFavoriteRecord<T extends { listing?: { images?: string[] | null } | null }>(
  favorite: T
): T {
  if (!favorite?.listing) return favorite;
  return {
    ...favorite,
    listing: normalizeListingRecord(favorite.listing),
  };
}

export function normalizeOfferRecord<T extends { listing?: { images?: string[] | null } | null }>(
  offer: T
): T {
  if (!offer?.listing) return offer;
  return {
    ...offer,
    listing: normalizeListingRecord(offer.listing),
  };
}

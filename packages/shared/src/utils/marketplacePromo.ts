export function isSaleActive(saleEndsAt?: string | null): boolean {
  if (!saleEndsAt) return false;
  return new Date(saleEndsAt).getTime() > Date.now();
}

export function formatSaleCountdown(saleEndsAt?: string | null): string | null {
  if (!saleEndsAt || !isSaleActive(saleEndsAt)) return null;

  const ms = new Date(saleEndsAt).getTime() - Date.now();
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `Ends in ${days}d ${hours}h`;
  if (hours > 0) return `Ends in ${hours}h ${minutes}m`;
  if (minutes > 0) return `Ends in ${minutes}m`;
  return 'Ends soon';
}

export function resolveListingDisplayPrice(listing: {
  price?: number | null;
  sale_price?: number | null;
  sale_ends_at?: string | null;
  effective_price?: number | null;
  is_on_sale?: boolean;
}): { base: number; effective: number; onSale: boolean } {
  const base = Number(listing.price) || 0;
  if (listing.effective_price != null && listing.is_on_sale) {
    return { base, effective: Number(listing.effective_price), onSale: true };
  }
  const salePrice = listing.sale_price != null ? Number(listing.sale_price) : null;
  if (salePrice != null && isSaleActive(listing.sale_ends_at)) {
    return { base, effective: salePrice, onSale: true };
  }
  return { base, effective: base, onSale: false };
}

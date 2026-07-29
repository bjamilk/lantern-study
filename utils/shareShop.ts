export function getShopShareUrl(sellerId: string): string {
  if (typeof window === 'undefined') return `/marketplace/seller/${sellerId}`;
  return `${window.location.origin}/marketplace/seller/${sellerId}`;
}

export async function shareShopLink(
  sellerId: string,
  shopName?: string,
): Promise<'shared' | 'copied'> {
  const url = getShopShareUrl(sellerId);
  const title = shopName?.trim() || 'Shop';
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ title, text: `Check out ${title} on Lantern`, url });
      return 'shared';
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}

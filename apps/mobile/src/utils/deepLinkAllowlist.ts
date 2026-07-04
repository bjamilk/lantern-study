const ALLOWED_DEEP_LINK_HOSTS = new Set(['lanternstudy.app', 'www.lanternstudy.app']);
const ALLOWED_DEEP_LINK_SCHEMES = new Set(['lanternstudy']);

export function isAllowedMobileDeepLink(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  try {
    if (url.startsWith('lanternstudy://') || url.startsWith('lanternstudy:/')) {
      return true;
    }

    const normalized = url.replace(/^lanternstudy:\/+/i, 'https://lanternstudy.app/');
    const parsed = new URL(normalized.startsWith('http') ? normalized : `https://lanternstudy.app/${normalized}`);

    if (ALLOWED_DEEP_LINK_SCHEMES.has(parsed.protocol.replace(':', ''))) {
      return true;
    }

    return ALLOWED_DEEP_LINK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isAllowedMobileAuthUrl(url: string): boolean {
  if (!isAllowedMobileDeepLink(url)) return false;

  try {
    const normalized = url.replace(/^lanternstudy:\/+/i, 'https://lanternstudy.app/');
    const parsed = new URL(normalized.startsWith('http') ? normalized : `https://lanternstudy.app/${normalized}`);
    const path = parsed.pathname.toLowerCase();
    return (
      path.includes('reset-password')
      || path.includes('verify-email')
      || parsed.searchParams.has('access_token')
      || parsed.searchParams.has('code')
      || parsed.hash.includes('access_token')
    );
  } catch {
    return false;
  }
}

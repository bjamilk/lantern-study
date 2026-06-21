/**
 * Global session expiry handler for web client API calls.
 */
let sessionExpiredHandler: ((message?: string) => void) | null = null;

export function setSessionExpiredHandler(handler: (message?: string) => void): void {
  sessionExpiredHandler = handler;
}

export function notifySessionExpired(message = 'Your session has expired. Please sign in again.'): void {
  sessionExpiredHandler?.(message);
}

export async function refreshWebSession(): Promise<boolean> {
  try {
    const { supabase, setCachedAuthToken } = await import('./supabase');
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session?.access_token) return false;
    setCachedAuthToken(data.session.access_token, data.session.user?.id);
    return true;
  } catch {
    return false;
  }
}

/** Returns true when caller should retry the request after refresh. */
export async function handleApiAuthFailure(status: number): Promise<boolean> {
  if (status !== 401 && status !== 403) return false;
  const refreshed = await refreshWebSession();
  if (refreshed) return true;
  notifySessionExpired();
  return false;
}

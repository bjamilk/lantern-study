import { resolvePlatformAdmin } from '@lantern/shared';
import { useAuthStore } from '../stores/authStore';

/** Same JWT `app_metadata.is_platform_admin` check as web `usePlatformAdmin`. */
export function usePlatformAdmin(): boolean {
  const user = useAuthStore((s) => s.user);
  return resolvePlatformAdmin(user);
}

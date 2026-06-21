import { useEffect } from 'react';
import { getAuthHeaders, API_BASE_URL } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';

const HEARTBEAT_MS = 2 * 60 * 1000;

async function sendPresenceHeartbeat(): Promise<void> {
  const headers = await getAuthHeaders();
  await fetch(`${API_BASE_URL}/api/v1/users/presence/heartbeat`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function usePresenceHeartbeat(): void {
  const userId = useAuthStore(s => s.user?.id);
  const showOnlineStatus = useSettingsStore(s => s.settings.privacy.showOnlineStatus);

  useEffect(() => {
    if (!userId || !showOnlineStatus) return;

    const beat = () => {
      void sendPresenceHeartbeat().catch(() => {});
    };

    beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [userId, showOnlineStatus]);
}

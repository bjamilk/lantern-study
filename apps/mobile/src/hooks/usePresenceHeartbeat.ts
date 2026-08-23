import { useEffect } from 'react';
import { getAuthHeaders, API_BASE_URL } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';

const HEARTBEAT_MS = 2 * 60 * 1000;

/**
 * Phase 3 M — study intent rides the EXISTING heartbeat rather than a second
 * timer. Screens declare what the user is studying via setStudyIntent(); the
 * beat already running for online status carries it.
 *
 * The server is the privacy enforcement point: a user who has switched off
 * showStudyActivity or showOnlineStatus is never written to study_presence,
 * whatever a screen sets here.
 */
export interface StudyIntent {
  context?: 'studying' | 'reviewing' | 'testing' | 'reading' | 'writing';
  courseId?: string;
  topic?: string;
}

let currentStudyIntent: StudyIntent | null = null;

export function setStudyIntent(intent: StudyIntent | null): void {
  currentStudyIntent = intent;
}

async function sendPresenceHeartbeat(): Promise<void> {
  const headers = await getAuthHeaders();
  await fetch(`${API_BASE_URL}/api/v1/users/presence/heartbeat`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(currentStudyIntent ?? {}),
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

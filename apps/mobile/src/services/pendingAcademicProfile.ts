/**
 * Sign-up collects institution / programme / level before the user has a
 * session (email confirmation may be required). The PostgREST profile insert
 * is best-effort and anonymous clients cannot call PUT /users/:id, so the
 * fields are stashed locally and replayed on the first authenticated boot.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveAcademicProfile, type AcademicProfilePatch } from './academic';

const STORAGE_KEY = 'lantern_pending_academic_profile';

interface PendingAcademicProfile {
  email: string;
  fields: AcademicProfilePatch;
  savedAt: number;
}

export async function stashPendingAcademicProfile(email: string, fields: AcademicProfilePatch): Promise<void> {
  const payload: PendingAcademicProfile = { email: email.trim().toLowerCase(), fields, savedAt: Date.now() };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
}

export async function clearPendingAcademicProfile(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

/**
 * Apply a stashed academic profile for this user (matched by email) and
 * clear it. Returns true when something was written. Never throws.
 */
export async function applyPendingAcademicProfile(userId: string, email: string | null | undefined): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const pending = JSON.parse(raw) as PendingAcademicProfile;
    if (!pending?.fields || !email || pending.email !== email.trim().toLowerCase()) return false;
    // Older than 30 days: stale — drop silently.
    if (Date.now() - (pending.savedAt || 0) > 30 * 24 * 60 * 60 * 1000) {
      await clearPendingAcademicProfile();
      return false;
    }
    await saveAcademicProfile(userId, pending.fields);
    await clearPendingAcademicProfile();
    return true;
  } catch (error) {
    console.warn('[Academic] Could not apply pending academic profile:', error);
    return false;
  }
}

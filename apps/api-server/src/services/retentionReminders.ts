/**
 * Phase 4 U — study reminders (due cards / streak at risk) and weekly summary.
 *
 * Producers only: claim rows in retention_reminders_sent, then createNotification
 * (prefs + Expo) or Resend. Never invent a second notification stack.
 */
import { isCardDue } from '@lantern/shared/utils/srs';
import { shouldSendWeeklyDigest } from '@lantern/shared/settings';
import type { SupabaseService } from './supabase';
import { isAlertMailConfigured, sendWeeklySummaryEmail } from './alertMail';
import { logger } from '../utils/logger';

export const STUDY_REMINDER_NOTIFICATION_TYPE = 'srs_reminder';

const SCAN_LIMIT = 400;

export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** ISO week key `YYYY-Www` in UTC. */
export function utcWeekKey(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function claimReminder(
  supabaseService: SupabaseService,
  userId: string,
  key: string,
): Promise<boolean> {
  const { error } = await supabaseService
    .getClient()
    .from('retention_reminders_sent')
    .insert({ user_id: userId, reminder_key: key });
  if (!error) return true;
  if ((error as { code?: string }).code !== '23505') {
    logger.warn('Could not claim retention reminder', { key, error: error.message });
  }
  return false;
}

export interface StudyReminderSweepResult {
  dueCards: number;
  streakAtRisk: number;
}

export async function processStudyReminders(
  supabaseService: SupabaseService,
): Promise<StudyReminderSweepResult> {
  const db = supabaseService.getClient();
  const day = utcDayKey();
  const nowIso = new Date().toISOString();
  const result: StudyReminderSweepResult = { dueCards: 0, streakAtRisk: 0 };

  const dueByUser = new Map<string, number>();
  const { data: cards, error: cardError } = await db
    .from('flashcards')
    .select('id, srs_data, decks!inner(user_id)')
    .not('srs_data', 'is', null)
    .limit(2000);
  if (cardError) {
    logger.error('Failed to load flashcards for study reminders', { error: cardError.message });
  } else {
    for (const row of cards || []) {
      const deck = Array.isArray((row as any).decks) ? (row as any).decks[0] : (row as any).decks;
      const userId = deck?.user_id as string | undefined;
      if (!userId) continue;
      if (!isCardDue((row as any).srs_data)) continue;
      dueByUser.set(userId, (dueByUser.get(userId) || 0) + 1);
    }
  }

  const { data: streaks, error: streakError } = await db
    .from('user_streaks')
    .select('user_id, current_streak, last_login_date')
    .gt('current_streak', 0)
    .limit(SCAN_LIMIT);
  if (streakError) {
    logger.error('Failed to load streaks for study reminders', { error: streakError.message });
  }

  const atRisk = new Set<string>();
  for (const row of streaks || []) {
    const last = row.last_login_date ? String(row.last_login_date).slice(0, 10) : '';
    if (last && last < day && Number(row.current_streak) > 0) {
      atRisk.add(String(row.user_id));
    }
  }

  const userIds = new Set<string>([...dueByUser.keys(), ...atRisk]);
  for (const userId of userIds) {
    const due = dueByUser.get(userId) || 0;
    const risk = atRisk.has(userId);
    if (!due && !risk) continue;
    const key = `study:${day}`;
    if (!(await claimReminder(supabaseService, userId, key))) continue;

    const parts: string[] = [];
    if (due > 0) {
      parts.push(`${due} card${due === 1 ? '' : 's'} due`);
    }
    if (risk) parts.push('your streak is at risk');
    const notification = await supabaseService.createNotification(userId, {
      type: STUDY_REMINDER_NOTIFICATION_TYPE,
      message: parts.join(' · ').replace(/^./, (c) => c.toUpperCase()),
      link: '/flashcards',
      data: { dueCount: due, streakAtRisk: risk, at: nowIso },
    });
    if (notification) {
      if (due > 0) result.dueCards += 1;
      if (risk) result.streakAtRisk += 1;
    }
  }

  if (result.dueCards || result.streakAtRisk) {
    logger.info('Study reminders sent', result);
  }
  return result;
}

export async function processWeeklySummary(
  supabaseService: SupabaseService,
): Promise<{ sent: number }> {
  if (!isAlertMailConfigured()) return { sent: 0 };

  const db = supabaseService.getClient();
  const week = utcWeekKey();
  const { data: profiles, error } = await db
    .from('profiles')
    .select('id, settings, name')
    .limit(SCAN_LIMIT);
  if (error) {
    logger.error('Failed to load profiles for weekly summary', { error: error.message });
    return { sent: 0 };
  }

  let sent = 0;
  for (const profile of profiles || []) {
    if (!shouldSendWeeklyDigest(profile.settings)) continue;
    const userId = String(profile.id);
    const key = `weekly:${week}`;
    if (!(await claimReminder(supabaseService, userId, key))) continue;

    const { data: authUser } = await db.auth.admin.getUserById(userId);
    const to = authUser?.user?.email;
    if (!to) continue;

    const { data: streak } = await db
      .from('user_streaks')
      .select('current_streak')
      .eq('user_id', userId)
      .maybeSingle();
    const currentStreak = Number(streak?.current_streak) || 0;

    const delivered = await sendWeeklySummaryEmail({
      to,
      name: typeof profile.name === 'string' ? profile.name : null,
      streak: currentStreak,
    });
    if (delivered) sent += 1;
  }

  if (sent) logger.info('Weekly summaries sent', { sent, week });
  return { sent };
}

export function startRetentionJobs(supabaseService: SupabaseService): void {
  if (process.env.ENABLE_MARKETPLACE_JOBS !== 'true') {
    logger.info('Retention reminder jobs disabled (set ENABLE_MARKETPLACE_JOBS=true)');
    return;
  }
  const runStudy = async () => {
    try {
      await processStudyReminders(supabaseService);
    } catch (err) {
      logger.error('Study reminder job failed', err);
    }
  };
  const runWeekly = async () => {
    try {
      await processWeeklySummary(supabaseService);
    } catch (err) {
      logger.error('Weekly summary job failed', err);
    }
  };
  void runStudy();
  void runWeekly();
  setInterval(() => void runStudy(), 4 * 60 * 60 * 1000);
  setInterval(() => void runWeekly(), 60 * 60 * 1000);
  logger.info('Retention reminder jobs scheduled');
}

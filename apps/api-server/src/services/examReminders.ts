/**
 * Exam reminders — three per (student, course, exam date): a week out, the day
 * before, and the morning of.
 *
 * Built on the retentionReminders pattern deliberately: claim a row in
 * `retention_reminders_sent`, then `createNotification`. There is exactly one
 * notification stack in this codebase and this is not a second one — it reuses
 * the same ledger table with an extended key, so no migration is needed
 * (`reminder_key` is free text, unique per user).
 *
 * The key is `exam:<courseId>:<examDate>:<stage>`. The DATE is in the key, and
 * that is the whole design: moving an exam mints three fresh keys, so the new
 * date fires and the old date's already-claimed rows can never fire again. A
 * key of `exam:<courseId>:<stage>` would have silently swallowed every reminder
 * for the rescheduled exam — the student would be told nothing precisely
 * because they kept the app up to date.
 *
 * Timing is in the STUDENT's day, not UTC. `profiles.settings.timezone` when
 * it is there, Africa/Lagos otherwise (where the students are). A "morning of"
 * reminder that lands at 01:00 is not a morning reminder.
 */
import type { DataLayer } from './data';
import { getTopicMasteryService } from './topicMastery';
import { logger } from '../utils/logger';

export const EXAM_REMINDER_NOTIFICATION_TYPE = 'exam_reminder';

/** Where our students are. Used whenever a profile carries no timezone. */
export const DEFAULT_TIMEZONE = 'Africa/Lagos';

/** Nothing fires before this local hour — see the "morning of" note above. */
export const REMINDER_LOCAL_HOUR = 6;

export const EXAM_REMINDER_STAGES = ['week', 'day', 'morning'] as const;
export type ExamReminderStage = (typeof EXAM_REMINDER_STAGES)[number];

/** Most urgent first. The one we deliver is the first that is due. */
const STAGES_BY_URGENCY: ExamReminderStage[] = ['morning', 'day', 'week'];

const STAGE_MAX_DAYS: Record<ExamReminderStage, number> = {
  morning: 0,
  day: 1,
  week: 7,
};

const SCAN_LIMIT = 500;

export function examReminderKey(
  courseId: string,
  examDate: string,
  stage: ExamReminderStage
): string {
  return `exam:${courseId}:${examDate}:${stage}`;
}

/** The student's own calendar date and hour right now. */
export function localNow(
  now: Date,
  timeZone: string
): { date: string; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    // An unknown timezone string must not stop every reminder in the sweep.
    return localNow(now, DEFAULT_TIMEZONE);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // en-CA renders midnight as "24" in some ICU versions.
  const hour = Number(get('hour')) % 24;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour };
}

/** Whole days from one YYYY-MM-DD to another. Negative once the exam is past. */
export function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Which stages are due, most urgent first.
 *
 * A stage is due once the exam is within its window, not only exactly on its
 * day: a student who adds an exam date two days out still deserves the
 * heads-up. Every due stage is then claimed but only the most urgent is sent,
 * so that student gets one message ("tomorrow"), not two.
 */
export function dueStages(daysUntil: number, localHour: number): ExamReminderStage[] {
  if (!Number.isFinite(daysUntil) || daysUntil < 0) return [];
  if (localHour < REMINDER_LOCAL_HOUR) return [];
  return STAGES_BY_URGENCY.filter((stage) => daysUntil <= STAGE_MAX_DAYS[stage]);
}

function readTimezone(settings: unknown): string {
  if (!settings || typeof settings !== 'object') return DEFAULT_TIMEZONE;
  const bag = settings as Record<string, unknown>;
  const raw = bag.timezone ?? bag.timeZone;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_TIMEZONE;
}

export function examReminderMessage(input: {
  stage: ExamReminderStage;
  daysUntil: number;
  courseLabel: string;
  weakestTopic?: string | null;
}): string {
  const { stage, daysUntil, courseLabel, weakestTopic } = input;
  const tail = weakestTopic ? ` Weakest topic so far: ${weakestTopic}.` : '';
  if (stage === 'morning') return `Your ${courseLabel} exam is today.${tail}`;
  if (stage === 'day') return `Your ${courseLabel} exam is tomorrow.${tail}`;
  const days = Math.max(2, daysUntil);
  return `Your ${courseLabel} exam is in ${days} days.${tail}`;
}

async function claimReminder(
  layer: DataLayer,
  userId: string,
  key: string
): Promise<boolean> {
  const { error } = await layer
    .getClient()
    .from('retention_reminders_sent')
    .insert({ user_id: userId, reminder_key: key });
  if (!error) return true;
  if ((error as { code?: string }).code !== '23505') {
    logger.warn('Could not claim exam reminder', { key, error: error.message });
  }
  return false;
}

export interface ExamReminderSweepResult {
  sent: number;
  claimed: number;
}

/**
 * One sweep. Safe to run every few hours: the ledger, not the schedule, is
 * what makes a reminder fire once.
 */
export async function processExamReminders(
  layer: DataLayer,
  now: Date = new Date()
): Promise<ExamReminderSweepResult> {
  const db = layer.getClient();
  const result: ExamReminderSweepResult = { sent: 0, claimed: 0 };

  // A window wide enough that no timezone can push a due exam outside it.
  const utcToday = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 8 * 86_400_000).toISOString().slice(0, 10);

  const { data: enrolments, error } = await db
    .from('user_courses')
    .select('user_id, course_id, exam_date, courses!inner(id, code, title)')
    .eq('status', 'active')
    .not('exam_date', 'is', null)
    .gte('exam_date', from)
    .lte('exam_date', to)
    .limit(SCAN_LIMIT);
  if (error) {
    logger.error('Failed to load enrolments for exam reminders', { error: error.message });
    return result;
  }
  if (!enrolments || enrolments.length === 0) return result;

  const userIds = [...new Set(enrolments.map((row: any) => String(row.user_id)))];
  const timezones = new Map<string, string>();
  const { data: profiles, error: profileError } = await db
    .from('profiles')
    .select('id, settings')
    .in('id', userIds);
  if (profileError) {
    // Everyone falls back to the default timezone rather than nobody being
    // reminded at all.
    logger.warn('Exam reminders: could not read profile timezones', {
      error: profileError.message,
    });
  }
  for (const profile of profiles || []) {
    timezones.set(String((profile as any).id), readTimezone((profile as any).settings));
  }

  for (const row of enrolments as any[]) {
    const userId = String(row.user_id);
    const courseId = String(row.course_id);
    const examDate = String(row.exam_date).slice(0, 10);
    const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
    const courseLabel = (course?.code || course?.title || 'course').toString();

    const tz = timezones.get(userId) ?? DEFAULT_TIMEZONE;
    const local = localNow(now, tz);
    const daysUntil = daysBetween(local.date, examDate);
    const stages = dueStages(daysUntil, local.hour);
    if (stages.length === 0) continue;

    // Most urgent first: the first stage we successfully claim is the one the
    // student hears about; the rest are claimed silently so a "in 7 days"
    // message can never arrive after "tomorrow".
    let delivered = false;
    for (const stage of stages) {
      const claimed = await claimReminder(
        layer,
        userId,
        examReminderKey(courseId, examDate, stage)
      );
      if (!claimed) continue;
      result.claimed += 1;
      if (delivered) continue;
      delivered = true;

      let weakestTopic: string | null = null;
      let nextActionLabel: string | null = null;
      try {
        const [readiness] = await getTopicMasteryService(layer).courseReadiness(userId, {
          courseId,
        });
        weakestTopic = readiness?.weakestTopics?.[0] ?? null;
        nextActionLabel = readiness?.nextAction?.label ?? null;
      } catch (err) {
        // A reminder with no pointer still beats no reminder.
        logger.warn('Exam reminder: readiness lookup failed', {
          courseId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const notification = await layer.notifications.createNotification(userId, {
        type: EXAM_REMINDER_NOTIFICATION_TYPE,
        message: examReminderMessage({ stage, daysUntil, courseLabel, weakestTopic }),
        link: `/dashboard?readiness=${courseId}`,
        data: {
          courseId,
          courseLabel,
          examDate,
          stage,
          daysUntil,
          nextActionLabel,
          at: utcToday,
        },
      });
      // createNotification returns null when the student has turned this class
      // of notification off — the claim still stands, which is what "off" means.
      if (notification) result.sent += 1;
    }
  }

  if (result.sent || result.claimed) logger.info('Exam reminders swept', result);
  return result;
}

export function startExamReminderJobs(layer: DataLayer): void {
  if (process.env.ENABLE_MARKETPLACE_JOBS !== 'true') {
    logger.info('Exam reminder jobs disabled (set ENABLE_MARKETPLACE_JOBS=true)');
    return;
  }
  const run = async () => {
    try {
      await processExamReminders(layer);
    } catch (err) {
      logger.error('Exam reminder job failed', err);
    }
  };
  void run();
  // Hourly: the 06:00 local gate means a four-hour loop could push a
  // "morning of" reminder to the afternoon of the exam.
  setInterval(() => void run(), 60 * 60 * 1000);
  logger.info('Exam reminder jobs scheduled');
}

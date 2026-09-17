/**
 * Weekly Active Learning Connections — the north-star metric (Phase 3 · O).
 *
 * One row = one student measurably helping another learn. Two rules make the
 * number mean something:
 *   1. actor <> beneficiary (enforced by a CHECK constraint, not by callers);
 *   2. one row per (actor, beneficiary, kind) per ISO week (enforced by a
 *      unique index, so a chatty pair cannot inflate the metric).
 * Both live in the schema precisely because a dozen call sites write here and
 * any one of them could get the rule wrong.
 *
 * Every `record()` is best-effort: the underlying action (a completed order, an
 * accepted DM, a review) has already committed, and a metric row must never
 * roll it back.
 */
/**
 * FLIPPED (monolith lane M3, Phase B): this module took the whole
 * `SupabaseService` facade and reached exactly one member on it, `getClient()`.
 * It takes `DataClientHost` instead, so a flipped caller hands over
 * `dataLayer`; the facade satisfies the type structurally, so the call sites
 * this lane has not reached yet keep working unchanged.
 */
import type { DataClientHost } from './data';
import { logger } from '../utils/logger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CONNECTION_KINDS = [
  'challenge_completed',
  'group_question_answered',
  'question_voted',
  'question_verified',
  'deck_collaborated',
  'note_redeemed',
  'pack_entitled',
  'pack_scored',
  'order_completed',
  'review_left',
  'dm_accepted',
  'followed',
] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export interface ConnectionInput {
  actorId: string;
  beneficiaryId: string;
  kind: ConnectionKind;
  objectType?: string | null;
  objectId?: string | null;
  courseId?: string | null;
}

export class LearningConnectionsService {
  constructor(private host: DataClientHost) {}

  private get db() {
    return this.host.getClient();
  }

  /**
   * Record a learning connection. Silently skips self-connections and invalid
   * ids; relies on the unique index for weekly dedupe rather than a read-then-
   * write, which would race between two concurrent requests.
   */
  async record(input: ConnectionInput): Promise<void> {
    try {
      const { actorId, beneficiaryId, kind } = input || ({} as ConnectionInput);
      if (!actorId || !beneficiaryId) return;
      if (!UUID_RE.test(String(actorId)) || !UUID_RE.test(String(beneficiaryId))) return;
      if (actorId === beneficiaryId) return;
      if (!(CONNECTION_KINDS as readonly string[]).includes(kind)) return;

      const { error } = await this.db.from('learning_connections').insert({
        actor_id: actorId,
        beneficiary_id: beneficiaryId,
        kind,
        object_type: input.objectType ?? null,
        object_id: input.objectId ? String(input.objectId) : null,
        course_id:
          input.courseId && UUID_RE.test(String(input.courseId)) ? input.courseId : null,
      });

      // 23505 = the weekly dedupe index did its job. That is the expected path
      // for an active pair, not an error worth logging.
      if (error && (error as any).code !== '23505') throw error;
    } catch (err) {
      logger.warn('learning connection write failed', {
        kind: input?.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Fire-and-forget helper for hot paths that must not await a metric write. */
  recordAsync(input: ConnectionInput): void {
    void this.record(input);
  }

  /** Admin rollup. Returns the shape learning_connections_weekly() produces. */
  async weekly(weeks = 12): Promise<Record<string, unknown>> {
    const n = Number(weeks);
    const bounded = Number.isFinite(n) && n > 0 ? Math.min(52, Math.floor(n)) : 12;
    const { data, error } = await this.db.rpc('learning_connections_weekly', { p_weeks: bounded });
    if (error) throw error;
    return (data || {}) as Record<string, unknown>;
  }

  /**
   * How many people this user has helped learn, and how many helped them.
   * Powers the "you helped 12 people this week" line on the dashboard.
   */
  async summaryForUser(userId: string): Promise<{
    helpedThisWeek: number;
    helpedByThisWeek: number;
    helpedAllTime: number;
  }> {
    const weekStart = isoWeekStart(new Date());
    const [helped, helpedBy, allTime] = await Promise.all([
      this.db
        .from('learning_connections')
        .select('id', { count: 'exact', head: true })
        .eq('actor_id', userId)
        .eq('week_start', weekStart),
      this.db
        .from('learning_connections')
        .select('id', { count: 'exact', head: true })
        .eq('beneficiary_id', userId)
        .eq('week_start', weekStart),
      this.db
        .from('learning_connections')
        .select('id', { count: 'exact', head: true })
        .eq('actor_id', userId),
    ]);

    return {
      helpedThisWeek: helped.count ?? 0,
      helpedByThisWeek: helpedBy.count ?? 0,
      helpedAllTime: allTime.count ?? 0,
    };
  }
}

/**
 * Monday-start ISO week in UTC, matching the SQL trigger exactly. If these two
 * ever disagree the per-user counts silently query the wrong week, so this
 * mirrors `date_trunc('week', ... AT TIME ZONE 'UTC')` rather than using the
 * local timezone.
 */
export function isoWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay(): 0 = Sunday. Postgres weeks start Monday.
  const dayOfWeek = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayOfWeek);
  return d.toISOString().slice(0, 10);
}

let service: LearningConnectionsService | null = null;

export function getLearningConnectionsService(
  host: DataClientHost
): LearningConnectionsService {
  if (!service) service = new LearningConnectionsService(host);
  return service;
}

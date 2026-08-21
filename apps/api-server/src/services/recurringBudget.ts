/**
 * Recurring budget rules — materialise due rules into budget_transactions.
 *
 * The date maths lives in pure, unit-tested functions (advanceDate /
 * computeDueRuns) so the "when does it post next / how many missed periods do we
 * back-fill" logic is verified independently of the DB.
 */
import { SupabaseService } from './supabase';

export type RecurringFrequency = 'weekly' | 'monthly';

export interface RecurringRule {
  id: string;
  userId: string;
  type: 'income' | 'expense';
  amount: number;
  category: string | null;
  description: string | null;
  frequency: RecurringFrequency;
  dayOfMonth: number | null;
  nextDate: string; // yyyy-mm-dd
  active: boolean;
}

/** Parse a yyyy-mm-dd string into a local Date (no timezone surprises). */
function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The next occurrence after `ymd`. Weekly = +7 days. Monthly = same day next
 * month, clamped to that month's length (so a "31st" rule posts on the 30th/28th
 * in shorter months instead of skipping into the following month).
 */
export function advanceDate(ymd: string, frequency: RecurringFrequency, dayOfMonth?: number | null): string {
  const d = parseYmd(ymd);
  if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7);
    return toYmd(d);
  }
  const monthIndex = d.getMonth() + 1; // 0-based + 1 = next month
  const targetYear = d.getFullYear() + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const desiredDay = dayOfMonth && dayOfMonth > 0 ? dayOfMonth : d.getDate();
  const day = Math.min(desiredDay, lastDay);
  return toYmd(new Date(targetYear, targetMonth, day));
}

/**
 * Every date at or before `today` that a rule sitting at `nextDate` should post,
 * plus the new nextDate to store. Capped at `maxCatchup` so a long-dormant rule
 * (or a bad clock) can't back-fill an unbounded number of transactions.
 */
export function computeDueRuns(
  nextDate: string,
  frequency: RecurringFrequency,
  dayOfMonth: number | null | undefined,
  today: string,
  maxCatchup = 12
): { runs: string[]; newNextDate: string } {
  const runs: string[] = [];
  let cur = nextDate;
  while (cur <= today && runs.length < maxCatchup) {
    runs.push(cur);
    cur = advanceDate(cur, frequency, dayOfMonth);
  }
  // If we hit the cap but are still behind, skip the backlog forward to today's
  // period so we don't post a stale burst on the next run either.
  if (runs.length >= maxCatchup) {
    while (cur <= today) cur = advanceDate(cur, frequency, dayOfMonth);
  }
  return { runs, newNextDate: cur };
}

function mapRow(row: any): RecurringRule {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: row.type,
    amount: Number(row.amount),
    category: row.category ?? null,
    description: row.description ?? null,
    frequency: row.frequency,
    dayOfMonth: row.day_of_month ?? null,
    nextDate: typeof row.next_date === 'string' ? row.next_date.slice(0, 10) : row.next_date,
    active: row.active !== false,
  };
}

export class RecurringBudgetService {
  constructor(private supabase: SupabaseService) {}

  private get client() {
    return this.supabase.getClient();
  }

  async list(userId: string): Promise<RecurringRule[]> {
    const { data, error } = await this.client
      .from('budget_recurring_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRow);
  }

  async create(
    userId: string,
    input: {
      type: 'income' | 'expense';
      amount: number;
      category?: string | null;
      description?: string | null;
      frequency: RecurringFrequency;
      dayOfMonth?: number | null;
      nextDate: string;
    }
  ): Promise<RecurringRule> {
    const { data, error } = await this.client
      .from('budget_recurring_transactions')
      .insert({
        user_id: userId,
        type: input.type,
        amount: input.amount,
        category: input.category ?? null,
        description: input.description ?? null,
        frequency: input.frequency,
        day_of_month: input.frequency === 'monthly' ? input.dayOfMonth ?? null : null,
        next_date: input.nextDate,
        active: true,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapRow(data);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('budget_recurring_transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  /**
   * Post every due occurrence for the user's active rules and advance each rule's
   * next_date. Idempotent via the (recurring_rule_id, recurring_date) unique
   * index — safe to call on every budget load. Returns how many rows were posted.
   */
  async runDue(userId: string, today: string): Promise<{ posted: number }> {
    const rules = (await this.list(userId)).filter((r) => r.active);
    let posted = 0;

    for (const rule of rules) {
      const { runs, newNextDate } = computeDueRuns(rule.nextDate, rule.frequency, rule.dayOfMonth, today);
      if (runs.length === 0) continue;

      for (const date of runs) {
        // Plain insert (not upsert): the idempotency index is PARTIAL
        // (WHERE recurring_rule_id IS NOT NULL), which Postgres will not accept as
        // an ON CONFLICT arbiter unless the predicate is repeated — and the
        // Supabase client can't emit that. So insert, and treat a unique-violation
        // (23505 on uq_budget_tx_recurring) as "already materialised" — the same
        // idempotency, valid for the existing index.
        const { error } = await this.client
          .from('budget_transactions')
          .insert({
            user_id: userId,
            type: rule.type,
            amount: rule.amount,
            category: rule.category,
            description: rule.description || 'Recurring',
            date,
            recurring_rule_id: rule.id,
            recurring_date: date,
          });
        if (error) {
          if ((error as { code?: string }).code === '23505') continue;
          throw error;
        }
        posted += 1;
      }

      const { error: advErr } = await this.client
        .from('budget_recurring_transactions')
        .update({ next_date: newNextDate, updated_at: new Date().toISOString() })
        .eq('id', rule.id)
        .eq('user_id', userId);
      if (advErr) throw advErr;
    }

    return { posted };
  }
}

let recurringBudgetService: RecurringBudgetService | null = null;

export function initializeRecurringBudgetService(supabase: SupabaseService): RecurringBudgetService {
  recurringBudgetService = new RecurringBudgetService(supabase);
  return recurringBudgetService;
}

export function getRecurringBudgetService(): RecurringBudgetService {
  if (!recurringBudgetService) {
    throw new Error('RecurringBudgetService not initialized');
  }
  return recurringBudgetService;
}

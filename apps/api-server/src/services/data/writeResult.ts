/**
 * Read the error a supabase-js write RESOLVES with, and say out loud which
 * kind of site this is.
 *
 * ## Why this exists (#108)
 *
 * supabase-js does not throw when a write fails. An awaited insert / update /
 * upsert / delete
 * resolves with `{ data, error }`, so a bare `await …;` statement discards the
 * failure and the code carries on as if the row had changed — and a `try/catch`
 * around it catches nothing, because nothing rejects. A census found 87 of
 * these in 28 files, 36 in the money services; see
 * `apps/api-server/docs/write-errors-plan.md`.
 *
 * ## The two shapes
 *
 * - `mustWrite(result, context)` — continuing after this failure would corrupt
 *   state or strand a user. Throws `WriteFailedError`, which carries the table,
 *   the operation and the PostgREST code so the cause survives into logs and
 *   alerting instead of collapsing into "Something went wrong".
 * - `bestEffortWrite(result, context)` — failure must not fail the request
 *   (logs, milestones, non-authoritative mirrors). Logs and returns a boolean,
 *   so a caller can still branch on it.
 *
 * Both take the RESOLVED result, so the call site reads as one statement and
 * the decision is visible at it:
 *
 *   mustWrite(await orders.update(patch).eq('id', id), {
 *     table: 'marketplace_orders', op: 'update', orderId: id,
 *   });
 *
 * (`orders` standing in for the query builder; the real call sites spell the
 * table out inline. The example does not, because this file lives inside the
 * data layer whose table inventory `supabase.tableInventory.test.ts` freezes,
 * and a table named in a comment there reads as a query.)
 *
 * ## The rule about context
 *
 * `context` is for IDs and short state names — never a row payload, a request
 * body, a token, an email or an amount. The logger redacts by KEY NAME only
 * (`utils/safeError`), so anything passed under an unlisted key is written out
 * in full. `message` and `details` from PostgREST are echoed; PostgREST does
 * quote offending values in some constraint messages, which is why the message
 * is truncated and why no site should pass user text into a write it then
 * reports on.
 */
import { logger } from '../../utils/logger';

/** The half of a PostgREST error we are willing to keep. */
export type WriteError = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

/** Anything a supabase-js write resolves with. `data` is deliberately ignored. */
export type WriteResult =
  | { error?: WriteError | null; data?: unknown; count?: number | null }
  | null
  | undefined;

/** The identifying context of one write. IDs and state names only. */
export type WriteContext = {
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete';
  /** Anything else is an id or a short state name — see the rule above. */
  [key: string]: unknown;
};

const MAX_MESSAGE = 300;

function trim(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > MAX_MESSAGE ? `${value.slice(0, MAX_MESSAGE)}…` : value;
}

/**
 * A write that had to succeed and did not. Not a `PublicError`: the buyer did
 * nothing wrong, so this must reach the global handler as a 500 and land in
 * 5xx alerting rather than be reported to them as their mistake.
 */
export class WriteFailedError extends Error {
  readonly table: string;
  readonly op: string;
  /** The PostgREST error code (`23505`, `42703`, …), preserved for callers. */
  readonly code: string | null;
  readonly details: string | null;
  /** The ids the call site passed, for logging and for tests. */
  readonly context: Record<string, unknown>;

  constructor(context: WriteContext, error: WriteError | null | undefined) {
    const { table, op, ...rest } = context;
    super(
      `Write failed: ${op} on ${table}${error?.code ? ` (${error.code})` : ''}${
        error?.message ? `: ${trim(error.message)}` : ''
      }`,
    );
    this.name = 'WriteFailedError';
    this.table = table;
    this.op = op;
    this.code = error?.code ? String(error.code) : null;
    this.details = trim(error?.details) ?? null;
    this.context = rest;
  }
}

/**
 * Stop when this write failed. Returns the result so a call site can keep
 * reading `data` off it: `const { data } = mustWrite(await …, ctx)`.
 *
 * @throws WriteFailedError
 */
export function mustWrite<T extends WriteResult>(result: T, context: WriteContext): T {
  const error = result?.error;
  if (!error) return result;
  const failure = new WriteFailedError(context, error);
  logger.error('Database write failed', {
    ...context,
    code: failure.code,
    error: trim(error.message),
  });
  throw failure;
}

/**
 * Report this write's failure and carry on. Returns true when the write
 * succeeded, so a caller can branch without re-reading `error`.
 *
 * `level` is 'warn' by default. Use 'error' for a best-effort site whose
 * failure leaves a row wedged or an audit trail short — somewhere a human
 * should look, even though the request must still succeed.
 */
export function bestEffortWrite(
  result: WriteResult,
  context: WriteContext,
  level: 'warn' | 'error' = 'warn',
): boolean {
  const error = result?.error;
  if (!error) return true;
  const meta = {
    ...context,
    code: error.code ? String(error.code) : null,
    error: trim(error.message),
  };
  if (level === 'error') logger.error('Database write failed (best-effort)', meta);
  else logger.warn('Database write failed (best-effort)', meta);
  return false;
}

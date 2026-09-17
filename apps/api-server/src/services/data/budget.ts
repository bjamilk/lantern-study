/**
 * data/budget.ts — the student budget ledger and the monthly spending limit.
 *
 * ## Purpose
 *
 * Extracted verbatim from `routes/budget.ts` (monolith lane R2, pilot). Those
 * eight queries were built inline in the handlers, which is the layering
 * violation this lane exists to close: a route decides, a data module queries.
 * No module owned these two tables, so this is a new domain rather than an
 * addition to an existing one.
 *
 * ## What it touches
 *
 * Tables: `budget_transactions`, `user_budgets`. No storage buckets, no RPCs.
 *
 * `user_budgets` is also read and written by two endpoints in `routes/users.ts`
 * (`GET`/`PUT /users/:userId/budget`). Those two sites belong here and arrive in
 * the next R2 pull request; nothing else queries either table.
 *
 * ## The gotchas
 *
 * 1. THE `userId` PARAMETER IS THE ACCESS CONTROL. The API holds the SERVICE
 *    ROLE client, which BYPASSES RLS, so no policy will catch a missing owner
 *    predicate — an unfiltered read here returns every student's ledger. Every
 *    function below that reads or writes a caller-owned row takes `userId` as a
 *    REQUIRED parameter and applies it itself; none of them makes it optional,
 *    and `routes/budget.queryShape.test.ts` asserts each predicate literally.
 *
 * 2. `findBudgetTransactionOwner` is the ONE exception, and deliberately so: it
 *    looks a client-supplied transaction id up by `id` ALONE and returns the
 *    `user_id` for the caller to compare. Filtering by owner instead would make
 *    another user's id indistinguishable from a free one, and the route answers
 *    403 rather than silently taking it over.
 *
 * 3. `listCategoryExpensesForMonth` takes its upper bound as an EXCLUSIVE first
 *    of the next month, computed by the caller. It used to be `${monthYear}-32`,
 *    which is not a valid date, so Postgres rejected the whole query, the error
 *    went unchecked, and the category-overspend warning never fired. Do not
 *    "simplify" that bound back into a day-of-month string.
 *
 * ## Errors are returned, never swallowed
 *
 * Each function returns PostgREST's `{ data, error }` exactly as the inline code
 * consumed it. The routes branch on `error` themselves — the savings
 * contribution logs and converts it to a 500 with its own message, the delete
 * distinguishes an error from a zero-row match to answer 404 — so a function
 * that threw, or that invented a result, would change behaviour.
 */
import type { DataClient } from "./client";

// ============ BUDGET TRANSACTIONS ============

/** One row as the ledger stores it. Shaped by the caller, written here. */
export type BudgetTransactionRow = {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  category: string;
  description: string;
  date: string;
};

/**
 * Insert a transaction the caller owns. Used by the savings-goal contribution
 * path, which logs and reports its own 500 on `error`.
 */
export async function insertBudgetTransaction(
  supabase: DataClient,
  userId: string,
  transaction: Omit<BudgetTransactionRow, "user_id">,
): Promise<{ error: any }> {
  const { error } = await supabase
    .from("budget_transactions")
    .insert({
      ...transaction,
      user_id: userId,
    });
  return { error };
}

/** Every transaction the caller owns, newest date first. */
export async function listBudgetTransactions(
  supabase: DataClient,
  userId: string,
): Promise<{ data: any[] | null; error: any }> {
  return await supabase
    .from("budget_transactions")
    .select("id, user_id, type, amount, category, description, date")
    .eq("user_id", userId)
    .order("date", { ascending: false });
}

/**
 * The caller's transactions dated in `[startDate, endDateExclusive)`. Used by
 * the under-budget award, which sums the `expense` rows itself.
 */
export async function listBudgetTransactionsInRange(
  supabase: DataClient,
  userId: string,
  startDate: string,
  endDateExclusive: string,
): Promise<{ data: any[] | null; error: any }> {
  return await supabase
    .from("budget_transactions")
    .select("amount, type, date")
    .eq("user_id", userId)
    .gte("date", startDate)
    .lt("date", endDateExclusive);
}

/**
 * Look a client-supplied transaction id up BY ID ALONE and return its owner.
 * See gotcha 2: the ownership comparison belongs to the caller, which answers
 * 403 rather than hiding a foreign row behind a 404.
 */
export async function findBudgetTransactionOwner(
  supabase: DataClient,
  transactionId: string,
): Promise<{ data: { user_id: string } | null; error: any }> {
  return await supabase
    .from("budget_transactions")
    .select("user_id")
    .eq("id", transactionId)
    .maybeSingle();
}

/**
 * Create-or-replace a transaction the caller owns, keyed on `id` so a client
 * retrying with the same id does not double-post.
 */
export async function upsertBudgetTransaction(
  supabase: DataClient,
  userId: string,
  transaction: Omit<BudgetTransactionRow, "user_id">,
): Promise<{ error: any }> {
  const { error } = await supabase
    .from("budget_transactions")
    .upsert(
      {
        ...transaction,
        user_id: userId,
      },
      { onConflict: "id" },
    );
  return { error };
}

/**
 * The caller's `expense` rows in one category for one month. `endDateExclusive`
 * is the first day of the NEXT month — see gotcha 3.
 */
export async function listCategoryExpensesForMonth(
  supabase: DataClient,
  userId: string,
  category: string,
  startDate: string,
  endDateExclusive: string,
): Promise<{ data: any[] | null; error: any }> {
  return await supabase
    .from("budget_transactions")
    .select("amount")
    .eq("user_id", userId)
    .eq("type", "expense")
    .eq("category", category)
    .gte("date", startDate)
    .lt("date", endDateExclusive);
}

/**
 * Delete one of the caller's transactions. Returns the deleted `id` so the
 * caller can tell "not yours / not there" (404) from a database error.
 */
export async function deleteBudgetTransaction(
  supabase: DataClient,
  userId: string,
  transactionId: string,
): Promise<{ data: { id: string } | null; error: any }> {
  return await supabase
    .from("budget_transactions")
    .delete()
    .eq("id", transactionId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
}

// ============ MONTHLY LIMIT ============

/**
 * The caller's spending limit for one `YYYY-MM`, or no row if they never set
 * one. The under-budget award treats a missing or non-positive limit as
 * "nothing to be under".
 */
export async function getMonthlyBudget(
  supabase: DataClient,
  userId: string,
  monthYear: string,
): Promise<{ data: { monthly_limit: number } | null; error: any }> {
  return await supabase
    .from("user_budgets")
    .select("monthly_limit")
    .eq("user_id", userId)
    .eq("month_year", monthYear)
    .maybeSingle();
}

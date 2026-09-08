/**
 * Which of the three states the Order detail screen is in.
 *
 * The audit found a dead end: a completed order the server no longer had a
 * record of opened a bare centred "Order not found" with NO header and NO back
 * button — only the tab bar — so hardware BACK was the only way out. The fix is
 * to give the loading and not-found states the SAME header + back affordance
 * every pushed screen has. This pure planner is the decision those branches
 * share so the rule is testable without mounting the screen.
 */
export type OrderDetailView = 'loading' | 'missing' | 'ready';

/** Loading wins over everything; a finished load with no order is 'missing'. */
export function orderDetailView(input: { loading: boolean; hasOrder: boolean }): OrderDetailView {
  if (input.loading) return 'loading';
  return input.hasOrder ? 'ready' : 'missing';
}

/**
 * Copy for the not-found state. It never shows a raw network, database or
 * vendor string — it says what happened (the order is listed but the record is
 * gone) and that there is nothing left to do here.
 */
export const ORDER_NOT_FOUND_TITLE = 'Order not found';
export const ORDER_NOT_FOUND_BODY =
  "This order is in your list, but we can't find its details any more — the record looks like it was removed. There's nothing left to do here.";

/**
 * Where the back affordance goes.
 *
 * `goBack()` is a NO-OP when this screen is the only route on the stack, which
 * is exactly what a cold-start deep link produces (linking.ts maps
 * `marketplace/orders/:orderId` straight here). The header arrow and the
 * "Back to orders" button then did nothing at all. Back must always mean
 * something: pop the stack when there is one, otherwise go to the Orders list
 * — the route this screen is pushed from in the same navigator.
 */
export type OrderBackTarget = 'pop' | 'orders';

export function orderBackTarget(input: { canGoBack: boolean }): OrderBackTarget {
  return input.canGoBack ? 'pop' : 'orders';
}

/** The route `orderBackTarget` falls back to; a real screen in CampusStack. */
export const ORDERS_ROUTE = 'Orders';

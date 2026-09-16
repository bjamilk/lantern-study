/**
 * Error-mapping policy for the admin HTTP surface.
 *
 * Every handler in the admin sub-routers is wrapped in `asyncHandler` — the
 * project's promise wrapper — so a rejected promise reaches `next` instead of
 * an inline `catch`. Before M4 this router was the only big one that opted out
 * of that convention: 55 hand-rolled try/catch blocks, 47 of them at route
 * level.
 *
 * What the rejection reaches is `adminErrorHandler`, registered by ./index
 * AFTER every sub-router: a router-scoped error middleware, NOT the global one.
 * That is deliberate and load-bearing. The global `errorHandler` answers with
 * `{error, message, timestamp, path}`; every admin route answers with
 * `{success: false, error}`, and the console reads that shape. Letting admin
 * failures escape to the global handler would rewrite 47 response bodies.
 *
 * Three mappings, chosen per route, AT the route, by the wrapper it is
 * registered with:
 *
 *   adminRoute(fn)       the older routes' mapping — everything is a 500 with
 *                        a scrubbed `clientErrorMessage`, INCLUDING a
 *                        PublicError. That under-reports a genuine 4xx, and it
 *                        is kept exactly as it was: M4 converted control flow,
 *                        not statuses. Prefer `moderationRoute` for new routes.
 *   moderationRoute(fn)  `respondModerationError` — a service PublicError
 *                        keeps its own statusCode (or 400).
 *   mappedRoute(m, fn)   a route-specific mapping. Two routes have one: the
 *                        dispute resolver and the badge award.
 *
 * The mapping travels on `res.locals.adminErrorResponder`, set by the wrapper
 * before the handler runs, so the error middleware never has to know anything
 * about paths. That is what lets routes live in whichever sub-router file fits
 * without changing what they answer when they fail.
 *
 * Either way `clientErrorMessage` is what keeps raw PostgREST text — column,
 * constraint and RLS policy names — out of the response.
 *
 * `admin.errorConvention.test.ts` drives all 47 registered handlers into
 * failure and asserts the exact status and body each produces.
 */
import { asyncHandler } from '../../middleware/errorHandler';
import { clientErrorMessage, PublicError } from '../../utils/safeError';

/** How one route family turns a thrown error into this router's response. */
export type AdminErrorResponder = (res: any, err: any) => void;

/** PublicError(+statusCode) from the moderation service → 4xx; everything else → 500. */
export function respondModerationError(res: any, err: any): void {
  if (err instanceof PublicError) {
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    res.status(typeof statusCode === 'number' ? statusCode : 400).json({ success: false, error: err.message });
    return;
  }
  res.status(500).json({ success: false, error: clientErrorMessage(err) });
}

/** The older routes' mapping: every failure is a 500 with a scrubbed message. */
export function respondLegacyAdminError(res: any, err: any): void {
  res.status(500).json({ success: false, error: clientErrorMessage(err) });
}

/**
 * `PATCH /marketplace/orders/:id/dispute` classified by message text, because
 * `resolveDisputeAsAdmin` throws plain Errors rather than typed ones.
 *
 * KNOWN ISSUE (tracked, found during M4): sniffing 'not found' / 'Only
 * disputed' out of an error message is fragile — a reworded message in
 * `marketplaceOrders` silently turns a 404 into a 500. The fix is a typed
 * error in that service, which belongs to the marketplace lane, not here.
 */
export function respondDisputeError(res: any, err: any): void {
  const message = clientErrorMessage(err);
  const status = message.includes('not found') ? 404 : message.includes('Only disputed') ? 400 : 500;
  res.status(status).json({ success: false, error: message });
}

/**
 * `POST /users/:id/badge`: awardBadge raises 400 (unknown badge id) / 404 (no
 * such user) as PublicError with a statusCode; surface those instead of a
 * blanket 500.
 */
export function respondBadgeError(res: any, err: any): void {
  const status = typeof err?.statusCode === 'number' && err.statusCode < 500 ? err.statusCode : 500;
  res.status(status).json({ success: false, error: clientErrorMessage(err) });
}

/** asyncHandler, remembering which mapping this route's failures take. */
export function mappedRoute(respond: AdminErrorResponder, fn: (req: any, res: any) => unknown) {
  return asyncHandler((req: any, res: any) => {
    res.locals.adminErrorResponder = respond;
    return fn(req, res);
  });
}

/** asyncHandler with the older routes' flat-500 mapping. */
export const adminRoute = (fn: (req: any, res: any) => unknown) =>
  mappedRoute(respondLegacyAdminError, fn);

/** asyncHandler with the moderation mapping (a PublicError keeps its status). */
export const moderationRoute = (fn: (req: any, res: any) => unknown) =>
  mappedRoute(respondModerationError, fn);

/**
 * The admin surface's terminal error mapping, registered with `router.use` in
 * ./index after every sub-router, so it sees failures from all of them.
 *
 * `headersSent` forwards to the global handler rather than throwing
 * ERR_HTTP_HEADERS_SENT inside the mapper. No response bytes change: nothing
 * more can be written to a response that is already out. What changes is where
 * the follow-up failure is reported — before M4, a throw after the response had
 * been sent rejected inside the handler's own catch and surfaced as an
 * unhandled rejection.
 */
export function adminErrorHandler(err: any, _req: any, res: any, next: any): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const respond: AdminErrorResponder = res.locals?.adminErrorResponder ?? respondLegacyAdminError;
  respond(res, err);
}

/**
 * Admin console API — the platform's moderation and operations surface.
 *
 * Mount: `/api/v1/admin` (server.ts), behind the stack
 * `authMiddleware` → `requirePlatformAdmin` → `adminRateLimit` → this router.
 * It is the only mount in the app with that hard stack, which is why no
 * individual route below repeats an auth check.
 *
 * THE ADMIN GATE — read this before touching anything in this file.
 *
 * `requirePlatformAdmin` resolves admin status with a LIVE DATABASE LOOKUP on
 * every single request: `isLivePlatformAdmin` → `SupabaseService.isPlatformAdmin`
 * → a `platform_admins` row, falling back to the GoTrue user's
 * `app_metadata.is_platform_admin`. It NEVER reads the `isAdmin` claim carried
 * on the verified JWT — `authMiddleware` copies that claim onto `req.user` but
 * documents it as advisory, and the gate overwrites it with the live answer.
 *
 * This is deliberate, not an oversight to optimise away. A JWT lives up to an
 * hour and `authMiddleware` memoises verifications for 15 seconds; if admin
 * came from the token, a revoked admin would keep full console access until
 * their token expired. With the live lookup, revocation takes effect on the
 * next request. Do not cache it, do not move it into the JWT, do not read
 * `req.user.isAdmin` as the source of truth.
 *
 * Nothing here can be self-granted from the user side either: the privileged
 * settings keys (`is_banned`, `account_status`, `is_platform_admin`,
 * `ban_reason`, `banned_at`, `banned_by`, `suspended_until`,
 * `moderation_flags`, in `utils/sanitizeSettings.ts`) are stripped from every
 * user-supplied settings patch and preserved from the stored row, so the only
 * writer of ban and admin state is this file and the service role.
 *
 * Audit convention: every state-changing route calls `logAdminAction`
 * (`services/adminAudit`) with `{actorId, action, targetType, targetId,
 * metadata?, reason?}`, which appends to `admin_audit_log` — the table served
 * back by `GET /audit`. A new mutating route without a `logAdminAction` call
 * is a bug.
 *
 * Error-mapping convention: this file has two, and the API as a whole has
 * several competing ones — do not assume the convention you know from another
 * route file applies here.
 *   - Moderation-service routes are registered with `moderationRoute(...)`,
 *     which maps through `respondModerationError`: `PublicError` → its own
 *     `statusCode` (or 400), everything else → 500 with a scrubbed
 *     `clientErrorMessage`. Prefer this for new routes.
 *   - The older routes are registered with `adminRoute(...)`, which maps
 *     everything to a 500 with `clientErrorMessage(err)` — so a genuine 4xx is
 *     reported as a 500. Kept as-is by M4, which converted control flow, not
 *     statuses.
 * Either way `clientErrorMessage` is what keeps raw PostgREST text (column,
 * constraint and policy names) out of the response.
 *
 * Since M4 no route hand-rolls a try/catch: every handler is wrapped in the
 * project's `asyncHandler`, and the mapping above is applied by
 * `adminErrorHandler`, a router-scoped error middleware registered at the
 * bottom of this file, after every sub-router. See ./errors for why it is
 * router-scoped rather than the global handler.
 *
 * What it touches. Since M4 these routes perform NO database access of their
 * own:
 * every query, GoTrue admin call and RPC lives in `services/adminData.ts`, and
 * `adminData.queryShape.test.ts` both pins each query's table, filters and
 * columns and asserts that no `.from(`, `getClient()`, `auth.admin.` or
 * `.rpc(` reappears here. Through that module it touches Supabase tables
 * `profiles`, `platform_admins`,
 * `admin_audit_log`, `content_reports`, `marketplace_listings`,
 * `marketplace_reports`, `marketplace_orders`, `groups`, `group_members`,
 * `messages`, `decks`, `flashcards`, `offline_bundles`, `ai_analytics`,
 * `ai_inference_log`, `ai_companion_messages`, `product_events`,
 * `study_activity`; the GoTrue admin API (`auth.admin.getUserById`,
 * `updateUserById`, `signOut`, `listUsers`) and the
 * `admin_search_users_by_email` RPC; Redis through `cacheService`
 * (`authMeta:*`, `notifications:*`, `marketplace:listings:*`,
 * `gamification:user:badges:*`), the AI quota counters in
 * `middleware/aiRateLimit`, and the per-user session cutoff in
 * `services/tokenDenylist`. `GET /ai/provider-probe` bills one real completion
 * against a live AI provider.
 * Contexts, in mount order — the split is by what an admin is doing, and mount
 * order is NOT load-bearing: `admin.routeInventory.test.ts` proves no path
 * registered in one of these files is shadowed by a pattern in another, so
 * Express resolves the same route whichever file it lives in.
 *   ./analytics   dashboard stats, the AI provider probe, analytics, activity,
 *                 the audit log, learning connections
 *   ./users       search, status (ban/suspend/activate), strikes, the role
 *                 route, the user drawer, notifications, points, badges,
 *                 AI quota and companion history
 *   ./moderation  marketplace listings and disputes, the generic report queue,
 *                 appeals, and the jobs-board view of that same queue
 *   ./content     groups, messages, decks, offline bundles, jobs postings and
 *                 company verification
 * ./context holds the injected services and the shared helpers; ./errors holds
 * the error convention and `adminErrorHandler`, which is registered LAST here
 * so it sees failures from every sub-router.
 */
import { Router } from 'express';
import { SupabaseService } from '../../services/supabase';
import { CacheService } from '../../services/cache';
import { initializeAdminContext } from './context';
import { adminErrorHandler } from './errors';

import analyticsRoutes from './analytics';
import usersRoutes from './users';
import moderationRoutes from './moderation';
import contentRoutes from './content';

const router = Router();

router.use(analyticsRoutes);
router.use(usersRoutes);
router.use(moderationRoutes);
router.use(contentRoutes);

/**
 * Registered after every sub-router, so an error from any of them lands here
 * rather than on the global handler — which answers with a different body
 * shape than the admin console reads. See ./errors.
 */
router.use(adminErrorHandler);

// Initialize function to be called from main server.
export function initializeAdminRoutes(supabase: SupabaseService, cache: CacheService) {
  initializeAdminContext(supabase, cache);
}

export { adminErrorHandler } from './errors';
export { resolveRoleManagementEnabled } from './context';

/**
 * The auth-layer ban lives in `services/adminData` with the rest of the admin
 * data access (M4). Re-exported here so `adminAuthBan.test.ts` and any other
 * importer keep their existing module path.
 */
export { AUTH_BAN_DURATION, setAuthBan } from '../../services/adminData';

export default router;

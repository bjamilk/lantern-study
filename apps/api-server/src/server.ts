/**
 * API server entry point: builds the Express application, wires every service
 * and route, and starts listening.
 *
 * The middleware chain is order-sensitive. Each position below exists for a
 * reason, and moving a stage breaks something specific:
 *
 *   1. `trust proxy` (production only) — Render and the Cloudflare proxy set
 *      X-Forwarded-For. Without this, every request appears to come from the
 *      proxy IP and the per-IP rate limits collapse into one shared bucket.
 *   2. `helmet` — security headers (CSP, HSTS) before anything can respond.
 *   3. The CORS delegate — a per-request function, not a static origin list,
 *      because the decision depends on the credential the request carries
 *      (cookie vs Authorization/X-API-Key) and on whether the path can set a
 *      cookie. See `decideCorsOrigin` in utils/corsOrigins.ts.
 *   4. `compression`, then `loadShedMiddleware` — saturated instances fail fast
 *      with Retry-After before any body is parsed.
 *   5. Body parsing. The Paystack webhook RAW-BODY parser is selected BEFORE the
 *      generic json/urlencoded parsers can run, because the webhook is
 *      authenticated by HMAC-SHA512 over the exact request bytes: a generic
 *      parser that re-serializes the JSON destroys the signature. The dispatcher
 *      also picks the body limit by path — the large-upload classes
 *      (50mb / 35mb / 4mb) must be chosen before the 1mb default, or a lecture
 *      audio or note-image upload 413s.
 *   6. `cookieParser` then `csrfProtectionMiddleware`.
 *   7. Rate limiters — mounted in `startServer()`, not here, because they can
 *      only be built after Redis is connected (see the boot sequence below).
 *   8. The sanitiser and body-shape validator — mounted AFTER the rate limiter.
 *      H1 moved them here from the pre-limiter position: both walk the entire
 *      parsed body, so running them before rate limiting let an unauthenticated
 *      caller buy body-sized CPU on every request and wedge the event loop
 *      before anything could throttle them. `middleware/security.test.ts`
 *      asserts this ordering against this file's source.
 *   9. Route mounts, each carrying its own auth mode (see the route-mount
 *      banner below), with the admin gate last.
 *  10. Sentry's Express handlers, then the database / Supabase / generic error
 *      handlers, which must be registered after all routes.
 *
 * Boot sequence (H2): `initializeServices()` awaits
 * `initializeRateLimitStores()`, which wires the Redis send-command and only
 * then calls `buildAllLimiters()`. Limiters are also built at module import,
 * before Redis exists, so every limiter silently fell back to a per-process
 * in-memory store in production while the "Redis is required" guard still
 * passed. The rebuild after Redis is wired is what makes the limits
 * distributed. Route and limiter mounting therefore happens inside
 * `startServer()`, after `initializeServices()` resolves.
 *
 * Touches: Supabase (service-role client shared by every route module via the
 * `initialize*Routes` injectors), Redis (cache + rate-limit stores), Paystack
 * webhooks at `/webhooks/paystack` and `/api/v1/webhooks/paystack`, the
 * `lantern_access` / `lantern_refresh` auth cookies, Sentry, and BullMQ (cron
 * work is delegated to the worker when `isBullMqEnabled()`).
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { config } from 'dotenv';

// Load environment variables first
config();

import { validateProductionSecrets } from './utils/requestAuth';
import { initSentry, setupSentryExpress } from './utils/sentry';
validateProductionSecrets();
initSentry();

// Import services
import { CacheService, cacheService as sharedCacheService } from './services/cache';
import { ApiKeyService } from './services/apiKey';
import { SupabaseService } from './services/supabase';
import { createDataLayer, type DataLayer } from './services/data';
import { createDataLayerHost } from './services/dataLayerHost';

// Import middleware
import { anonymousIpRateLimit, adminRateLimit, initializeRateLimitStores, isWebhookRateLimitExempt } from './middleware/rateLimit';
import { authMiddleware, optionalAuthMiddleware, requirePlatformAdmin } from './middleware/auth';
import { AI_USAGE_EXPOSED_HEADERS } from './middleware/aiRateLimit';
import { errorHandler, notFoundHandler, databaseErrorHandler, supabaseErrorHandler, corsRejection } from './middleware/errorHandler';
import { handleValidationErrors } from './middleware/validation';
import { skipTimeoutForLongRunningNotes } from './middleware/timeout';
import { sanitizationMiddleware } from './middleware/security';
import { csrfProtectionMiddleware } from './middleware/csrf';
import { validateBodyShape } from './middleware/validateBody';
import { applyPublicRateLimits } from './middleware/publicRateLimitMiddleware';
import { loadShedMiddleware } from './middleware/loadShed';
import { decideCorsOrigin, isCookieSettingPath } from './utils/corsOrigins';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './utils/authCookies';
import healthRoutes from './routes/health';
import { setupGracefulShutdown } from './config/production';
import { configureHttpServer } from './config/httpServer';
import { disconnectRedis } from './services/redisStore';

// Import routes
import userRoutes from './routes/users';
import groupRoutes from './routes/groups';
import messageRoutes from './routes/messages';
import notificationRoutes from './routes/notifications';
import testRoutes from './routes/tests';
import gamificationRoutes from './routes/gamification';
import deckRoutes from './routes/decks';
import { router as flashcardRoutes } from './routes/flashcards';
import userStatsRoutes from './routes/user-stats';
import dashboardRoutes from './routes/dashboard';
import preferencesRoutes from './routes/preferences';
import marketplaceRoutes from './routes/marketplace';
import paystackWebhookRoutes, { initializePaystackWebhookRoutes } from './routes/paystackWebhook';
import sitemapRoutes from './routes/sitemap';
import { marketplaceGeoMiddleware } from './middleware/marketplaceGeo';
import aiRoutes, { initializeAIRoutes } from './routes/ai';
import { initializeAiBonusUses } from './services/aiBonusUses';
import offlineBundlesRoutes, { initializeOfflineBundlesRoutes } from './routes/offlineBundles';
import adminRoutes, { initializeAdminRoutes } from './routes/admin';
import aiCompanionRoutes, { initializeAICompanionRoutes } from './routes/aiCompanion';
import notesRoutes, { initializeNotesRoutes } from './routes/notes';
import challengeRoutes, { initializeChallengeRoutes } from './routes/challenges';
import apiKeysRoutes from './routes/apiKeys';
import authRoutes, { initializeAuthRoutes } from './routes/auth';
import storageRoutes, { initializeStorageRoutes } from './routes/storage';
import jobsRoutes from './routes/jobs';
import jobsBoardRoutes, { initializeJobsBoardRoutes } from './routes/jobsBoard';
import budgetRoutes from './routes/budget';
import contactRoutes from './routes/contact';
import analyticsRoutes, { initializeAnalyticsRoutes } from './routes/analytics';
import courseRoutes, { initializeCourseRoutes } from './routes/courses';
import userCourseRoutes, { initializeUserCourseRoutes } from './routes/userCourses';
import studySetRoutes, { initializeStudySetRoutes } from './routes/studySets';
import conceptRoutes, { initializeConceptRoutes } from './routes/concepts';
import libraryRoutes, { initializeLibraryRoutes } from './routes/library';
import creatorRoutes, { initializeCreatorRoutes } from './routes/creators';
import reportRoutes, { initializeReportRoutes } from './routes/reports';
// Phase 3 — Network (communities/discovery, feed, mastery graph)
import communityRoutes, {
  discoverRouter,
  initializeCommunityRoutes,
} from './routes/communities';
import feedRoutes, { masteryRouter, initializeFeedRoutes } from './routes/feed';
// Phase 4 Q — referrals + ambassadors
import referralRoutes, { initializeReferralRoutes } from './routes/referrals';
// Phase 4 R — public campus pages (SEO)
import campusRoutes, { initializeCampusRoutes } from './routes/campuses';
// Phase 1 A (deferred, now built) — course topics
import courseTopicRoutes, { initializeCourseTopicRoutes } from './routes/courseTopics';
import studyRoomRoutes, { initializeStudyRoomRoutes } from './routes/studyRooms';
import classRoutes, { initializeClassRoutes } from './routes/classes';
import institutionStaffRoutes, { initializeInstitutionStaffRoutes } from './routes/institutionStaff';
import schoolRoutes, { initializeSchoolRoutes } from './routes/schools';
import cookieParser from 'cookie-parser';
import { isBullMqEnabled } from './queue/connection';

// Import utilities
import { logger, stream, logRequest } from './utils/logger';

// ---------------------------------------------------------------------------
// Chain stage 1 — app + trust proxy
// ---------------------------------------------------------------------------
// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Render / reverse proxies set X-Forwarded-For; required for stable per-IP rate limits.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ---------------------------------------------------------------------------
// Boot sequence — services, then limiters, then route injection
// ---------------------------------------------------------------------------
// `initializeServices()` runs once from `startServer()` before any route is
// mounted. Order inside it matters: Redis connects first, then
// `initializeRateLimitStores()` wires the send-command and rebuilds the
// limiters (H2), then the Supabase service-role client is constructed and
// handed to every route module through its `initialize*Routes` injector. A
// failure anywhere here is fatal — the process exits rather than serve traffic
// with half-wired auth.
// Initialize services
let cacheService: CacheService;
let apiKeyService: ApiKeyService;
let supabaseService: SupabaseService;
let dataLayer: DataLayer;

async function initializeServices() {
  try {
    // Use the shared singleton cache service so all modules share one cache
    cacheService = sharedCacheService;
    
    // Connect to Redis if enabled in environment
    if (process.env.REDIS_ENABLED === 'true') {
      await cacheService.connectRedis();
      logger.info('Redis cache connected');
    } else {
      logger.info('Using LRU memory cache (Redis disabled)');
    }

    // H2: this both wires the Redis send-command and calls `buildAllLimiters()`
    // again. The import-time build ran before Redis existed, so without this
    // rebuild every limiter keeps a per-process in-memory store in production.
    await initializeRateLimitStores();

    // F7a: the AI credit counters have the same Redis dependency and now make
    // the same call — required in production, loud per-process fallback outside
    // it — instead of silently degrading to an unshared provider spend cap.
    const { initializeAiRateLimitStore } = await import('./middleware/aiRateLimit');
    await initializeAiRateLimitStore();

    // Initialize Supabase service
    const dbConfig = {
      url: process.env.SUPABASE_URL || 'http://127.0.0.1:55421',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    };
    supabaseService = new SupabaseService(dbConfig);

    // The data layer (`services/data/index.ts`): the same domain functions the
    // facade delegates to, bound ONCE to the client and to their `deps`. Route
    // families flipped off `SupabaseService` are injected with this instead.
    // `host` carries the three deps that still need the facade instance and
    // shrinks to nothing as the remaining importers are flipped — see
    // `docs/data-layer-wiring.md`.
    dataLayer = createDataLayer({
      client: supabaseService.getClient(),
      supabaseUrl: dbConfig.url,
      host: createDataLayerHost(supabaseService),
    });

    const { setIdempotencyClient } = await import('./middleware/idempotency');
    setIdempotencyClient(() => supabaseService.getClient());

    // Initialize API key service (requires Supabase service role client)
    apiKeyService = new (await import('./services/apiKey')).ApiKeyService();
    const { initializeApiKeyService } = await import('./services/apiKey');
    initializeApiKeyService(supabaseService);

    // Initialize auth middleware with supabase service
    const { initializeAuthMiddleware } = await import('./middleware/auth');
    initializeAuthMiddleware(supabaseService);

    const { initializeAuthorizeResource, assertProductionAuthStrict } = await import('./middleware/authorizeResource');
    initializeAuthorizeResource(supabaseService);
    const { initializePlatformAdminAuth } = await import('./utils/platformAdminAuth');
    initializePlatformAdminAuth(supabaseService);
    assertProductionAuthStrict();

    // Route modules hold their Supabase/cache handles in module scope and are
    // injected here. A router mounted without its injector having run throws on
    // first request, which is why mounting is deferred to after this function.
    // Initialize routes with services
    const { initializeUserRoutes } = await import('./routes/users');
    const { initializeGroupRoutes } = await import('./routes/groups');
    const { initializeMessageRoutes } = await import('./routes/messages');
    const { initializeNotificationRoutes } = await import('./routes/notifications');
    const { initializeTestRoutes } = await import('./routes/tests');
    const { initializeGamificationRoutes } = await import('./routes/gamification');
    const { initializeDeckRoutes } = await import('./routes/decks');
    const { initializeFlashcardRoutes } = await import('./routes/flashcards');
    const { initializeUserStatsRoutes } = await import('./routes/user-stats');
    const { initializeDashboardRoutes } = await import('./routes/dashboard');
    const { initializePreferencesRoutes } = await import('./routes/preferences');
    const { initializeMarketplaceRoutes } = await import('./routes/marketplace');
    const { initializeSitemapRoutes } = await import('./routes/sitemap');

    initializeUserRoutes(supabaseService, cacheService);
    initializeGroupRoutes(dataLayer, cacheService);
    initializeMessageRoutes(supabaseService, cacheService);
    initializeNotificationRoutes(dataLayer, cacheService);
    initializeTestRoutes(supabaseService, cacheService);
    initializeGamificationRoutes(dataLayer, cacheService);
    initializeDeckRoutes(supabaseService, cacheService);
    initializeFlashcardRoutes(supabaseService, cacheService);
    initializeUserStatsRoutes(dataLayer, cacheService);
    initializeDashboardRoutes(dataLayer, cacheService);
    initializePreferencesRoutes(dataLayer, cacheService);
    initializeMarketplaceRoutes(dataLayer, cacheService);
    initializePaystackWebhookRoutes(dataLayer);
    initializeJobsBoardRoutes(supabaseService, cacheService);
    initializeSitemapRoutes(dataLayer, cacheService);
    initializeOfflineBundlesRoutes(dataLayer, cacheService);
    initializeAdminRoutes(dataLayer, cacheService);
    initializeAICompanionRoutes(supabaseService);
    initializeAIRoutes(supabaseService);
    initializeAiBonusUses(supabaseService);
    initializeNotesRoutes(supabaseService, cacheService);
    initializeChallengeRoutes(supabaseService, cacheService);
    initializeAuthRoutes(supabaseService, cacheService);
    initializeStorageRoutes(dataLayer);
    initializeAnalyticsRoutes(dataLayer);
    initializeCourseRoutes(dataLayer, cacheService);
    initializeUserCourseRoutes(dataLayer, cacheService);
    initializeStudySetRoutes(supabaseService);
    initializeConceptRoutes(dataLayer, cacheService);
    initializeLibraryRoutes(dataLayer, cacheService);
    initializeCreatorRoutes(dataLayer);
    initializeReportRoutes(dataLayer, cacheService);
    initializeCommunityRoutes(supabaseService);
    initializeFeedRoutes(supabaseService);
    initializeReferralRoutes(dataLayer);
    initializeCampusRoutes(dataLayer, cacheService);
    initializeCourseTopicRoutes(dataLayer);
    initializeStudyRoomRoutes(dataLayer);
    initializeClassRoutes(dataLayer);
    initializeInstitutionStaffRoutes(dataLayer);
    initializeSchoolRoutes(dataLayer);

    const { initializeWalletService } = await import('./services/walletService');
    initializeWalletService(supabaseService, cacheService);

    const { initializeRecurringBudgetService } = await import('./services/recurringBudget');
    initializeRecurringBudgetService(supabaseService);

    const { initializeBudgetRoutes } = await import('./routes/budget');
    initializeBudgetRoutes(dataLayer, cacheService);

    // Background cron: run in-process only when BullMQ is off. With BullMQ
    // enabled the dedicated worker owns these, and starting them here too would
    // double-send retention emails and marketplace alerts.
    const { startDataRetentionJobs } = await import('./services/dataRetention');
    if (!isBullMqEnabled()) {
      startDataRetentionJobs(supabaseService);
    } else {
      logger.info('Data retention cron delegated to BullMQ worker');
    }

    const { startMarketplaceAlertJobs } = await import('./services/marketplaceAlerts');
    if (!isBullMqEnabled()) {
      startMarketplaceAlertJobs(supabaseService);
      const { startRetentionJobs } = await import('./services/retentionReminders');
      startRetentionJobs(supabaseService);
      const { startExamReminderJobs } = await import('./services/examReminders');
      startExamReminderJobs(supabaseService);
    } else {
      logger.info('Marketplace alert cron delegated to BullMQ worker');
    }

    logger.info('All services and routes initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Chain stage 2 — helmet (security headers)
// ---------------------------------------------------------------------------
// First responder in the chain: CSP and a one-year preloaded HSTS are set
// before any other middleware can write a response.
// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// ---------------------------------------------------------------------------
// Chain stage 3 — the CORS delegate
// ---------------------------------------------------------------------------
// A delegate rather than a static origin because the answer depends on the
// request: which credential it carries, and whether the path can set a cookie.
const corsBaseOptions = {
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  // 'X-Lantern-Surface' (Phase 1 C): without it in this list the browser
  // strips the header and every learning_event lands as surface='api'.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID', 'X-Requested-With', 'Idempotency-Key', 'X-Lantern-Surface'],
  // Expose EVERY AI usage header (single source of truth in aiRateLimit.ts).
  // The old three-item list hid X-AI-Global-Usage-* and X-AI-Feature from
  // browsers, so on feature routes the web badge showed feature counts (x/15)
  // instead of the global counter (x/20).
  exposedHeaders: ['X-Request-ID', ...AI_USAGE_EXPOSED_HEADERS],
};

// CORS configuration — production uses explicit allowlist only.
// A MISSING Origin is no longer blanket-allowed: with `credentials: true` that
// handed sandboxed iframes and cross-origin 307 redirects (which send no Origin)
// cookie-bearing access, making /auth/login and /auth/exchange login-CSRF and
// session-fixation targets. Only a non-cookie credential (Authorization /
// X-API-Key — a browser cannot attach those cross-site without a preflight)
// earns credentialed access with no Origin, and never on a cookie-setting path.
app.use(cors((req, callback) => {
  const origin = req.headers.origin;
  const rawCookie = req.headers.cookie || '';
  const hasAuthCookie =
    rawCookie.includes(`${ACCESS_COOKIE}=`) || rawCookie.includes(`${REFRESH_COOKIE}=`);
  const apiKeyHeader = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;
  const hasNonCookieCredential =
    (typeof apiKeyHeader === 'string' && apiKeyHeader.trim().length > 0) ||
    (typeof authHeader === 'string' && authHeader.trim().length > 0);

  const allowed = decideCorsOrigin({
    origin,
    hasNonCookieCredential,
    hasAuthCookie,
    isCookieSetting: isCookieSettingPath(req.url || ''),
  });

  // A present-but-disallowed Origin stays a hard rejection (unchanged behaviour).
  if (!allowed && origin) return callback(corsRejection());

  callback(null, { ...corsBaseOptions, origin: allowed });
}));

// ---------------------------------------------------------------------------
// Chain stage 4 — compression, then load shedding
// ---------------------------------------------------------------------------
// Compression middleware
app.use(compression());

// Shed load early (after CORS/helmet) so saturated instances fail fast with Retry-After
app.use(loadShedMiddleware);

// ---------------------------------------------------------------------------
// Chain stage 5 — body parsing: raw-body webhooks first, then size classes
// ---------------------------------------------------------------------------
// One dispatcher middleware (below) picks exactly one parser per request.
// Two rules govern it:
//   - The Paystack webhook path is matched FIRST, so `jsonWebhook` — the only
//     parser with a `verify` hook that captures `req.rawBody` — runs instead of
//     the generic parsers. An HMAC over raw bytes cannot survive a parser that
//     re-serializes the JSON.
//   - The large-upload classes are chosen by pathname before the 1mb default:
//     50mb for flashcard/marketplace/message uploads and offline bundles, 35mb
//     for note audio/PDF/presentation/image routes and companion attachments,
//     4mb for avatars, 1mb for everything else.
// Body parsing middleware — large routes MUST be registered before the 1mb default.
// Use path checks (not only RegExp mounts): Express RegExp layers can miss paths and
// silently fall through to the 1mb parser, which breaks lecture transcription.
const json50mb = express.json({
  limit: '50mb',
  verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); },
});
const json35mb = express.json({ limit: '35mb' });
const json4mb = express.json({ limit: '4mb' });
const json1mb = express.json({ limit: '1mb' });
// Paystack webhooks are authenticated by HMAC-SHA512 over the EXACT request
// bytes. json1mb has no `verify` hook, so webhook requests previously reached
// the handler with req.rawBody unset and signatures were checked against
// re-serialized JSON — a byte-for-byte match only by luck.
const jsonWebhook = express.json({
  limit: '1mb',
  verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); },
});

// Path classifiers for the body-limit dispatcher. They test the normalized
// pathname (query stripped, trailing slash removed) rather than relying on
// Express mounts, because a RegExp mount can miss a path and fall through to
// the 1mb parser.
function normalizePathname(raw: string): string {
  const path = (raw || '').split('?')[0] || '';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function isLargeUploadPath(pathname: string): boolean {
  return /\/api\/v1\/(flashcards|marketplace|messages)\/.*upload/.test(pathname);
}

function isLargeNotesPath(pathname: string): boolean {
  // endsWith so trailing-slash normalization / proxy prefixes cannot fall through to 1mb.
  return (
    pathname.endsWith('/notes/transcribe-audio') ||
    pathname.endsWith('/notes/upload-lecture-audio') ||
    pathname.endsWith('/notes/upload-pdf') ||
    pathname.endsWith('/notes/upload-presentation') ||
    pathname.endsWith('/notes/upload-images') ||
    /\/notes\/[^/]+\/regenerate-preview$/.test(pathname) ||
    /\/notes\/[^/]+\/attachments\/upload-images$/.test(pathname) ||
    // "Add image" in the companion composer posts the same base64 photo body
    // as a note photo. At the 1mb default every real phone picture 413s.
    pathname.endsWith('/ai/companion/attachments')
  );
}

function isOfflineBundlePath(pathname: string): boolean {
  return (
    pathname === '/api/v1/offline-bundles' ||
    pathname.startsWith('/api/v1/offline-bundles/') ||
    pathname.endsWith('/offline-bundles') ||
    pathname.includes('/offline-bundles/')
  );
}

function isAvatarUploadPath(pathname: string): boolean {
  return /\/api\/v1\/(users|groups)\/[^/]+\/avatar$/.test(pathname);
}

// The dispatcher. The webhook test is first and returns early: everything
// downstream of it depends on `req.rawBody` being the untouched request bytes.
app.use((req, res, next) => {
  const pathname = normalizePathname(req.originalUrl || req.url || '');
  if (pathname === '/webhooks/paystack' || pathname === '/api/v1/webhooks/paystack') {
    return jsonWebhook(req, res, next);
  }
  if (isLargeUploadPath(pathname)) return json50mb(req, res, next);
  if (isLargeNotesPath(pathname)) return json35mb(req, res, next);
  if (isOfflineBundlePath(pathname)) return json50mb(req, res, next);
  if (isAvatarUploadPath(pathname)) return json4mb(req, res, next);
  return json1mb(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// ---------------------------------------------------------------------------
// Chain stage 6 — cookies and CSRF
// ---------------------------------------------------------------------------
// cookieParser must precede the CSRF check and every auth middleware, which
// read the lantern_access / lantern_refresh cookies off `req.cookies`.
app.use(cookieParser());
app.use(csrfProtectionMiddleware);
// NOTE: sanitizationMiddleware and validateBodyShape() are deliberately NOT mounted
// here. Both walk the whole parsed body, so running them ahead of the rate limiter
// let an unauthenticated caller buy body-sized CPU per request. They are mounted in
// startServer() immediately after anonymousIpRateLimit and before any route.

// ---------------------------------------------------------------------------
// Chain stage 7 — logging, timeout, request id
// ---------------------------------------------------------------------------
// Request logging (morgan only — avoid double HTTP logs in production)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'combined', { stream }));
if (process.env.NODE_ENV !== 'production') {
  app.use(logRequest);
}

// Rate limiting is mounted in startServer after Redis + limiter init

// Default request timeout (30 seconds) — skip for long-running note uploads/conversion
app.use(skipTimeoutForLongRunningNotes);

// Request ID middleware
app.use((req: any, res: any, next: any) => {
  req.requestId = require('crypto').randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});



// ---------------------------------------------------------------------------
// Public health surface
// ---------------------------------------------------------------------------
// Mounted here, outside startServer(), so /health and /ready answer during
// service initialization and the platform's health check does not kill a
// still-booting instance. No auth and no rate limiter.
// Health, readiness, and metrics (no auth)
app.use('/', healthRoutes);

// API routes
// Moved to startServer function after services initialization
// app.use('/api/v1/users', userRoutes);
// app.use('/api/v1/groups', groupRoutes);
// app.use('/api/v1/messages', messageRoutes);
// app.use('/api/v1/notifications', notificationRoutes);
// app.use('/api/v1/tests', testRoutes);
// app.use('/api/v1/gamification', gamificationRoutes);
// app.use('/api/v1/decks', deckRoutes);
// app.use('/api/v1/flashcards', flashcardRoutes);
// app.use('/api/v1/user-stats', userStatsRoutes);


// Start server
let httpServer: ReturnType<typeof app.listen> | null = null;

/**
 * Completes the chain and starts listening.
 *
 * Everything from here down must run after `initializeServices()`: the rate
 * limiters need the Redis-backed stores built by `initializeRateLimitStores()`,
 * and every router needs its service injector to have run.
 */
async function startServer() {
  try {
    await initializeServices();

    // -----------------------------------------------------------------------
    // Chain stage 8 — rate limiting
    // -----------------------------------------------------------------------
    // Mounted only now, because the limiter handlers are rebuilt against the
    // Redis store inside initializeServices(). DISABLE_RATE_LIMIT is a
    // development switch; validateProductionSecrets() exits the process if it
    // is set in production.
    if (process.env.DISABLE_RATE_LIMIT !== 'true') {
      // Paystack webhooks carry no credential, so the anonymous 300/15min/IP
      // bucket applied to them — Paystack retries from a small IP pool and
      // would 429 itself out of delivering a payment. Signature verification
      // in the webhook route is the real gate here.
      app.use((req, res, next) => {
        if (isWebhookRateLimitExempt(req.path || '')) return next();
        return anonymousIpRateLimit(req, res, next);
      });
    }

    // -----------------------------------------------------------------------
    // Chain stage 9 — sanitiser and body-shape validator (position set by H1)
    // -----------------------------------------------------------------------
    // Body-walking middleware runs AFTER the rate limiter (and after the body-size
    // limits above) so a flood of huge bodies is shed at 429 instead of paying for
    // a full traversal per request.
    app.use(sanitizationMiddleware);
    app.use(validateBodyShape());

    // -----------------------------------------------------------------------
    // Chain stage 10 — route mounts
    // -----------------------------------------------------------------------
    // Auth is applied per mount, in three modes:
    //   - No middleware here: the router applies `authMiddleware` itself on the
    //     routes that need it. This is the default for the study surfaces.
    //   - `optionalAuthMiddleware` at the mount: the surface is browsable
    //     signed-out but personalises when a session is present. Used for
    //     /campuses, /jobs-board, /groups and /marketplace, each paired with
    //     `applyPublicRateLimits` because anonymous traffic reaches them.
    //   - Fully public: /webhooks/paystack (authenticated by HMAC signature,
    //     not by session) and /sitemap.
    // Mount ORDER matters where a prefix would shadow a sibling — Express
    // matches in registration order — hence the /users/me/* and
    // /courses/:courseId/topics mounts preceding their parents.
    // The admin gate is last: /api/v1/admin is the only mount with a hard
    // `authMiddleware` + `requirePlatformAdmin` + `adminRateLimit` stack.
    // API routes (mount after services initialization)
    // /users/me/courses MUST be mounted before /users so the "me" segment is
    // never captured by /users/:userId/* (Express matches in registration order).
    app.use('/api/v1/users/me/courses', userCourseRoutes);
    app.use('/api/v1/users/me/study-sets', studySetRoutes);
    app.use('/api/v1/users', userRoutes);
    // Nested topics mount before /courses so the parent router does not
    // swallow /:courseId/topics.
    app.use('/api/v1/courses/:courseId/topics', courseTopicRoutes);
    app.use('/api/v1/courses', courseRoutes);
    app.use('/api/v1/concepts', conceptRoutes);
    app.use('/api/v1/library', libraryRoutes);
    app.use('/api/v1/creators', creatorRoutes);
    app.use('/api/v1/communities', communityRoutes);
    app.use('/api/v1/study-rooms', studyRoomRoutes);
    app.use('/api/v1/classes', classRoutes);
    app.use('/api/v1/schools', schoolRoutes);
    app.use('/api/v1', institutionStaffRoutes);
    app.use('/api/v1/discover', discoverRouter);
    app.use('/api/v1/feed', feedRoutes);
    app.use('/api/v1/mastery', masteryRouter);
    app.use('/api/v1/referrals', referralRoutes);
    // Public + crawled: same guard shape as the jobs board.
    app.use('/api/v1/campuses', optionalAuthMiddleware, applyPublicRateLimits, campusRoutes);
    app.use('/api/v1/reports', reportRoutes);
    app.use('/api/v1/auth', authRoutes);
    app.use('/api/v1/storage', storageRoutes);
    app.use('/api/v1/jobs', jobsRoutes);
    // Open to every viewer (2026-09-15, founder: "make the campus and
    // marketplace discoverable to all"). Mounted on the router, not a path
    // prefix — /api/v1/jobs is the async job-queue status endpoint that note
    // import, AI and the companion poll, and a prefix mount would catch it too.
    app.use('/api/v1/jobs-board', optionalAuthMiddleware, applyPublicRateLimits, jobsBoardRoutes);
    app.use('/api/v1/budget', budgetRoutes);
    app.use('/api/v1/contact', contactRoutes);
    app.use('/api/v1/analytics', analyticsRoutes);
    app.use('/api/v1/groups', optionalAuthMiddleware, applyPublicRateLimits, groupRoutes);
    app.use('/api/v1/messages', messageRoutes);
    app.use('/api/v1/notifications', notificationRoutes);
    app.use('/api/v1/tests', testRoutes);
    app.use('/api/v1/gamification', gamificationRoutes);
    app.use('/api/v1/decks', deckRoutes);
    app.use('/api/v1/flashcards', flashcardRoutes);
    app.use('/api/v1/user-stats', userStatsRoutes);
    app.use('/api/v1/dashboard', dashboardRoutes);
    app.use('/api/v1/preferences', preferencesRoutes);
    // Open to every viewer. The private-pilot allowlist that used to sit
    // between optional auth and this router was removed on 2026-09-15; per-route
    // `authMiddleware`, ownership checks, the seller payout-profile gate and the
    // rights/moderation rules are what protect writes. GET /access remains and
    // always answers `enabled: true` so already-installed clients open up
    // without an update.
    app.use('/api/v1/marketplace', optionalAuthMiddleware, marketplaceGeoMiddleware, applyPublicRateLimits, marketplaceRoutes);
    // Public by design and mounted at two paths (the legacy root path and the
    // /api/v1 one Paystack is configured with). Authentication is the HMAC
    // signature over `req.rawBody`, which is why the raw-body parser had to win
    // the dispatcher above. `isWebhookRateLimitExempt` keeps these paths out of
    // the anonymous IP bucket.
    app.use('/webhooks/paystack', paystackWebhookRoutes);
    app.use('/api/v1/webhooks/paystack', paystackWebhookRoutes);
    app.use('/api/v1/sitemap', sitemapRoutes);
    app.use('/api/v1/api-keys', apiKeysRoutes);
    app.use('/api/v1/ai', aiRoutes);
    app.use('/api/v1/ai/companion', aiCompanionRoutes);
    app.use('/api/v1/notes', notesRoutes);
    app.use('/api/v1/challenges', challengeRoutes);
    app.use('/api/v1/offline-bundles', offlineBundlesRoutes);
    // The admin gate. `requirePlatformAdmin` re-checks the role against the
    // database on every request rather than trusting a JWT claim.
    app.use('/api/v1/admin', authMiddleware, requirePlatformAdmin, adminRateLimit, adminRoutes);
    app.use(notFoundHandler);

    // -----------------------------------------------------------------------
    // Chain stage 11 — error handling (must follow every route)
    // -----------------------------------------------------------------------
    // Express selects error middleware by registration order, so these run last:
    // Sentry's capture handler, then the database and Supabase mappers that
    // translate driver-level failures into API errors, then the generic handler
    // that shapes the response.
    setupSentryExpress(app);

    // Error handling middleware (must be registered after routes)
    app.use(databaseErrorHandler);
    app.use(supabaseErrorHandler);
    app.use(errorHandler);

    // Listen last. `process.send('ready')` tells a process manager the instance
    // is fully wired, not merely bound to the port.
    httpServer = app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
      logger.info(`🔑 API Keys: DB-backed (lsk_ prefix)`);
      logger.info(`📈 Rate Limiting: enabled`);
      logger.info(`💾 Caching: ${process.env.REDIS_ENABLED === 'true' ? 'redis' : 'memory'}`);
      if (typeof process.send === 'function') process.send('ready');
    });

    configureHttpServer(httpServer);

    setupGracefulShutdown(httpServer, async () => {
      if (cacheService) await cacheService.disconnect();
      await disconnectRedis();
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
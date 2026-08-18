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

// Import middleware
import { anonymousIpRateLimit, adminRateLimit, initializeRateLimitStores } from './middleware/rateLimit';
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
import { getAllowedCorsOrigins } from './utils/corsOrigins';
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
import cookieParser from 'cookie-parser';
import { isBullMqEnabled } from './queue/connection';

// Import utilities
import { logger, stream, logRequest } from './utils/logger';

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Render / reverse proxies set X-Forwarded-For; required for stable per-IP rate limits.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Initialize services
let cacheService: CacheService;
let apiKeyService: ApiKeyService;
let supabaseService: SupabaseService;

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

    await initializeRateLimitStores();

    // Initialize Supabase service
    const dbConfig = {
      url: process.env.SUPABASE_URL || 'http://127.0.0.1:55421',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    };
    supabaseService = new SupabaseService(dbConfig);
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
    initializeGroupRoutes(supabaseService, cacheService);
    initializeMessageRoutes(supabaseService, cacheService);
    initializeNotificationRoutes(supabaseService, cacheService);
    initializeTestRoutes(supabaseService, cacheService);
    initializeGamificationRoutes(supabaseService, cacheService);
    initializeDeckRoutes(supabaseService, cacheService);
    initializeFlashcardRoutes(supabaseService, cacheService);
    initializeUserStatsRoutes(supabaseService, cacheService);
    initializeDashboardRoutes(supabaseService, cacheService);
    initializePreferencesRoutes(supabaseService, cacheService);
    initializeMarketplaceRoutes(supabaseService, cacheService);
    initializePaystackWebhookRoutes(supabaseService);
    initializeJobsBoardRoutes(supabaseService, cacheService);
    initializeSitemapRoutes(supabaseService, cacheService);
    initializeOfflineBundlesRoutes(supabaseService, cacheService);
    initializeAdminRoutes(supabaseService, cacheService);
    initializeAICompanionRoutes(supabaseService);
    initializeAIRoutes(supabaseService);
    initializeNotesRoutes(supabaseService, cacheService);
    initializeChallengeRoutes(supabaseService, cacheService);
    initializeAuthRoutes(supabaseService, cacheService);
    initializeStorageRoutes(supabaseService);
    initializeAnalyticsRoutes(supabaseService);

    const { initializeWalletService } = await import('./services/walletService');
    initializeWalletService(supabaseService, cacheService);

    const { initializeBudgetRoutes } = await import('./routes/budget');
    initializeBudgetRoutes(supabaseService, cacheService);

    const { startDataRetentionJobs } = await import('./services/dataRetention');
    if (!isBullMqEnabled()) {
      startDataRetentionJobs(supabaseService);
    } else {
      logger.info('Data retention cron delegated to BullMQ worker');
    }

    const { startMarketplaceAlertJobs } = await import('./services/marketplaceAlerts');
    if (!isBullMqEnabled()) {
      startMarketplaceAlertJobs(supabaseService);
    } else {
      logger.info('Marketplace alert cron delegated to BullMQ worker');
    }

    logger.info('All services and routes initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

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

// CORS configuration — production uses explicit allowlist only
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = getAllowedCorsOrigins();
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (process.env.ALLOW_ALL_CORS === 'true' && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(corsRejection());
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID', 'X-Requested-With', 'Idempotency-Key'],
  // Expose EVERY AI usage header (single source of truth in aiRateLimit.ts).
  // The old three-item list hid X-AI-Global-Usage-* and X-AI-Feature from
  // browsers, so on feature routes the web badge showed feature counts (x/15)
  // instead of the global counter (x/100).
  exposedHeaders: ['X-Request-ID', ...AI_USAGE_EXPOSED_HEADERS],
}));

// Compression middleware
app.use(compression());

// Shed load early (after CORS/helmet) so saturated instances fail fast with Retry-After
app.use(loadShedMiddleware);

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
    /\/notes\/[^/]+\/attachments\/upload-images$/.test(pathname)
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
app.use(cookieParser());
app.use(csrfProtectionMiddleware);
app.use(sanitizationMiddleware);
app.use(validateBodyShape());

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

async function startServer() {
  try {
    await initializeServices();

    if (process.env.DISABLE_RATE_LIMIT !== 'true') {
      app.use(anonymousIpRateLimit);
    }

    // API routes (mount after services initialization)
    app.use('/api/v1/users', userRoutes);
    app.use('/api/v1/auth', authRoutes);
    app.use('/api/v1/storage', storageRoutes);
    app.use('/api/v1/jobs', jobsRoutes);
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
    app.use('/api/v1/marketplace', optionalAuthMiddleware, marketplaceGeoMiddleware, applyPublicRateLimits, marketplaceRoutes);
    app.use('/webhooks/paystack', paystackWebhookRoutes);
    app.use('/api/v1/webhooks/paystack', paystackWebhookRoutes);
    app.use('/api/v1/sitemap', sitemapRoutes);
    app.use('/api/v1/api-keys', apiKeysRoutes);
    app.use('/api/v1/ai', aiRoutes);
    app.use('/api/v1/ai/companion', aiCompanionRoutes);
    app.use('/api/v1/notes', notesRoutes);
    app.use('/api/v1/challenges', challengeRoutes);
    app.use('/api/v1/offline-bundles', offlineBundlesRoutes);
    app.use('/api/v1/admin', authMiddleware, requirePlatformAdmin, adminRateLimit, adminRoutes);
    app.use(notFoundHandler);

    setupSentryExpress(app);

    // Error handling middleware (must be registered after routes)
    app.use(databaseErrorHandler);
    app.use(supabaseErrorHandler);
    app.use(errorHandler);

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
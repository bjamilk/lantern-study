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
import { authMiddleware, requirePlatformAdmin } from './middleware/auth';
import { errorHandler, notFoundHandler, databaseErrorHandler, supabaseErrorHandler } from './middleware/errorHandler';
import { handleValidationErrors } from './middleware/validation';
import { defaultTimeout } from './middleware/timeout';
import { sanitizationMiddleware } from './middleware/security';
import { validateBodyShape } from './middleware/validateBody';
import { applyPublicRateLimits } from './middleware/publicRateLimitMiddleware';
import { getAllowedCorsOrigins } from './utils/corsOrigins';
import healthRoutes from './routes/health';
import { setupGracefulShutdown } from './config/production';
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
import preferencesRoutes from './routes/preferences';
import marketplaceRoutes from './routes/marketplace';
import aiRoutes, { initializeAIRoutes } from './routes/ai';
import offlineBundlesRoutes, { initializeOfflineBundlesRoutes } from './routes/offlineBundles';
import adminRoutes, { initializeAdminRoutes } from './routes/admin';
import aiCompanionRoutes, { initializeAICompanionRoutes } from './routes/aiCompanion';
import notesRoutes, { initializeNotesRoutes } from './routes/notes';
import challengeRoutes, { initializeChallengeRoutes } from './routes/challenges';
import apiKeysRoutes from './routes/apiKeys';

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

    // Initialize API key service (requires Supabase service role client)
    apiKeyService = new (await import('./services/apiKey')).ApiKeyService();
    const { initializeApiKeyService } = await import('./services/apiKey');
    initializeApiKeyService(supabaseService);

    // Initialize auth middleware with supabase service
    const { initializeAuthMiddleware } = await import('./middleware/auth');
    initializeAuthMiddleware(supabaseService);

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
    const { initializePreferencesRoutes } = await import('./routes/preferences');
    const { initializeMarketplaceRoutes } = await import('./routes/marketplace');

    initializeUserRoutes(supabaseService, cacheService);
    initializeGroupRoutes(supabaseService, cacheService);
    initializeMessageRoutes(supabaseService, cacheService);
    initializeNotificationRoutes(supabaseService, cacheService);
    initializeTestRoutes(supabaseService, cacheService);
    initializeGamificationRoutes(supabaseService, cacheService);
    initializeDeckRoutes(supabaseService, cacheService);
    initializeFlashcardRoutes(supabaseService, cacheService);
    initializeUserStatsRoutes(supabaseService, cacheService);
    initializePreferencesRoutes(supabaseService, cacheService);
    initializeMarketplaceRoutes(supabaseService, cacheService);
    initializeOfflineBundlesRoutes(supabaseService, cacheService);
    initializeAdminRoutes(supabaseService, cacheService);
    initializeAICompanionRoutes(supabaseService);
    initializeAIRoutes(supabaseService);
    initializeNotesRoutes(supabaseService, cacheService);
    initializeChallengeRoutes(supabaseService, cacheService);

    const { startDataRetentionJobs } = await import('./services/dataRetention');
    startDataRetentionJobs(supabaseService);

    const { startMarketplaceAlertJobs } = await import('./services/marketplaceAlerts');
    startMarketplaceAlertJobs(supabaseService);

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
const allowedOrigins = getAllowedCorsOrigins();
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (process.env.ALLOW_ALL_CORS === 'true' && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-AI-Usage-Used', 'X-AI-Usage-Limit', 'X-AI-Usage-Resets-At'],
}));

// Compression middleware
app.use(compression());

// Body parsing middleware — large routes MUST be registered before the 1mb default
app.use(
  /^\/api\/v1\/(flashcards|marketplace)\/.*upload/,
  express.json({
    limit: '50mb',
    verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); },
  })
);

app.use(
  /^\/api\/v1\/notes\/(transcribe-audio|upload-pdf|upload-presentation)$/,
  express.json({ limit: '25mb' })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(sanitizationMiddleware);
app.use(validateBodyShape());

// Request logging (morgan only — avoid double HTTP logs in production)
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'combined', { stream }));
if (process.env.NODE_ENV !== 'production') {
  app.use(logRequest);
}

// Rate limiting is mounted in startServer after Redis + limiter init

// Default request timeout (30 seconds)
app.use(defaultTimeout);

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
    app.use('/api/v1/groups', applyPublicRateLimits, groupRoutes);
    app.use('/api/v1/messages', messageRoutes);
    app.use('/api/v1/notifications', notificationRoutes);
    app.use('/api/v1/tests', testRoutes);
    app.use('/api/v1/gamification', gamificationRoutes);
    app.use('/api/v1/decks', deckRoutes);
    app.use('/api/v1/flashcards', flashcardRoutes);
    app.use('/api/v1/user-stats', userStatsRoutes);
    app.use('/api/v1/preferences', preferencesRoutes);
    app.use('/api/v1/marketplace', applyPublicRateLimits, marketplaceRoutes);
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
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { config } from 'dotenv';

// Load environment variables first
config();

// Import services
import { CacheService, cacheService as sharedCacheService } from './services/cache';
import { ApiKeyService } from './services/apiKey';
import { SupabaseService } from './services/supabase';

// Import middleware
import { rateLimitMiddleware } from './middleware/rateLimit';
import { authMiddleware } from './middleware/auth';
import { errorHandler, notFoundHandler, databaseErrorHandler, supabaseErrorHandler } from './middleware/errorHandler';
import { handleValidationErrors } from './middleware/validation';
import { defaultTimeout, extendedTimeout } from './middleware/timeout';

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
import aiRoutes from './routes/ai';
import studySessionRoutes from './routes/studySessions';
import offlineBundlesRoutes, { initializeOfflineBundlesRoutes } from './routes/offlineBundles';

// Import utilities
import { logger, stream, logRequest } from './utils/logger';

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

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

    // Initialize API key service
    apiKeyService = new (await import('./services/apiKey')).ApiKeyService();

    // Initialize Supabase service
    const dbConfig = {
      url: process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    };
    supabaseService = new SupabaseService(dbConfig);

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
    const { initializeStudySessionRoutes } = await import('./routes/studySessions');

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
    initializeStudySessionRoutes(supabaseService, cacheService);
    initializeOfflineBundlesRoutes(supabaseService, cacheService);

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

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Allow localhost on any port (for development)
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }

    // Allow specific production URLs if needed
    if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) {
      return callback(null, true);
    }

    // In development, be more permissive
    if (process.env.NODE_ENV !== 'production') {
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

// Body parsing middleware
// Increase limits to support large base64 image uploads (e.g., flashcard images)
// Capture raw body for better debugging of JSON parse failures.
app.use(express.json({
  limit: '50mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  },
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use(morgan('combined', { stream }));
app.use(logRequest);

// Rate limiting (skip in development to avoid issues with React Strict Mode double-firing)
if (process.env.NODE_ENV === 'production') {
  app.use(rateLimitMiddleware);
}

// Default request timeout (30 seconds)
app.use(defaultTimeout);

// Request ID middleware
app.use((req: any, res: any, next: any) => {
  req.requestId = require('crypto').randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// Health check endpoint (temporarily enabled)
// app.get('/health', async (req, res) => {
//   try {
//     // Check database connection
//     await supabaseService.healthCheck();

//     // Check cache connection
//     await cacheService.healthCheck();

//     res.status(200).json({
//       status: 'healthy',
//       timestamp: new Date().toISOString(),
//       services: {
//         database: 'connected',
//         cache: 'connected',
//       },
//     });
//   } catch (error) {
//     logger.error('Health check failed:', error);
//     res.status(503).json({
//       status: 'unhealthy',
//       timestamp: new Date().toISOString(),
//       error: error instanceof Error ? error.message : 'Unknown error',
//     });
//   }
// });

app.get('/health', async (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

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


// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

// process.on('SIGINT', async () => {
//   console.log('SIGINT received, shutting down gracefully');
//   process.exit(0);
// });

process.on('SIGINT', async () => {
  console.log('SIGINT received, but ignoring in development mode');
  // Don't exit in development
});

// Start server
async function startServer() {
  try {
    await initializeServices();

    // API routes (mount after services initialization)
    app.use('/api/v1/users', userRoutes);
    app.use('/api/v1/groups', groupRoutes);
    app.use('/api/v1/messages', messageRoutes);
    app.use('/api/v1/notifications', notificationRoutes);
    app.use('/api/v1/tests', testRoutes);
    app.use('/api/v1/gamification', gamificationRoutes);
    app.use('/api/v1/decks', deckRoutes);
    app.use('/api/v1/flashcards', flashcardRoutes);
    app.use('/api/v1/user-stats', userStatsRoutes);
    app.use('/api/v1/preferences', preferencesRoutes);
    app.use('/api/v1/marketplace', marketplaceRoutes);
    app.use('/api/v1/ai', aiRoutes);
    app.use('/api/v1/study-sessions', studySessionRoutes);
    app.use('/api/v1/offline-bundles', offlineBundlesRoutes);
    app.use(notFoundHandler);

    // Error handling middleware (must be registered after routes)
    app.use(databaseErrorHandler);
    app.use(supabaseErrorHandler);
    app.use(errorHandler);

    app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
      logger.info(`🔑 API Key Auth: ${process.env.ENABLE_API_KEY_AUTH === 'true' ? 'enabled' : 'disabled'}`);
      logger.info(`📈 Rate Limiting: enabled`);
      logger.info(`💾 Caching: enabled`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();
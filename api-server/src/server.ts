console.log('=== SERVER.TS START ===');
import express from 'express';
console.log('express imported');
import cors from 'cors';
console.log('cors imported');
import helmet from 'helmet';
console.log('helmet imported');
import compression from 'compression';
console.log('compression imported');
import morgan from 'morgan';
console.log('morgan imported');
import { config } from 'dotenv';
console.log('dotenv imported');

// Load environment variables first
config();
console.log('dotenv config loaded');

// Import services
console.log('importing CacheService...');
import { CacheService, cacheService as sharedCacheService } from './services/cache';
console.log('CacheService imported');
import { ApiKeyService } from './services/apiKey';
console.log('ApiKeyService imported');

console.log('importing SupabaseService...');
import { SupabaseService } from './services/supabase';
console.log('SupabaseService imported');

console.log('Importing middleware...');
// Import middleware
import { rateLimitMiddleware } from './middleware/rateLimit';
console.log('rateLimitMiddleware imported');
import { authMiddleware } from './middleware/auth';
console.log('authMiddleware imported');
import { errorHandler, notFoundHandler, databaseErrorHandler, supabaseErrorHandler } from './middleware/errorHandler';
console.log('errorHandlers imported');
import { handleValidationErrors } from './middleware/validation';
console.log('validation imported');
import { defaultTimeout, extendedTimeout } from './middleware/timeout';
console.log('timeout middleware imported');

console.log('Importing routes...');
// Import routes
import userRoutes from './routes/users';
console.log('userRoutes imported');
import groupRoutes from './routes/groups';
console.log('groupRoutes imported');
import messageRoutes from './routes/messages';
console.log('messageRoutes imported');
import notificationRoutes from './routes/notifications';
console.log('notificationRoutes imported');
import testRoutes from './routes/tests';
console.log('Loading tests.ts');
import gamificationRoutes from './routes/gamification';
console.log('gamificationRoutes imported');
import deckRoutes from './routes/decks';
console.log('deckRoutes imported');
import { router as flashcardRoutes } from './routes/flashcards';
console.log('flashcardRoutes imported');
import userStatsRoutes from './routes/user-stats';
console.log('userStatsRoutes imported');
import marketplaceRoutes from './routes/marketplace';
console.log('marketplaceRoutes imported');
import aiRoutes from './routes/ai';
console.log('aiRoutes imported');
import preferencesRoutes from './routes/preferences';
console.log('preferencesRoutes imported');

// Import utilities
import { logger, stream, logRequest } from './utils/logger';
console.log('logger imported');

console.log('All imports loaded successfully');

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
    const { initializeMarketplaceRoutes } = await import('./routes/marketplace');
    const { initializePreferencesRoutes } = await import('./routes/preferences');

    initializeUserRoutes(supabaseService, cacheService);
    initializeGroupRoutes(supabaseService, cacheService);
    initializeMessageRoutes(supabaseService, cacheService);
    initializeNotificationRoutes(supabaseService, cacheService);
    initializeTestRoutes(supabaseService, cacheService);
    initializeGamificationRoutes(supabaseService, cacheService);
    initializeDeckRoutes(supabaseService, cacheService);
    initializeFlashcardRoutes(supabaseService, cacheService);
    initializeUserStatsRoutes(supabaseService, cacheService);
    initializeMarketplaceRoutes(supabaseService, cacheService);
    initializePreferencesRoutes(supabaseService, cacheService);

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
const isProduction = process.env.NODE_ENV === 'production';
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // In production, only allow specific origins
    if (isProduction) {
      if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) {
        return callback(null, true);
      }
      // Add additional production domains here
      const allowedDomains = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
      if (allowedDomains.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    }

    // In development, allow localhost on any port
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }

    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-AI-Usage-Used', 'X-AI-Usage-Limit', 'X-AI-Usage-Resets-At'],
}));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// 404 handler and error handling middleware are mounted inside startServer()
// after all routes, so Express can properly catch route errors.

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

    // API routes (moved here after services initialization)
    console.log('Mounting routes...');
    console.log('Mounting users route...');
    app.use('/api/v1/users', userRoutes);
    const { createOfflineBundleRouter } = await import('./routes/offlineBundles');
    app.use('/api/v1/offline-bundles', createOfflineBundleRouter(supabaseService));
    console.log('Users route mounted');
    console.log('Mounting groups route...');
    app.use('/api/v1/groups', groupRoutes);
    console.log('Groups route mounted');
    app.use('/api/v1/messages', messageRoutes);
    app.use('/api/v1/notifications', notificationRoutes);
    console.log('Mounting tests route...');
    app.use('/api/v1/tests', testRoutes);
    console.log('Tests route mounted');
    app.use('/api/v1/gamification', gamificationRoutes);
    console.log('Mounting decks route...');
    app.use('/api/v1/decks', deckRoutes);
    console.log('Decks route mounted');
    console.log('Mounting flashcards route...');
    console.log('flashcardRoutes type:', typeof flashcardRoutes, flashcardRoutes);
    app.use('/api/v1/flashcards', flashcardRoutes);
    console.log('Flashcards route mounted');
    app.use('/api/v1/user-stats', userStatsRoutes);
    app.use('/api/v1/marketplace', marketplaceRoutes);
    console.log('Marketplace route mounted');
    app.use('/api/v1/preferences', preferencesRoutes);
    console.log('Preferences route mounted');
    app.use('/api/v1/ai', aiRoutes);
    console.log('AI route mounted');
    app.use(notFoundHandler);

    // Error handling middleware (must be after all routes)
    app.use(databaseErrorHandler);
    app.use(supabaseErrorHandler);
    app.use(errorHandler);

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
      console.log(`🔑 API Key Auth: ${process.env.ENABLE_API_KEY_AUTH === 'true' ? 'enabled' : 'disabled'}`);
      console.log(`📈 Rate Limiting: enabled`);
      console.log(`💾 Caching: enabled`);
      console.log('Server is now listening and should stay running...');
      // Keep the process alive
      setInterval(() => {
        // Heartbeat to prevent process from exiting
      }, 1000);
      // logger.info(`🚀 Server running on port ${PORT}`);
      // logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      // logger.info(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
      // logger.info(`🔑 API Key Auth: ${process.env.ENABLE_API_KEY_AUTH === 'true' ? 'enabled' : 'disabled'}`);
      // logger.info(`📈 Rate Limiting: enabled`);
      // logger.info(`💾 Caching: enabled`);
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
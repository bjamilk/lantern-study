import { Express } from 'express';
import { globalErrorHandler, notFoundHandler } from '../middleware/productionErrorHandler';
import { logger } from '../services/logger';
import { markServerShuttingDown } from '../middleware/loadShed';

// NOTE: `applyProductionMiddleware` used to live here — a second, never-mounted
// middleware stack (laxer CORS, a flat 10mb JSON parser, its own sanitiser mount).
// Nothing imported it; server.ts builds the real stack. It was deleted so nobody
// resurrects the weaker configuration by calling it.

/**
 * Apply error handlers after all routes
 */
export function applyErrorHandlers(app: Express): void {
  // 404 handler for unknown routes
  app.use(notFoundHandler);
  
  // Global error handler (must be last)
  app.use(globalErrorHandler);
}

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown(server: any, cleanup?: () => Promise<void>): void {
  let isShuttingDown = false;
  
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    markServerShuttingDown();
    
    logger.info(`${signal} received, starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');
      
      // Run cleanup if provided
      if (cleanup) {
        try {
          await cleanup();
          logger.info('Cleanup completed');
        } catch (error) {
          logger.error('Cleanup error', error as Error);
        }
      }
      
      process.exit(0);
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Could not close connections in time, forcing shutdown');
      process.exit(1);
    }, 30000);
  };
  
  // Handle termination signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception - shutting down', error);
    gracefulShutdown('uncaughtException');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', reason as Error, { 
      promise: String(promise) 
    });
  });
}

/**
 * Environment validation
 */
export function validateEnvironment(): void {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0 && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Log warnings for development
  if (missing.length > 0) {
    logger.warn('Missing environment variables (using defaults)', { missing });
  }
  
  // Validate PORT is a number
  const port = process.env.PORT;
  if (port && isNaN(parseInt(port))) {
    throw new Error('PORT must be a valid number');
  }
}

/**
 * Production configuration values
 */
export const productionConfig = {
  // Server
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database
  supabaseUrl: process.env.SUPABASE_URL || 'http://127.0.0.1:55421',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  
  // Security
  jwtSecret: process.env.JWT_SECRET,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  
  // Rate limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  
  // Cache
  cacheTTL: parseInt(process.env.CACHE_TTL || '300'),
  
  // Features
  enableMetrics: process.env.ENABLE_METRICS === 'true',
  enableDebugLogs: process.env.ENABLE_DEBUG_LOGS === 'true',
};

export default {
  applyErrorHandlers,
  setupGracefulShutdown,
  validateEnvironment,
  productionConfig,
};

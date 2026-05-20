console.log('Test imports started');

import { config } from 'dotenv';
config();
console.log('dotenv loaded');

import express from 'express';
console.log('express loaded');

import cors from 'cors';
console.log('cors loaded');

import helmet from 'helmet';
console.log('helmet loaded');

import compression from 'compression';
console.log('compression loaded');

import morgan from 'morgan';
console.log('morgan loaded');

import { CacheService } from './src/services/cache';
console.log('CacheService loaded');

import { ApiKeyService } from './src/services/apiKey';
console.log('ApiKeyService loaded');

import { SupabaseService } from './src/services/supabase';
console.log('SupabaseService loaded');

import { rateLimitMiddleware } from './src/middleware/rateLimit';
console.log('rateLimitMiddleware loaded');

import { authMiddleware } from './src/middleware/auth';
console.log('authMiddleware loaded');

import { errorHandler, notFoundHandler, databaseErrorHandler, supabaseErrorHandler } from './src/middleware/errorHandler';
console.log('errorHandlers loaded');

import { handleValidationErrors } from './src/middleware/validation';
console.log('validation loaded');

import userRoutes from './src/routes/users';
console.log('userRoutes loaded');

import groupRoutes from './src/routes/groups';
console.log('groupRoutes loaded');

import messageRoutes from './src/routes/messages';
console.log('messageRoutes loaded');

import notificationRoutes from './src/routes/notifications';
console.log('notificationRoutes loaded');

import testRoutes from './src/routes/tests';
console.log('testRoutes loaded');

import gamificationRoutes from './src/routes/gamification';
console.log('gamificationRoutes loaded');

import deckRoutes from './src/routes/decks';
console.log('deckRoutes loaded');

import { router as flashcardRoutes } from './src/routes/flashcards';
console.log('flashcardRoutes loaded');

import userStatsRoutes from './src/routes/user-stats';
console.log('userStatsRoutes loaded');

import marketplaceRoutes from './src/routes/marketplace';
console.log('marketplaceRoutes loaded');

import { logger, stream, logRequest } from './src/utils/logger';
console.log('logger loaded');

console.log('All imports successful!');

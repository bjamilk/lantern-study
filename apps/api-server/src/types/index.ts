// API Server Types
import { Request } from 'express';

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    permissions: string[];
    isAdmin?: boolean;
    credentialType: 'jwt' | 'api_key';
  };
  context?: import('../services/dataLoaders').RequestContext;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface CacheConfig {
  ttl: number; // Time to live in seconds
  keyPrefix?: string;
}

export interface DatabaseConfig {
  url: string;
  serviceRoleKey: string;
}

// Re-export types from the main app
export interface User {
  id: string;
  name: string;
  username?: string; // Unique username (lowercase, alphanumeric + underscore, 3-20 chars)
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  avatarUrl?: string;
  points: number;
  badges: any[];
  stats: any;
  settings?: any;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  adminIds: string[];
  permissions: any;
  parentId?: string;
  isArchived: boolean;
  inviteId: string;
  createdAt?: string;
  unreadCount?: number;
  members?: User[];
  pendingMembers?: User[];
  memberEmails?: string[];
  invitedPhoneNumbers?: string[];
}

export interface Message {
  id: string;
  groupId?: string; // Optional for direct messages
  sender: User;
  senderId?: string; // For direct messages
  recipientId?: string; // For direct messages
  timestamp: Date | string;
  type: 'TEXT' | 'QUESTION';
  text?: string;
  questionStem?: string;
  explanation?: string;
  questionType?: string;
  options?: any[];
  correctAnswerIds?: string[];
  imageUrl?: string;
  tags?: string[];
  questionStatus?: string;
  acceptableAnswers?: string[];
  matchingPromptItems?: any[];
  matchingAnswerItems?: any[];
  correctMatches?: any[];
  diagramLabels?: any[];
  upvotes: number;
  downvotes: number;
  flaggedAsSimilarUserIds?: string[];
  replyToMessageId?: string;
  mentionedUserIds?: string[];
  replyTo?: {
    id: string;
    senderId?: string;
    senderName?: string;
    type?: string;
    text?: string;
    questionStem?: string;
  } | null;
  threadRootId?: string;
  replyCount?: number;
  receiptStatus?: 'sent' | 'read';
  seenByCount?: number;
  seenByTotal?: number;
}

export interface TestResult {
  session: {
    config: any;
    questions: any[];
    userAnswers: Record<string, any>;
    startTime: Date;
    endTime?: Date;
    isOffline?: boolean;
  };
  score: number;
  totalQuestions: number;
  correctAnswersCount: number;
}

export interface Notification {
  id: string;
  user_id: string;
  message: string;
  date: string;
  read: boolean;
  link?: string;
  type?: string;
  data?: Record<string, unknown>;
}
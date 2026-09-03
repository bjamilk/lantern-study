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
  // Academic identity (profiles.institution_id & friends)
  institutionId?: string | null;
  institution?: { id: string; name: string; slug: string } | null;
  faculty?: string | null;
  programme?: string | null;
  studyLevel?: number | null;
  /** 1 = first semester, 2 = second (20260830090000). */
  currentSemester?: 1 | 2 | null;
  entryYear?: number | null;
  expectedGraduationYear?: number | null;
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
  memberEmails?: string[];
  invitedPhoneNumbers?: string[];
  /** Course this group studies (academic archive). */
  courseId?: string | null;
  /**
   * Phase 3 L — discovery. A group is 'private' by default and invisible to
   * GET /groups/discover; widening it is an explicit, admin-only act.
   */
  visibility?: 'private' | 'community' | 'public';
  communityId?: string | null;
  /**
   * Which surface this group renders as inside its community
   * (20260903120000). NULL = legacy = board; 'study_group' is listed on the
   * community page but opens in Chat with the full study surface. Absent
   * (undefined) until the migration is applied. Irrelevant without a
   * communityId, and the community lounge is deliberately NOT marked — it is
   * derived from communities.lounge_group_id and stays a live chat.
   */
  communitySurface?: 'board' | 'study_group' | null;
  tags?: string[];
  memberCount?: number;
  questionCount?: number;
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
  editedAt?: string;
  removedAt?: string;
  isRemoved?: boolean;
  replyToMessageId?: string;
  mentionedUserIds?: string[];
  replyTo?: {
    id: string;
    senderId?: string;
    senderName?: string;
    type?: string;
    text?: string;
    questionStem?: string;
    isRemoved?: boolean;
  } | null;
  threadRootId?: string;
  replyCount?: number;
  receiptStatus?: 'sent' | 'read';
  seenByCount?: number;
  seenByTotal?: number;
  /** Board post title, <=120 chars (20260903120000). Absent pre-migration. */
  subject?: string | null;
  /** The board's server-side pin — one per group, enforced by a unique index. */
  pinnedAt?: string | null;
  pinnedBy?: string | null;
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
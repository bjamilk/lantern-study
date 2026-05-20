/**
 * API Service
 * Handles all HTTP requests to the backend API
 */
import { getAuthHeaders, API_BASE_URL } from './supabase';

// Helper function to fetch with timeout
const fetchWithTimeout = async (
  url: string, 
  options: RequestInit, 
  timeoutMs: number = 8000
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
};

// Generic API request handler
const apiRequest = async <T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<T> => {
  const headers = await getAuthHeaders();
  
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/api/v1${endpoint}`,
    {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    },
    timeoutMs
  );
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP error ${response.status}`);
  }
  
  const result = await response.json();
  return result.data;
};

// ========== DECK API ==========

export interface Deck {
  id: string;
  name: string;
  description?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  card_count?: number;
}

export const fetchDecks = async (userId: string): Promise<Deck[]> => {
  return apiRequest<Deck[]>(`/decks?userId=${encodeURIComponent(userId)}`);
};

export const createDeck = async (userId: string, data: { name: string; description?: string }): Promise<Deck> => {
  return apiRequest<Deck>('/decks', {
    method: 'POST',
    body: JSON.stringify({ ...data, userId }),
  });
};

export const updateDeck = async (deckId: string, updates: { name?: string; description?: string }): Promise<Deck> => {
  return apiRequest<Deck>(`/decks/${deckId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
};

export const deleteDeck = async (deckId: string): Promise<void> => {
  await apiRequest(`/decks/${deckId}`, { method: 'DELETE' });
};

export const resetDeckStatistics = async (deckId: string, userId: string): Promise<void> => {
  await apiRequest(`/decks/${deckId}/reset`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
};

export const exportDeck = async (deckId: string): Promise<any> => {
  return apiRequest<any>(`/decks/${deckId}/export`);
};

export const importDeck = async (importData: any, userId: string): Promise<{deck: Deck; flashcards: Flashcard[]}> => {
  return apiRequest<Deck>('/decks/import', {
    method: 'POST',
    body: JSON.stringify({ importData, userId }),
  });
};

// ========== FLASHCARD API ==========

export interface Flashcard {
  id: string;
  deck_id: string;
  type: 'BASIC' | 'CLOZE';
  front?: string;
  back?: string;
  cloze_text?: string;
  tags?: string[];
  srs_data?: {
    interval: number;
    ease_factor: number;
    next_review: string;
    repetitions: number;
  };
  created_at: string;
  updated_at: string;
}

export const fetchFlashcards = async (deckId?: string): Promise<Flashcard[]> => {
  let endpoint = '/flashcards';
  if (deckId) {
    // ask for many cards since UI isn't paginated
    endpoint = `/flashcards?deckId=${encodeURIComponent(deckId)}&limit=500`;
  }
  return apiRequest<Flashcard[]>(endpoint);
};

export const createFlashcard = async (userId: string, deckId: string, data: {
  type: 'BASIC' | 'CLOZE';
  front?: string;
  back?: string;
  clozeText?: string;
  tags?: string[];
}): Promise<Flashcard> => {
  return apiRequest<Flashcard>('/flashcards', {
    method: 'POST',
    body: JSON.stringify({ ...data, deckId, userId }),
  });
};

export const updateFlashcard = async (flashcardId: string, updates: {
  front?: string;
  back?: string;
  clozeText?: string;
  srsData?: any;
  tags?: string[];
}): Promise<Flashcard> => {
  return apiRequest<Flashcard>(`/flashcards/${flashcardId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
};

export const deleteFlashcard = async (flashcardId: string): Promise<void> => {
  await apiRequest(`/flashcards/${flashcardId}`, { method: 'DELETE' });
};

// ========== USER PROFILE API ==========

export interface UserProfile {
  id: string;
  name: string;
  avatar_url?: string;
  phone?: string;
  points: number;
  stats?: any;
  badges?: any[];
  settings?: any;
  created_at: string;
  updated_at: string;
}

export const fetchUserProfile = async (userId: string): Promise<UserProfile> => {
  return apiRequest<UserProfile>(`/users/${userId}`);
};

export const createUserProfile = async (data: {
  id: string;
  name: string;
  avatar_url?: string;
}): Promise<UserProfile> => {
  return apiRequest<UserProfile>('/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateUserProfile = async (userId: string, updates: Partial<UserProfile>): Promise<UserProfile> => {
  return apiRequest<UserProfile>(`/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
};

export const fetchUserSettings = async (userId: string): Promise<any> => {
  return apiRequest<any>(`/users/${userId}/settings`);
};

export const updateUserSettings = async (userId: string, settings: any): Promise<any> => {
  return apiRequest<any>(`/users/${userId}/settings`, {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
};

// ========== GROUPS API ==========

export interface Group {
  id: string;
  name: string;
  description?: string;
  avatar_url?: string;
  invite_id: string;
  admin_ids?: string[];
  permissions?: any;
  is_archived?: boolean;
  created_at: string;
  updated_at: string;
  member_count?: number;
  members?: any[];
}

export const fetchGroups = async (userId: string): Promise<Group[]> => {
  return apiRequest<Group[]>(`/groups?userId=${encodeURIComponent(userId)}`);
};

export const fetchGroup = async (groupId: string): Promise<Group> => {
  return apiRequest<Group>(`/groups/${groupId}`);
};

export const createGroup = async (data: {
  name: string;
  description?: string;
  avatar_url?: string;
  permissions?: any;
  invite_id: string;
  userId: string;
  memberIds: string[];
}): Promise<Group> => {
  return apiRequest<Group>('/groups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateGroup = async (groupId: string, updates: {
  name?: string;
  description?: string;
  avatarUrl?: string;
  isArchived?: boolean;
}): Promise<Group> => {
  return apiRequest<Group>(`/groups/${groupId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
};

export const deleteGroup = async (groupId: string): Promise<void> => {
  await apiRequest(`/groups/${groupId}`, { method: 'DELETE' });
};

export const fetchGroupMembers = async (groupId: string): Promise<any[]> => {
  return apiRequest<any[]>(`/groups/${groupId}/members`);
};

export const addGroupMember = async (groupId: string, userId: string): Promise<void> => {
  await apiRequest(`/groups/${groupId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
};

export const removeGroupMember = async (groupId: string, userId: string): Promise<void> => {
  await apiRequest(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
};

export const joinGroupByInvite = async (inviteId: string, userId: string): Promise<Group> => {
  return apiRequest<Group>('/groups/join', {
    method: 'POST',
    body: JSON.stringify({ inviteId, userId }),
  });
};

export const leaveGroup = async (groupId: string, userId: string): Promise<void> => {
  await apiRequest(`/groups/${groupId}/leave`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
};

// ========== MESSAGES API ==========

export interface Message {
  id: string;
  group_id: string;
  sender_id: string;
  sender?: any;
  content?: string;
  text?: string;
  type: 'TEXT' | 'QUESTION';
  question_type?: string;
  question_stem?: string;
  options?: any[];
  correct_answer_ids?: string[];
  explanation?: string;
  image_url?: string;
  tags?: string[];
  upvotes: number;
  downvotes: number;
  question_status?: string;
  created_at: string;
  updated_at: string;
}

export const fetchMessages = async (groupId: string, options?: { page?: number; limit?: number }): Promise<Message[]> => {
  const params = new URLSearchParams();
  if (options?.page) params.append('page', options.page.toString());
  if (options?.limit) params.append('limit', options.limit.toString());
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<Message[]>(`/messages/group/${groupId}${query}`);
};

export const sendMessage = async (groupId: string, userId: string, data: {
  content: string;
  type?: 'TEXT' | 'QUESTION';
  questionType?: string;
  questionStem?: string;
  options?: any[];
  correctAnswerIds?: string[];
  explanation?: string;
  tags?: string[];
  imageUrl?: string;
}): Promise<Message> => {
  return apiRequest<Message>(`/messages/group/${groupId}`, {
    method: 'POST',
    body: JSON.stringify({ ...data, userId }),
  });
};

export const updateMessage = async (messageId: string, updates: {
  flaggedUserIds?: string[];
}): Promise<Message> => {
  return apiRequest<Message>(`/messages/${messageId}/update`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
};

export const updateQuestionStatus = async (messageId: string, questionStatus: string): Promise<Message> => {
  return apiRequest<Message>(`/messages/${messageId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ questionStatus }),
  });
};

export const voteOnMessage = async (messageId: string, userId: string, voteType: 'up' | 'down'): Promise<any> => {
  return apiRequest<any>(`/messages/${messageId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ userId, voteType }),
  });
};

export const removeVote = async (messageId: string, userId: string): Promise<void> => {
  await apiRequest(`/messages/${messageId}/vote?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
};

export const fetchUserVotesForGroup = async (groupId: string, userId: string): Promise<Record<string, 'up' | 'down'>> => {
  return apiRequest<Record<string, 'up' | 'down'>>(`/messages/group/${groupId}/user-votes?userId=${encodeURIComponent(userId)}`);
};

// ========== DIRECT MESSAGES API ==========

export interface DirectMessage {
  id: string;
  thread_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export interface DMThread {
  id: string;
  participant_ids: string[];
  participants: Record<string, { name: string; avatar_url?: string }>;
  last_message?: string;
  last_message_timestamp?: string;
  unread_count?: number;
}

export const fetchDMThreads = async (userId: string): Promise<DMThread[]> => {
  return apiRequest<DMThread[]>(`/messages/dm/threads?userId=${encodeURIComponent(userId)}`);
};

export const fetchDirectMessages = async (userId: string, otherUserId: string, options?: { page?: number; limit?: number }): Promise<DirectMessage[]> => {
  const params = new URLSearchParams({ otherUserId });
  if (options?.page) params.append('page', options.page.toString());
  if (options?.limit) params.append('limit', options.limit.toString());
  return apiRequest<DirectMessage[]>(`/messages/user/${userId}?${params.toString()}`);
};

export const sendDirectMessage = async (senderId: string, recipientId: string, content: string): Promise<DirectMessage> => {
  return apiRequest<DirectMessage>(`/messages/user/${senderId}`, {
    method: 'POST',
    body: JSON.stringify({ content, recipientId }),
  });
};

export const markDMAsRead = async (threadId: string, userId: string): Promise<void> => {
  await apiRequest(`/messages/dm/${threadId}/read`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
};

// ========== TESTS API ==========

export interface TestSession {
  id: string;
  user_id: string;
  group_id: string;
  config: any;
  questions: any[];
  user_answers: Record<string, any>;
  status: 'in_progress' | 'completed' | 'abandoned';
  start_time: string;
  end_time?: string;
  score?: number;
  created_at: string;
}

export interface TestResult {
  session_id: string;
  score: number;
  correct_answers_count: number;
  total_questions: number;
}

export const fetchTests = async (userId: string, options?: { status?: string; groupId?: string }): Promise<TestSession[]> => {
  const params = new URLSearchParams({ userId });
  if (options?.status) params.append('status', options.status);
  if (options?.groupId) params.append('groupId', options.groupId);
  return apiRequest<TestSession[]>(`/tests?${params.toString()}`);
};

export const createTestSession = async (data: {
  userId: string;
  groupId: string;
  config: any;
  questions: any[];
  isOffline?: boolean;
}): Promise<TestSession> => {
  return apiRequest<TestSession>('/tests', {
    method: 'POST',
    body: JSON.stringify({
      config: data.config,
      questions: data.questions,
      user_answers: {},
      start_time: new Date().toISOString(),
      is_offline: data.isOffline || false,
      userId: data.userId,
    }),
  });
};

export const updateTestSession = async (sessionId: string, updates: {
  userAnswers?: Record<string, any>;
  endTime?: string;
  status?: string;
}, userId: string): Promise<TestSession> => {
  return apiRequest<TestSession>(`/tests/${sessionId}/submit`, {
    method: 'PUT',
    body: JSON.stringify({
      answers: updates.userAnswers ? Object.values(updates.userAnswers) : [],
      userId,
    }),
  });
};

export const submitTestResult = async (sessionId: string, result: {
  score: number;
  correctAnswersCount: number;
  totalQuestions: number;
}): Promise<TestResult> => {
  return apiRequest<TestResult>(`/tests/${sessionId}/results`, {
    method: 'POST',
    body: JSON.stringify(result),
  });
};

export const fetchTestResults = async (userId: string): Promise<TestSession[]> => {
  return apiRequest<TestSession[]>(`/tests?userId=${encodeURIComponent(userId)}&status=completed`);
};

export const saveTestResult = async (userId: string, data: {
  sessionId?: string;
  groupId?: string;
  config?: any;
  questions?: any[];
  userAnswers?: Record<string, any>;
  score: number;
  correctAnswersCount: number;
  totalQuestions: number;
  startTime?: string;
  endTime?: string;
}): Promise<TestSession> => {
  // If session exists, update it
  if (data.sessionId) {
    return apiRequest<TestSession>(`/tests/${data.sessionId}/submit`, {
      method: 'PUT',
      body: JSON.stringify({
        answers: data.userAnswers ? Object.values(data.userAnswers) : [],
        userId,
        score: data.score,
      }),
    });
  }
  
  // Otherwise create a new completed test session
  return apiRequest<TestSession>('/tests', {
    method: 'POST',
    body: JSON.stringify({
      config: data.config || {},
      questions: data.questions || [],
      user_answers: data.userAnswers || {},
      start_time: data.startTime || new Date().toISOString(),
      end_time: data.endTime || new Date().toISOString(),
      score: data.score,
      userId,
    }),
  });
};

// ========== USER QUESTION STATS API ==========

export interface UserQuestionStat {
  question_id: string;
  correct_count: number;
  incorrect_count: number;
  last_reviewed_at: string;
}

export const fetchUserQuestionStats = async (userId: string): Promise<UserQuestionStat[]> => {
  return apiRequest<UserQuestionStat[]>(`/user-stats/${encodeURIComponent(userId)}`);
};

export const upsertUserQuestionStat = async (userId: string, questionId: string, stat: {
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttempted: string;
}): Promise<void> => {
  await apiRequest('/user-stats', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      questionId,
      correctAttempts: stat.correctAttempts,
      incorrectAttempts: stat.incorrectAttempts,
      lastAttempted: stat.lastAttempted,
    }),
  });
};

// ========== NOTIFICATIONS API ==========

export interface Notification {
  id: string;
  user_id: string;
  message: string;
  type: string;
  link?: string;
  read: boolean;
  date: string;
  created_at: string;
}

export const fetchNotifications = async (userId: string): Promise<Notification[]> => {
  return apiRequest<Notification[]>(`/notifications?userId=${encodeURIComponent(userId)}`);
};

export const createNotification = async (data: {
  userId: string;
  message: string;
  type?: string;
  link?: string;
}): Promise<Notification> => {
  return apiRequest<Notification>('/notifications', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  await apiRequest(`/notifications/${notificationId}/read`, { method: 'PUT' });
};

export const markAllNotificationsAsRead = async (userId: string): Promise<number> => {
  const result = await apiRequest<{ updatedCount: number }>(`/notifications/read-all?userId=${encodeURIComponent(userId)}`, { method: 'PUT' });
  return result.updatedCount;
};

export const deleteNotification = async (notificationId: string, userId: string): Promise<void> => {
  await apiRequest(`/notifications/${notificationId}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
};

export const deleteAllNotifications = async (userId: string): Promise<number> => {
  const result = await apiRequest<{ deletedCount: number }>(`/notifications?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
  return result.deletedCount;
};

// ========== GAMIFICATION API ==========

export interface GamificationStats {
  cards_reviewed: number;
  streak_days: number;
  total_points: number;
  level: number;
  xp: number;
  xp_to_next_level: number;
}

export const fetchGamificationStats = async (userId: string): Promise<GamificationStats> => {
  return apiRequest<GamificationStats>(`/gamification/stats?userId=${encodeURIComponent(userId)}`);
};

export const awardPoints = async (userId: string, points: number, reason: string): Promise<void> => {
  await apiRequest('/gamification/points', {
    method: 'POST',
    body: JSON.stringify({ userId, points, reason }),
  });
};

export const checkBadges = async (userId: string): Promise<any[]> => {
  return apiRequest<any[]>(`/gamification/badges/check?userId=${encodeURIComponent(userId)}`);
};

// ========== MARKETPLACE API ==========

export interface MarketplaceListing {
  id: string;
  user_id: string;
  category: string;
  title: string;
  description?: string;
  price?: number;
  location?: string;
  images?: string[];
  status: 'active' | 'sold' | 'inactive';
  category_specific_fields?: any;
  views_count?: number;
  favorites_count?: number;
  inquiries_count?: number;
  created_at: string;
  updated_at: string;
  seller?: {
    id: string;
    name: string;
    avatar_url?: string;
  };
}

export interface MarketplaceFilters {
  page?: number;
  limit?: number;
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  location?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const fetchMarketplaceListings = async (filters: MarketplaceFilters = {}): Promise<MarketplaceListing[]> => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, value.toString());
    }
  });
  return apiRequest<MarketplaceListing[]>(`/marketplace/listings?${params.toString()}`, {}, 5000);
};

export const fetchMarketplaceListing = async (listingId: string): Promise<MarketplaceListing> => {
  return apiRequest<MarketplaceListing>(`/marketplace/listings/${listingId}`);
};

export const createMarketplaceListing = async (data: {
  category: string;
  title: string;
  description?: string;
  price?: number;
  location?: string;
  images?: string[];
  categorySpecificFields?: any;
}): Promise<MarketplaceListing> => {
  return apiRequest<MarketplaceListing>('/marketplace/listings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateMarketplaceListing = async (listingId: string, updates: Partial<MarketplaceListing>): Promise<MarketplaceListing> => {
  return apiRequest<MarketplaceListing>(`/marketplace/listings/${listingId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
};

export const deleteMarketplaceListing = async (listingId: string): Promise<void> => {
  await apiRequest(`/marketplace/listings/${listingId}`, { method: 'DELETE' });
};

export const updateListingStatus = async (listingId: string, status: 'active' | 'inactive' | 'sold'): Promise<MarketplaceListing> => {
  return apiRequest<MarketplaceListing>(`/marketplace/listings/${listingId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
};

// My Listings
export const fetchMyListings = async (status?: string): Promise<MarketplaceListing[]> => {
  const params = status ? `?status=${status}` : '';
  return apiRequest<MarketplaceListing[]>(`/marketplace/my-listings${params}`, {}, 5000);
};

// Seller Stats
export interface SellerStats {
  totalListings: number;
  activeListings: number;
  soldListings: number;
  totalViews: number;
  totalInquiries: number;
  totalFavorites: number;
}

export const fetchSellerStats = async (): Promise<SellerStats | null> => {
  try {
    return await apiRequest<SellerStats>('/marketplace/stats', {}, 5000);
  } catch {
    return null;
  }
};

// Favorites
export interface MarketplaceFavorite {
  id: string;
  user_id: string;
  listing_id: string;
  listing?: MarketplaceListing;
  created_at: string;
}

export const fetchMyFavorites = async (): Promise<MarketplaceFavorite[]> => {
  return apiRequest<MarketplaceFavorite[]>('/marketplace/favorites', {}, 5000);
};

export const addToFavorites = async (listingId: string): Promise<MarketplaceFavorite> => {
  return apiRequest<MarketplaceFavorite>('/marketplace/favorites', {
    method: 'POST',
    body: JSON.stringify({ listingId }),
  });
};

export const removeFromFavorites = async (listingId: string): Promise<void> => {
  await apiRequest(`/marketplace/favorites/${listingId}`, { method: 'DELETE' });
};

export const checkIfFavorited = async (listingId: string): Promise<boolean> => {
  try {
    const result = await apiRequest<{ isFavorited: boolean }>(`/marketplace/favorites/${listingId}/check`);
    return result.isFavorited;
  } catch {
    return false;
  }
};

// Inquiries
export interface MarketplaceInquiry {
  id: string;
  listing_id: string;
  dm_thread_id: string;
  buyer_id: string;
  seller_id: string;
  status: 'open' | 'negotiating' | 'closed' | 'purchased';
  initial_message: string;
  created_at: string;
  updated_at: string;
  listing?: MarketplaceListing;
  buyer?: any;
  seller?: any;
}

export const fetchMyInquiries = async (role: 'seller' | 'buyer' = 'seller', status?: string): Promise<MarketplaceInquiry[]> => {
  const params = new URLSearchParams({ role });
  if (status) params.append('status', status);
  return apiRequest<MarketplaceInquiry[]>(`/marketplace/inquiries?${params.toString()}`);
};

export const createInquiry = async (listingId: string, message: string): Promise<MarketplaceInquiry> => {
  return apiRequest<MarketplaceInquiry>('/marketplace/inquiries', {
    method: 'POST',
    body: JSON.stringify({ listingId, message }),
  });
};

export const updateInquiryStatus = async (inquiryId: string, status: 'open' | 'negotiating' | 'closed' | 'purchased'): Promise<MarketplaceInquiry> => {
  return apiRequest<MarketplaceInquiry>(`/marketplace/inquiries/${inquiryId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
};

// Reviews
export interface MarketplaceReview {
  id: string;
  listing_id: string;
  reviewer_id: string;
  rating: number;
  comment?: string;
  created_at: string;
}

export const addMarketplaceReview = async (listingId: string, review: { rating: number; comment?: string }): Promise<MarketplaceReview> => {
  return apiRequest<MarketplaceReview>(`/marketplace/listings/${listingId}/reviews`, {
    method: 'POST',
    body: JSON.stringify(review),
  });
};

// Reports
export const reportMarketplaceListing = async (listingId: string, report: { reason: string; details?: string }): Promise<void> => {
  await apiRequest(`/marketplace/listings/${listingId}/reports`, {
    method: 'POST',
    body: JSON.stringify(report),
  });
};

// ========== BUDGET API ==========

export interface BudgetData {
  monthly_limit: number;
  month_year: string;
}

export interface BudgetTransaction {
  id: string;
  user_id: string;
  type: 'income' | 'expense' | 'investment';
  amount: number;
  category?: string;
  description?: string;
  date: string;
}

export const fetchUserBudget = async (userId: string, monthYear?: string): Promise<BudgetData | null> => {
  const params = monthYear ? `?monthYear=${monthYear}` : '';
  try {
    return await apiRequest<BudgetData>(`/users/${userId}/budget${params}`);
  } catch {
    return null;
  }
};

export const saveUserBudget = async (userId: string, budget: { monthlyLimit: number; monthYear: string }): Promise<void> => {
  await apiRequest(`/users/${userId}/budget`, {
    method: 'PUT',
    body: JSON.stringify(budget),
  });
};

export const fetchBudgetTransactions = async (userId: string): Promise<BudgetTransaction[]> => {
  return apiRequest<BudgetTransaction[]>(`/users/${userId}/transactions`);
};

export const saveBudgetTransaction = async (userId: string, transaction: {
  id: string;
  type: string;
  amount: number;
  category?: string;
  description?: string;
  date: string;
}): Promise<void> => {
  await apiRequest(`/users/${userId}/transactions`, {
    method: 'POST',
    body: JSON.stringify(transaction),
  });
};

export const deleteBudgetTransaction = async (userId: string, transactionId: string): Promise<void> => {
  await apiRequest(`/users/${userId}/transactions/${transactionId}`, { method: 'DELETE' });
};

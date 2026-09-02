import {
  getApiBaseUrl,
  type ContentReportTargetSummary,
  type ContentReportTargetType,
  type ListingAppealStatus,
  type ListingRightsStatus,
  type ModerationStrike,
} from '@lantern/shared';
import { getAuthHeaders } from './supabase';

const API_BASE_URL = getApiBaseUrl();

async function adminRequest<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_BASE_URL}/api/v1/admin${endpoint}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Admin request failed' }));
    throw new Error(error.error || error.message || `Admin request failed (${response.status})`);
  }

  return response.json();
}

export interface AdminStats {
  /** False when the server has role management switched off; undefined until stats load. */
  roleManagementEnabled?: boolean;
  totalUsers: number;
  totalListings: number;
  activeListings: number;
  openReports: number;
  openDisputes?: number;
  aiEventsLast24h: number;
  newUsersToday: number;
  aiEventsLast7d: number;
  reportsResolved7d: number;
  estimatedAiCost7d: number;
  aiTokens7d?: number;
  aiEventEstimatedCostUsd: number;
  activeGroups?: number;
  messagesLast24h?: number;
  totalDecks?: number;
  offlineBundles?: number;
  activeUsers7d?: number;
}

export interface AdminUser {
  id: string;
  name?: string;
  username?: string;
  email?: string;
  points?: number;
  created_at: string;
  is_banned?: boolean;
  is_platform_admin?: boolean;
}

export interface AdminListing {
  id: string;
  title: string;
  price: number;
  category: string;
  status: string;
  created_at: string;
  views_count?: number;
  user_id: string;
  seller?: { id: string; name?: string };
}

export interface AdminMarketplaceOrder {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount: number;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
  listing?: { id: string; title: string; status: string; price?: number };
  buyer?: { id: string; name?: string; avatar_url?: string };
  seller?: { id: string; name?: string; avatar_url?: string };
  transaction?: { id: string; status: string; amount?: number };
}

/**
 * GET /admin/reports row (content_reports, Phase 1 · E). `target` is the
 * per-type summary the API resolves; listing targets also keep the legacy
 * `listing` / `listing_id` aliases so older rows keep rendering.
 */
export interface AdminReport {
  id: string;
  listing_id?: string | null;
  reporter_id: string;
  target_type?: ContentReportTargetType;
  target_id?: string;
  reason: string;
  details?: string | null;
  status: string;
  created_at: string;
  admin_note?: string | null;
  resolved_at?: string | null;
  legacy_source?: string | null;
  listing?: { id: string; title: string; status: string; user_id?: string } | null;
  reporter?: { id: string; name?: string | null; username?: string | null } | null;
  target?: ContentReportTargetSummary;
}

export type AdminReportAction = 'dismiss' | 'under_review' | 'warn' | 'remove_content' | 'strike';
/** Pre-E action names the console used; the API still maps them. */
export type LegacyAdminReportAction = 'remove_listing' | 'warn_seller';

export interface AdminAppeal {
  id: string;
  title: string;
  status: string;
  user_id: string;
  rights_status?: ListingRightsStatus;
  takedown_reason?: string | null;
  takedown_at?: string | null;
  appeal_status: ListingAppealStatus;
  appeal_note?: string | null;
  appealed_at?: string | null;
  seller?: { id: string; name?: string | null; username?: string | null } | null;
}

export interface AdminPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface AdminAIUserUsage {
  user_id: string;
  name?: string;
  username?: string;
  email?: string;
  events: number;
}

export interface AdminActivityItem {
  id: string;
  type: 'user_joined' | 'report_created' | 'listing_created' | 'ai_event';
  title: string;
  description: string;
  created_at: string;
  user_id?: string;
}

export interface AdminAnalyticsDay {
  date: string;
  signups: number;
  activeUsers: number;
  tests: number;
  flashcards: number;
  newFlashcards: number;
  questions: number;
  games: number;
  dailyQuizzes: number;
  groupMessages: number;
  dmMessages: number;
  aiEvents: number;
  newListings: number;
  orders: number;
  gmv?: number;
}

export interface AdminAnalytics {
  periodDays: number;
  kpis: {
    totalUsers: number;
    dau: number;
    wau: number;
    mau: number;
    mobileAppUsers: number;
    webOnlyUsers: number;
    activeGroups: number;
  };
  marketplaceKpis?: {
    gmv: number;
    ordersCount: number;
    aov: number;
    disputedRate: number;
    disputedCount: number;
    gmvByCategory: Array<{ category: string; gmv: number; orders: number }>;
    gmvByCampus: Array<{ campus: string; gmv: number; orders: number }>;
    gmvByZone?: Array<{ zone: string; gmv: number; orders: number }>;
    listingsByZone?: Array<{ zone: string; total: number; active: number; sold: number }>;
  };
  retentionCohorts?: {
    signups: number;
    d1: number;
    d7: number;
    d30: number;
    d1Count: number;
    d7Count: number;
    d30Count: number;
  };
  searchAnalytics?: {
    topQueries: Array<{ query: string; count: number }>;
    zeroResultQueries: Array<{ query: string; count: number }>;
    searchesByCampus: Array<{ campus: string; count: number }>;
    searchesByZone?: Array<{ zone: string; count: number }>;
    totalSearches: number;
  };
  acquisitionFunnel?: {
    guestListingViews: number;
    signupStarted: number;
    signupsCompleted: number;
    onboardingCompleted: number;
  };
  studyFunnel?: {
    testsStarted: number;
    testsCompleted: number;
    testsCompletedWeb: number;
    testsCompletedMobile: number;
    flashcardSessionsStarted: number;
    flashcardSessionsCompleted: number;
    notesCreated: number;
    aiToolUses: number;
    aiToolsByType: Record<string, number>;
  };
  platformFromEvents?: {
    webDau: number;
    mobileDau: number;
    webActivePeriod: number;
    mobileActivePeriod: number;
  };
  streakDistribution: Record<string, number>;
  featureTotals: {
    tests: number;
    flashcards: number;
    newFlashcards: number;
    questions: number;
    games: number;
    dailyQuizzes: number;
    studyActions: number;
  };
  aiByFeature: Record<string, number>;
  platformSplit: {
    mobileAppUsers: number;
    webOnlyUsers: number;
  };
  series: AdminAnalyticsDay[];
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const response = await adminRequest<{ success: boolean; data: AdminStats }>('/stats');
  return response.data;
}

export async function fetchAdminAnalytics(days: 7 | 30 | 90 = 30): Promise<AdminAnalytics> {
  const response = await adminRequest<{ success: boolean; data: AdminAnalytics }>(
    `/analytics?days=${encodeURIComponent(String(days))}`
  );
  return response.data;
}

export async function fetchAdminUsers(params?: { search?: string; page?: number; limit?: number }): Promise<{
  data: AdminUser[];
  pagination?: AdminPagination;
}> {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const response = await adminRequest<{
    success: boolean;
    data: AdminUser[];
    pagination?: AdminPagination;
  }>(`/users${query.toString() ? `?${query}` : ''}`);

  return { data: response.data || [], pagination: response.pagination };
}

/**
 * PATCH /admin/users/:id/status. 'suspended' needs `until` (ISO, ≤ 365 days
 * ahead) and sets settings.suspended_until; 'active' clears BOTH the ban and
 * any suspension.
 */
export async function updateAdminUserStatus(
  userId: string,
  status: 'active' | 'banned' | 'suspended',
  reason?: string,
  until?: string
): Promise<void> {
  await adminRequest(`/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason, ...(until ? { until } : {}) }),
  });
}

/** POST /admin/users/:id/strikes — hand-issued strike (3 active → 14-day auto-suspension). */
export async function addAdminStrike(
  userId: string,
  body: { reason: string; severity?: 1 | 2 | 3; reportId?: string }
): Promise<{ strike: ModerationStrike; activeStrikes: number; suspendedUntil: string | null }> {
  const response = await adminRequest<{
    success: boolean;
    data: { strike: ModerationStrike; activeStrikes: number; suspendedUntil: string | null };
  }>(`/users/${userId}/strikes`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.data;
}

export async function updateAdminUserRole(
  userId: string,
  isPlatformAdmin: boolean,
  confirmationPhrase = 'CONFIRM_ADMIN_ROLE_CHANGE'
): Promise<void> {
  await adminRequest(`/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ isPlatformAdmin, confirmationPhrase }),
  });
}

export async function fetchAdminMarketplaceListings(params?: { status?: string; page?: number; limit?: number }): Promise<{
  data: AdminListing[];
  pagination?: AdminPagination;
}> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const response = await adminRequest<{
    success: boolean;
    data: AdminListing[];
    pagination?: AdminPagination;
  }>(`/marketplace/listings${query.toString() ? `?${query}` : ''}`);

  return { data: response.data || [], pagination: response.pagination };
}

export async function removeAdminMarketplaceListing(listingId: string): Promise<void> {
  await adminRequest(`/marketplace/listings/${listingId}`, { method: 'DELETE' });
}

export async function updateAdminMarketplaceListingStatus(
  listingId: string,
  status: 'active' | 'suspended_by_admin'
): Promise<void> {
  await adminRequest(`/marketplace/listings/${listingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function fetchAdminMarketplaceOrders(params?: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{
  data: AdminMarketplaceOrder[];
  pagination?: AdminPagination;
}> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const response = await adminRequest<{
    success: boolean;
    data: AdminMarketplaceOrder[];
    pagination?: AdminPagination;
  }>(`/marketplace/orders${query.toString() ? `?${query}` : ''}`);

  return { data: response.data || [], pagination: response.pagination };
}

export async function resolveAdminMarketplaceDispute(
  orderId: string,
  resolution: 'release_to_seller' | 'refund_buyer',
  note?: string
): Promise<AdminMarketplaceOrder> {
  const response = await adminRequest<{ success: boolean; data: AdminMarketplaceOrder }>(
    `/marketplace/orders/${orderId}/dispute`,
    {
      method: 'PATCH',
      body: JSON.stringify({ resolution, note }),
    }
  );
  return response.data;
}

export async function fetchAdminReports(params?: {
  status?: string;
  targetType?: ContentReportTargetType | string;
  page?: number;
  limit?: number;
}): Promise<{
  data: AdminReport[];
  pagination?: AdminPagination;
}> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.targetType) query.set('targetType', params.targetType);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const response = await adminRequest<{
    success: boolean;
    data: AdminReport[];
    pagination?: AdminPagination;
  }>(`/reports${query.toString() ? `?${query}` : ''}`);

  return { data: response.data || [], pagination: response.pagination };
}

/**
 * PUT /admin/reports/:id. `strike` takes an optional severity (1–3, default 1);
 * `remove_content` only works for listing / question_bank / note / deck / group
 * targets (the API answers 400 "use the dedicated tool" otherwise).
 */
export async function resolveAdminReport(
  reportId: string,
  action: AdminReportAction | LegacyAdminReportAction,
  note?: string,
  severity?: 1 | 2 | 3
): Promise<{ action: string; status: string; strike?: ModerationStrike | null; suspendedUntil?: string | null } | undefined> {
  const response = await adminRequest<{
    success: boolean;
    data?: { action: string; status: string; strike?: ModerationStrike | null; suspendedUntil?: string | null };
  }>(`/reports/${reportId}`, {
    method: 'PUT',
    body: JSON.stringify({ action, note, ...(severity ? { severity } : {}) }),
  });
  return response?.data;
}

/** GET /admin/appeals — listings whose seller appealed a takedown. */
export async function fetchAdminAppeals(): Promise<AdminAppeal[]> {
  const response = await adminRequest<{ success: boolean; data: AdminAppeal[] }>('/appeals');
  return response.data || [];
}

/** PUT /admin/marketplace/listings/:id/appeal — reversed restores the listing; upheld keeps it down. */
export async function decideListingAppeal(
  listingId: string,
  decision: 'upheld' | 'reversed',
  note?: string
): Promise<{ id: string; status: string; appeal_status: ListingAppealStatus } | undefined> {
  const response = await adminRequest<{
    success: boolean;
    data?: { id: string; status: string; appeal_status: ListingAppealStatus };
  }>(`/marketplace/listings/${encodeURIComponent(listingId)}/appeal`, {
    method: 'PUT',
    body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
  });
  return response?.data;
}

export async function fetchAdminAIAnalytics(days = 7): Promise<{
  totalEvents: number;
  byEvent: Record<string, number>;
  byDay: Record<string, number>;
  periodDays: number;
}> {
  const response = await adminRequest<{
    success: boolean;
    data: {
      totalEvents: number;
      byEvent: Record<string, number>;
      byDay: Record<string, number>;
      periodDays: number;
    };
  }>(`/ai-analytics?days=${encodeURIComponent(String(days))}`);

  return response.data;
}

export interface AdminAITokens {
  periodDays: number;
  totalTokens: number;
  paidCalls: number;
  cacheServed: number;
  byFeature: Record<string, { tokens: number; calls: number; cacheServed: number }>;
  byDay: Record<string, { tokens: number; calls: number }>;
  byProvider: Record<string, { tokens: number; calls: number }>;
  providersToday: Array<{
    name: string;
    calls: number;
    promptTokens: number;
    cachedTokens: number;
    completionTokens: number;
  }>;
  truncated: boolean;
}

export async function fetchAdminAITokens(days = 7): Promise<AdminAITokens> {
  const response = await adminRequest<{ success: boolean; data: AdminAITokens }>(
    `/ai-tokens?days=${encodeURIComponent(String(days))}`
  );
  return response.data;
}

export interface AdminProviderProbe {
  provider: string;
  configured: boolean;
  ok: boolean;
  latencyMs: number;
  model?: string;
  reply?: string;
  usage?: { promptTokens: number; completionTokens: number; cachedTokens: number };
  error?: string;
}

/**
 * Send one real request to a single AI provider. Fireworks is the standby
 * behind Groq, so it never runs in normal traffic — this is the only way to
 * confirm its key works without waiting for Groq to fail.
 */
export async function probeAdminAiProvider(provider: string): Promise<AdminProviderProbe> {
  const response = await adminRequest<{ success: boolean; data: AdminProviderProbe }>(
    `/ai/provider-probe?provider=${encodeURIComponent(provider)}`
  );
  return response.data;
}

export interface AdminProductEvents {
  periodDays: number;
  totalEvents: number;
  uniqueUsers: number;
  byEvent: Record<string, { total: number; web: number; mobile: number }>;
  byDay: Record<string, number>;
  truncated: boolean;
}

export async function fetchAdminProductEvents(days = 7): Promise<AdminProductEvents> {
  const response = await adminRequest<{ success: boolean; data: AdminProductEvents }>(
    `/events?days=${encodeURIComponent(String(days))}`
  );
  return response.data;
}

export async function fetchAdminAIUserUsage(days = 7, limit = 10): Promise<{
  periodDays: number;
  users: AdminAIUserUsage[];
}> {
  const response = await adminRequest<{
    success: boolean;
    data: {
      periodDays: number;
      users: AdminAIUserUsage[];
    };
  }>(`/ai-analytics/users?days=${encodeURIComponent(String(days))}&limit=${encodeURIComponent(String(limit))}`);

  return response.data;
}

export async function fetchAdminActivity(limit = 10): Promise<AdminActivityItem[]> {
  const response = await adminRequest<{ success: boolean; data: AdminActivityItem[] }>(
    `/activity?limit=${encodeURIComponent(String(limit))}`
  );

  return response.data || [];
}

export interface AdminAuditEntry {
  id: string;
  actor_id: string;
  action: string;
  target_type: string;
  target_id?: string;
  metadata?: Record<string, unknown>;
  reason?: string;
  created_at: string;
  actor?: { id: string; name?: string; username?: string };
}

export interface AdminUserDetail {
  id: string;
  name?: string;
  username?: string;
  email?: string;
  points?: number;
  badges?: unknown[];
  stats?: Record<string, unknown>;
  created_at: string;
  is_banned?: boolean;
  is_platform_admin?: boolean;
  /** settings.suspended_until when it lies in the future; null otherwise. */
  suspended_until?: string | null;
  /** Unexpired moderation strikes (3 → automatic 14-day suspension). */
  active_strikes?: number;
  counts?: { groups: number; listings: number; decks: number; aiEvents7d: number };
  aiQuota?: Array<{ feature: string; used: number; limit: number; resetsAt: string }>;
}

export interface AdminGroup {
  id: string;
  name: string;
  description?: string;
  is_archived: boolean;
  created_at: string;
  last_message_time?: string;
}

export interface AdminMessage {
  id: string;
  group_id: string;
  sender_id: string;
  text?: string;
  timestamp: string;
  type: string;
  sender?: { id: string; name?: string; username?: string };
}

export interface AdminDeck {
  id: string;
  name: string;
  description?: string;
  user_id: string;
  created_at: string;
  card_count?: number;
  owner?: { id: string; name?: string; username?: string };
}

export interface AdminOfflineBundle {
  id: string;
  user_id: string;
  display_name?: string;
  /** NOT NULL in the schema — the fallback name when display_name is absent. */
  group_name?: string;
  updated_at?: string;
  created_at: string;
  owner?: { id: string; name?: string; username?: string };
}

export interface AdminCompanionMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export async function fetchAdminAudit(limit = 30): Promise<AdminAuditEntry[]> {
  const response = await adminRequest<{ success: boolean; data: AdminAuditEntry[] }>(
    `/audit?limit=${encodeURIComponent(String(limit))}`
  );
  return response.data || [];
}

export async function fetchAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  const response = await adminRequest<{ success: boolean; data: AdminUserDetail }>(`/users/${userId}`);
  return response.data;
}

export async function sendAdminNotification(params: {
  userId: string;
  message: string;
  link?: string;
  type?: string;
}): Promise<void> {
  await adminRequest('/notifications', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** Returns the number of notifications the server actually inserted, which
 *  can be lower than userIds.length on a partial failure. */
export async function sendAdminBulkNotifications(params: {
  userIds: string[];
  message: string;
  link?: string;
  type?: string;
}): Promise<number> {
  const response = await adminRequest<{ success: boolean; count?: number }>('/notifications/bulk', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return response.count ?? 0;
}

export async function awardAdminPoints(userId: string, points: number, reason?: string): Promise<void> {
  await adminRequest(`/users/${userId}/points`, {
    method: 'POST',
    body: JSON.stringify({ points, reason }),
  });
}

export async function awardAdminBadge(userId: string, badgeId: string): Promise<void> {
  await adminRequest(`/users/${userId}/badge`, {
    method: 'POST',
    body: JSON.stringify({ badgeId }),
  });
}

export async function fetchAdminGroups(params?: { search?: string; page?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const response = await adminRequest<{ success: boolean; data: AdminGroup[]; pagination?: AdminPagination }>(
    `/groups${query.toString() ? `?${query}` : ''}`
  );
  return { data: response.data || [], pagination: response.pagination };
}

export async function updateAdminGroup(id: string, isArchived: boolean, reason?: string): Promise<void> {
  await adminRequest(`/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isArchived, reason }),
  });
}

export async function fetchAdminMessages(params?: { groupId?: string; page?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.groupId) query.set('groupId', params.groupId);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const response = await adminRequest<{ success: boolean; data: AdminMessage[]; pagination?: AdminPagination }>(
    `/messages${query.toString() ? `?${query}` : ''}`
  );
  return { data: response.data || [], pagination: response.pagination };
}

export async function deleteAdminMessage(messageId: string, reason?: string): Promise<void> {
  await adminRequest(`/messages/${messageId}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
}

export async function fetchAdminDecks(params?: { search?: string; page?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.search) query.set('search', params.search);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const response = await adminRequest<{ success: boolean; data: AdminDeck[]; pagination?: AdminPagination }>(
    `/decks${query.toString() ? `?${query}` : ''}`
  );
  return { data: response.data || [], pagination: response.pagination };
}

export async function removeAdminDeck(deckId: string, reason?: string): Promise<void> {
  await adminRequest(`/decks/${deckId}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
}

export async function fetchAdminOfflineSummary(): Promise<{
  data: AdminOfflineBundle[];
  pagination?: AdminPagination;
}> {
  const response = await adminRequest<{
    success: boolean;
    data: AdminOfflineBundle[];
    pagination?: AdminPagination;
  }>('/offline/summary');
  return { data: response.data || [], pagination: response.pagination };
}

export async function resetAdminAIQuota(userId: string, feature?: string): Promise<void> {
  await adminRequest('/ai/quota/reset', {
    method: 'POST',
    body: JSON.stringify({ userId, feature }),
  });
}

export async function fetchAdminCompanionMessages(userId: string, limit = 20): Promise<AdminCompanionMessage[]> {
  const response = await adminRequest<{ success: boolean; data: AdminCompanionMessage[] }>(
    `/ai/companion/${userId}?limit=${encodeURIComponent(String(limit))}`
  );
  return response.data || [];
}

export async function fetchAdminAIQuota(userId: string) {
  const response = await adminRequest<{
    success: boolean;
    data: { userId: string; quotas: Array<{ feature: string; used: number; limit: number; resetsAt: string }> };
  }>(`/ai/quota/${userId}`);
  return response.data;
}

export async function fetchAdminJobPostings(params?: { status?: string; page?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const response = await adminRequest<{ success: boolean; data: any[]; pagination?: AdminPagination }>(
    `/jobs/postings${query.toString() ? `?${query}` : ''}`
  );
  return { data: response.data || [], pagination: response.pagination };
}

export async function updateAdminJobPostingStatus(id: string, status: string) {
  await adminRequest(`/jobs/postings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function removeAdminJobPosting(id: string) {
  await adminRequest(`/jobs/postings/${id}`, { method: 'DELETE' });
}

export async function fetchAdminJobCompanies(params?: { status?: string; page?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  const response = await adminRequest<{ success: boolean; data: any[]; pagination?: AdminPagination }>(
    `/jobs/companies${query.toString() ? `?${query}` : ''}`
  );
  return { data: response.data || [], pagination: response.pagination };
}

export async function setAdminJobCompanyVerification(
  id: string,
  status: 'verified' | 'rejected' | 'pending' | 'unverified',
  note?: string
) {
  await adminRequest(`/jobs/companies/${id}/verification`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note }),
  });
}

export async function fetchAdminJobReports(status = 'pending') {
  const response = await adminRequest<{ success: boolean; data: any[] }>(
    `/jobs/reports?status=${encodeURIComponent(status)}`
  );
  return { data: response.data || [] };
}

export async function resolveAdminJobReport(id: string, status: 'resolved' | 'dismissed') {
  await adminRequest(`/jobs/reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function schoolApproveAdminJobPosting(id: string, approve = true) {
  await adminRequest(`/jobs/postings/${id}/school-approval`, {
    method: 'PATCH',
    body: JSON.stringify({ approve }),
  });
}

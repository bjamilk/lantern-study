import { createClient } from '@supabase/supabase-js';
import { DatabaseConfig, User, Group, Message, TestResult, Notification } from '../types';
import { cacheService } from './cache';
import { logger } from '../utils/logger';
import {
  buildMarketplaceBudgetTxIds,
  buildManualSaleBudgetTxId,
  buildMarketplacePurchaseDescription,
  buildMarketplaceSaleDescription,
  MARKETPLACE_BUDGET_CATEGORIES,
  MARKETPLACE_BUDGET_TYPES,
} from '@lantern/shared/utils/server';
import { checkAndAwardBadges, initialUserStats } from '@lantern/shared/utils/testHelpers';
import { computeStudyStreak } from '@lantern/shared/utils/activity';

type UserStats = typeof initialUserStats;

export class SupabaseService {
  private supabase;
  private supabaseUrl: string;
  private static readonly DEFAULT_GROUP_PAGE_SIZE = 20;
  private static readonly MAX_GROUP_PAGE_SIZE = 50;
  private static readonly DEFAULT_DECK_PAGE_SIZE = 20;
  private static readonly MAX_DECK_PAGE_SIZE = 50;
  private static readonly DEFAULT_FLASHCARD_PAGE_SIZE = 50;
  private static readonly MAX_FLASHCARD_PAGE_SIZE = 100;
  private static readonly DEFAULT_MESSAGE_PAGE_SIZE = 50;
  private static readonly MAX_MESSAGE_PAGE_SIZE = 100;

  private getResponseProfile(profile?: string): 'compact' | 'full' {
    return profile === 'compact' ? 'compact' : 'full';
  }

  /** Rewrite legacy localhost:54321 storage URLs to the configured Supabase URL. */
  private normalizeStorageUrl(url: string): string {
    if (!url) return url;
    const base = this.supabaseUrl.replace(/\/$/, '');
    return url.replace(/https?:\/\/(localhost|127\.0\.0\.1):54321/gi, base);
  }

  private normalizeListingRecord(listing: any): any {
    if (!listing) return listing;
    const salePrice = listing.sale_price != null ? Number(listing.sale_price) : null;
    const onSale =
      salePrice != null &&
      !!listing.sale_ends_at &&
      new Date(listing.sale_ends_at) > new Date();
    const base = !Array.isArray(listing.images)
      ? listing
      : {
          ...listing,
          images: listing.images.map((url: string) => this.normalizeStorageUrl(url)),
        };
    return {
      ...base,
      effective_price: onSale ? salePrice : Number(listing.price) || 0,
      is_on_sale: onSale,
    };
  }

  private normalizeInquiryRecord(inquiry: any): any {
    if (!inquiry) return inquiry;
    return {
      ...inquiry,
      listing: inquiry.listing ? this.normalizeListingRecord(inquiry.listing) : inquiry.listing,
    };
  }

  private normalizeFavoriteRecord(favorite: any): any {
    if (!favorite) return favorite;
    return {
      ...favorite,
      listing: favorite.listing ? this.normalizeListingRecord(favorite.listing) : favorite.listing,
    };
  }

  private normalizeOfferRecord(offer: any): any {
    if (!offer) return offer;
    return {
      ...offer,
      listing: offer.listing ? this.normalizeListingRecord(offer.listing) : offer.listing,
    };
  }

  private normalizeMessageRecord(msg: any): Partial<Message> & { type: 'TEXT' | 'QUESTION' } {
    const parsed = this.parseMessageContent(msg);
    const imageUrl = msg.image_url || parsed.imageUrl;
    const type = (parsed.type || msg.type || 'TEXT') as 'TEXT' | 'QUESTION';
    return {
      ...parsed,
      type,
      ...(imageUrl ? { imageUrl: this.normalizeStorageUrl(imageUrl) } : {}),
    };
  }

  constructor(config: DatabaseConfig) {
    this.supabaseUrl = config.url;
    this.supabase = createClient(config.url, config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  // Get the raw Supabase client for direct operations (RPC calls, etc.)
  getClient() {
    return this.supabase;
  }

  // User/Profile Functions
  async fetchUserProfile(userId: string): Promise<User | null> {
    const cacheKey = `user:${userId}:profile`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;
      return data;
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async updateUserProfile(userId: string, updates: Partial<User>): Promise<User> {
    const { data, error } = await this.supabase
      .from('profiles')
      .update({
        name: updates.name,
        avatar_url: updates.avatarUrl,
        phone: updates.phoneNumber,
        points: updates.points,
        stats: updates.stats,
        badges: updates.badges,
        settings: updates.settings,
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Invalidate cache
    await cacheService.invalidateUserCache(userId);

    return data;
  }

  async updateExpoPushToken(userId: string, token: string): Promise<void> {
    const { error } = await this.supabase
      .from('profiles')
      .update({ expo_push_token: token })
      .eq('id', userId);

    if (error) throw error;
    await cacheService.invalidateUserCache(userId);
  }

  async clearExpoPushToken(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('profiles')
      .update({ expo_push_token: null })
      .eq('id', userId);

    if (error) throw error;
    await cacheService.invalidateUserCache(userId);
  }

  private async sendExpoPushForNotification(
    userId: string,
    notification: { message: string; type?: string; link?: string; data?: Record<string, unknown> }
  ): Promise<void> {
    const pushTypes = new Set([
      'challenge_invite',
      'challenge_accepted',
      'challenge_result',
      'challenge_opponent_finished',
      'marketplace_inquiry',
      'marketplace_purchase',
      'marketplace_order_update',
      'marketplace_review_prompt',
      'saved_search_match',
      'group_invite',
      'badge_unlock',
      'test_result',
      'srs_reminder',
    ]);
    if (notification.type && !pushTypes.has(notification.type)) return;

    try {
      const { data: profile, error } = await this.supabase
        .from('profiles')
        .select('expo_push_token, settings')
        .eq('id', userId)
        .single();

      if (error || !profile?.expo_push_token) return;

      const { shouldSendExpoPush } = await import('../utils/userSettingsPolicy');
      if (!shouldSendExpoPush(profile.settings, notification.type)) return;

      const token = profile.expo_push_token as string;
      if (!token.startsWith('ExponentPushToken')) return;

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: token,
          title: 'Lantern Study',
          body: notification.message,
          data: {
            type: notification.type,
            link: notification.link,
            ...(notification.data || {}),
          },
          sound: 'default',
        }),
      });
    } catch (err) {
      logger.warn('Expo push notification failed', { userId, err });
    }
  }

  async createUserProfile(profile: Partial<User>): Promise<User> {
    const { data, error } = await this.supabase
      .from('profiles')
      .insert({
        id: profile.id,
        name: profile.name,
        avatar_url: profile.avatarUrl,
        phone: profile.phoneNumber,
        points: profile.points || 0,
        stats: profile.stats || {},
        badges: profile.badges || [],
        settings: profile.settings || {},
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // New User Methods for API Routes
  async getUsers(options: { page?: number; limit?: number; search?: string } = {}): Promise<User[]> {
    const { page = 1, limit = 20, search } = options;
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from('profiles')
      .select('*')
      .range(offset, offset + limit - 1);

    if (search) {
      // Search by name, email, or username
      const escaped = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;
      query = query.or(`name.ilike.${pattern},email.ilike.${pattern},username.ilike.${pattern}`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return data || [];
  }

  async getUserById(userId: string): Promise<User | null> {
    const cacheKey = `user:${userId}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      return data;
    }, { ttl: 600 }); // Cache for 10 minutes
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    return data;
  }

  /** Resolve a UUID, @username, email, or display name to a profile id. */
  async resolveCollaboratorUserId(identifier: string): Promise<string> {
    const trimmed = identifier.trim();
    if (!trimmed) {
      throw new Error('Enter a username, email, or user ID.');
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(trimmed)) {
      const user = await this.getUserById(trimmed);
      if (!user) throw new Error('No user found with that ID.');
      return user.id;
    }

    if (trimmed.includes('@') && trimmed.includes('.')) {
      const user = await this.getUserByEmail(trimmed);
      if (!user) throw new Error('No user found with that email.');
      return user.id;
    }

    const username = trimmed.replace(/^@/, '').toLowerCase();
    const { data: byUsername, error: usernameError } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (usernameError) throw usernameError;
    if (byUsername?.id) return byUsername.id;

    const matches = await this.getUsers({ search: trimmed, limit: 5 });
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      throw new Error('Multiple users match. Use @username or email instead.');
    }

    throw new Error('No user found. Try @username or their email address.');
  }

  async createUser(userData: Partial<User>): Promise<User> {
    const insertData: Record<string, unknown> = {
      id: userData.id,
      name: userData.name,
      avatar_url: userData.avatarUrl,
      phone: userData.phoneNumber,
      points: userData.points || 0,
      stats: userData.stats || {},
      badges: userData.badges || [],
      settings: userData.settings || {},
    };

    if (userData.email) {
      insertData.email = userData.email;
    }

    const { data, error } = await this.supabase
      .from('profiles')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async updateUser(userId: string, updates: Partial<User> & { avatar_url?: string; phone?: string; test_presets?: any[] }): Promise<User | null> {
    // Build update object, handling both camelCase and snake_case keys
    const updateData: any = {};
    
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.avatarUrl !== undefined) updateData.avatar_url = updates.avatarUrl;
    if (updates.avatar_url !== undefined) updateData.avatar_url = updates.avatar_url;
    if (updates.phoneNumber !== undefined) updateData.phone = updates.phoneNumber;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.points !== undefined) updateData.points = updates.points;
    if (updates.stats !== undefined) updateData.stats = updates.stats;
    if (updates.badges !== undefined) updateData.badges = updates.badges;
    if (updates.settings !== undefined) updateData.settings = updates.settings;
    if (updates.test_presets !== undefined) updateData.settings = { ...(updateData.settings || {}), test_presets: updates.test_presets };

    const { data, error } = await this.supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    // Invalidate cache
    await cacheService.invalidateUserCache(userId);

    return data;
  }

  async deleteUser(userId: string): Promise<boolean> {
    const { deleteUserAccountFully } = await import('./userDataLifecycle');
    return deleteUserAccountFully(this, userId);
  }

  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const { exportUserDataArchive } = await import('./userDataLifecycle');
    return exportUserDataArchive(this, userId);
  }

  /** @deprecated use deleteUser — kept for internal reference */
  async deleteUserProfileOnly(userId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) throw error;

    // Invalidate cache
    await cacheService.invalidateUserCache(userId);

    return true;
  }

  async getUserStats(userId: string): Promise<any> {
    const cacheKey = `user:stats:${userId}`;

    return cacheService.cached(cacheKey, async () => {
      // Get user profile for basic stats
      const user = await this.getUserById(userId);
      if (!user) return null;

      // Get additional stats from related tables
      const { data: groupCount, error: groupError } = await this.supabase
        .from('group_members')
        .select('group_id', { count: 'exact' })
        .eq('user_id', userId);

      const { data: messageCount, error: messageError } = await this.supabase
        .from('messages')
        .select('id', { count: 'exact' })
        .eq('sender_id', userId);

      const { data: testResults, error: testError } = await this.supabase
        .from('test_sessions')
        .select('score')
        .eq('user_id', userId);

      if (groupError || messageError || testError) {
        throw groupError || messageError || testError;
      }

      const avgScore = testResults && testResults.length > 0
        ? testResults.reduce((sum, result) => sum + (result.score || 0), 0) / testResults.length
        : 0;

      return {
        userId,
        points: user.points || 0,
        groupsCount: groupCount?.length || 0,
        messagesCount: messageCount?.length || 0,
        testsTaken: testResults?.length || 0,
        averageScore: Math.round(avgScore * 100) / 100,
        badges: user.badges || [],
        stats: user.stats || {},
      };
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async getUserGroups(userId: string, options: { page?: number; limit?: number } = {}): Promise<Group[]> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `user:groups:${userId}:${page}:${limit}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('group_members')
        .select(`
          groups (
            id,
            name,
            avatar_url,
            description,
            last_message,
            last_message_time,
            admin_ids,
            permissions,
            parent_id,
            is_archived,
            invite_id,
            created_at
          )
        `)
        .eq('user_id', userId)
        .range(offset, offset + limit - 1);

      if (error) throw error;
      return data?.map((item: any) => item.groups).filter(Boolean) || [];
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  // Group Methods for API Routes
  async getGroups(options: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    userId?: string;
    responseProfile?: 'compact' | 'full';
  } = {}): Promise<Group[]> {
    const {
      page = 1,
      limit = SupabaseService.DEFAULT_GROUP_PAGE_SIZE,
      search,
      sortBy = 'created_at',
      sortOrder = 'desc',
      userId,
      responseProfile = 'full',
    } = options;
    const profile = this.getResponseProfile(responseProfile);
    const safeLimit = Math.min(SupabaseService.MAX_GROUP_PAGE_SIZE, Math.max(1, limit));
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    const cacheKey = `groups:list:${safePage}:${safeLimit}:${search || ''}:${sortBy}:${sortOrder}:${userId || ''}:profile:${profile}`;

    return cacheService.cached(cacheKey, async () => {
      const selectClause = profile === 'compact'
        ? 'id, name, avatar_url, last_message_time, is_archived'
        : 'id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, created_at';
      let query = this.supabase
        .from('groups')
        .select(selectClause)
        .range(offset, offset + safeLimit - 1);

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      if (userId) {
        // Only return groups the user is a member of
        const { data: memberGroups, error: memberError } = await this.supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', userId);

        if (memberError) throw memberError;

        const groupIds = memberGroups?.map(mg => mg.group_id) || [];
        if (groupIds.length === 0) return [];

        query = query.in('id', groupIds);
      }

      // Apply sorting
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });

      const { data, error } = await query;
      if (error) throw error;

      const groupIds = (data || []).map((item: any) => item.id);
      const memberCounts: Record<string, number> = {};

      if (groupIds.length > 0) {
        const { data: memberRows, error: memberCountError } = await this.supabase
          .from('group_members')
          .select('group_id')
          .in('group_id', groupIds);

        if (!memberCountError && memberRows) {
          memberRows.forEach((row: { group_id: string }) => {
            memberCounts[row.group_id] = (memberCounts[row.group_id] || 0) + 1;
          });
        }
      }

      // Transform snake_case to camelCase
      return (data || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        avatarUrl: item.avatar_url,
        lastMessage: item.last_message,
        lastMessageTime: item.last_message_time,
        adminIds: item.admin_ids || [],
        permissions: item.permissions || {},
        parentId: item.parent_id,
        isArchived: item.is_archived,
        inviteId: item.invite_id,
        createdAt: item.created_at,
        memberCount: memberCounts[item.id] || 0,
      })) as Group[];
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async getGroupById(groupId: string, userId?: string): Promise<Group | null> {
    if (!userId) {
      const { data, error } = await this.supabase
        .from('groups')
        .select('id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, created_at')
        .eq('id', groupId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        description: data.description,
        avatarUrl: data.avatar_url,
        lastMessage: data.last_message,
        lastMessageTime: data.last_message_time,
        adminIds: data.admin_ids || [],
        permissions: data.permissions || {},
        parentId: data.parent_id,
        isArchived: data.is_archived,
        inviteId: data.invite_id,
        createdAt: data.created_at,
      } as Group;
    }

    const cacheKey = `group:${groupId}:user:${userId}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('groups')
        .select('id, name, description, avatar_url, last_message, last_message_time, admin_ids, permissions, parent_id, is_archived, invite_id, created_at')
        .eq('id', groupId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      // Check if user has access to this group
      if (userId) {
        const { data: membership, error: memberError } = await this.supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', groupId)
          .eq('user_id', userId)
          .single();

        if (memberError && memberError.code !== 'PGRST116') throw memberError;
        if (!membership) return null; // User is not a member
      }

      // Transform snake_case to camelCase
      return {
        id: data.id,
        name: data.name,
        description: data.description,
        avatarUrl: data.avatar_url,
        lastMessage: data.last_message,
        lastMessageTime: data.last_message_time,
        adminIds: data.admin_ids || [],
        permissions: data.permissions || {},
        parentId: data.parent_id,
        isArchived: data.is_archived,
        inviteId: data.invite_id,
        createdAt: data.created_at,
      } as Group;
    }, { ttl: 600 }); // Cache for 10 minutes
  }

  async createGroup(groupData: Partial<Group>, userId: string, memberIds: string[] = []): Promise<Group> {
    const { data, error } = await this.supabase
      .from('groups')
      .insert({
        name: groupData.name,
        description: groupData.description,
        avatar_url: groupData.avatarUrl,
        admin_ids: [userId],
        permissions: groupData.permissions || {},
        invite_id: groupData.inviteId,
        parent_id: groupData.parentId,
        is_archived: false,
      })
      .select()
      .single();

    if (error) throw error;

    // If this is a subgroup, add all parent group members to the subgroup
    let allMemberIds = [userId, ...memberIds];
    
    if (groupData.parentId) {
      // Fetch parent group members
      const { data: parentMembers, error: parentError } = await this.supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', groupData.parentId);
      
      if (!parentError && parentMembers) {
        const parentMemberIds = parentMembers.map(m => m.user_id);
        // Add parent members that aren't already in the list
        for (const parentMemberId of parentMemberIds) {
          if (!allMemberIds.includes(parentMemberId)) {
            allMemberIds.push(parentMemberId);
          }
        }
      }
    }

    // Add all members
    const membersToInsert = allMemberIds.map(id => ({
      group_id: data.id,
      user_id: id,
    }));

    const { error: memberError } = await this.supabase
      .from('group_members')
      .insert(membersToInsert);

    if (memberError) throw memberError;

    // Invalidate caches
    await cacheService.invalidateUserCache(userId);
    for (const memberId of memberIds) {
      await cacheService.invalidateUserCache(memberId);
    }
    await cacheService.deletePattern('groups:list:*');

    // Transform snake_case to camelCase
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatar_url,
      lastMessage: data.last_message,
      lastMessageTime: data.last_message_time,
      adminIds: data.admin_ids || [],
      permissions: data.permissions || {},
      parentId: data.parent_id,
      isArchived: data.is_archived,
      inviteId: data.invite_id,
      createdAt: data.created_at,
    } as Group;
  }

  async updateGroup(groupId: string, updates: Partial<Group>): Promise<Group | null> {
    const { data, error } = await this.supabase
      .from('groups')
      .update({
        name: updates.name,
        description: updates.description,
        avatar_url: updates.avatarUrl,
        permissions: updates.permissions,
        invite_id: updates.inviteId,
        parent_id: updates.parentId,
        is_archived: updates.isArchived,
        admin_ids: updates.adminIds,
      })
      .eq('id', groupId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    // Invalidate caches
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.deletePattern('groups:list:*');

    // Transform snake_case to camelCase
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatar_url,
      lastMessage: data.last_message,
      lastMessageTime: data.last_message_time,
      adminIds: data.admin_ids || [],
      permissions: data.permissions || {},
      parentId: data.parent_id,
      isArchived: data.is_archived,
      inviteId: data.invite_id,
      createdAt: data.created_at,
    } as Group;
  }

  async getGroupByInviteId(inviteId: string): Promise<Group | null> {
    const { data, error } = await this.supabase
      .from('groups')
      .select('*')
      .eq('invite_id', inviteId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      avatarUrl: data.avatar_url,
      lastMessage: data.last_message,
      lastMessageTime: data.last_message_time,
      adminIds: data.admin_ids || [],
      permissions: data.permissions || {},
      parentId: data.parent_id,
      isArchived: data.is_archived,
      inviteId: data.invite_id,
      createdAt: data.created_at,
    } as Group;
  }

  async addGroupMember(groupId: string, userId: string): Promise<Group | null> {
    // Check if user is already a member
    const { data: existingMember, error: checkError } = await this.supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    if (existingMember) {
      // User is already a member, return the group
      return await this.getGroupById(groupId);
    }

    // Add the member
    const { error: memberError } = await this.supabase
      .from('group_members')
      .insert({
        group_id: groupId,
        user_id: userId,
      });

    if (memberError) throw memberError;

    // Invalidate caches
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern('groups:list:*');

    return await this.getGroupById(groupId);
  }

  /** Bulk add members with a single insert (avoids N sequential round-trips). */
  async addGroupMembersBatch(
    groupId: string,
    userIds: string[]
  ): Promise<{ added: string[]; alreadyMembers: string[] }> {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (!uniqueIds.length) {
      return { added: [], alreadyMembers: [] };
    }

    const { data: existing, error: checkError } = await this.supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .in('user_id', uniqueIds);

    if (checkError) throw checkError;

    const existingSet = new Set((existing || []).map((m: { user_id: string }) => m.user_id));
    const alreadyMembers = uniqueIds.filter((id) => existingSet.has(id));
    const toAdd = uniqueIds.filter((id) => !existingSet.has(id));

    if (toAdd.length) {
      const { error: insertError } = await this.supabase.from('group_members').insert(
        toAdd.map((user_id) => ({ group_id: groupId, user_id }))
      );
      if (insertError) throw insertError;

      await cacheService.invalidateGroupCache(groupId);
      await cacheService.invalidateGlobalCache('groups:list:*');
      for (const memberId of toAdd) {
        await cacheService.invalidateUserCache(memberId);
      }
    }

    return { added: toAdd, alreadyMembers };
  }

  async removeGroupMember(groupId: string, userId: string): Promise<Group | null> {
    const { error } = await this.supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.invalidateUserCache(userId);
    await cacheService.deletePattern('groups:list:*');

    return await this.getGroupById(groupId);
  }

  async deleteGroup(groupId: string): Promise<void> {
    // The database schema uses ON DELETE CASCADE for members and messages,
    // so we only need to delete the group itself.
    const { error } = await this.supabase
      .from('groups')
      .delete()
      .eq('id', groupId);

    if (error) {
      logger.error(`Error deleting group ${groupId}:`, error);
      throw error;
    }

    logger.info(`Group ${groupId} deleted. Associated data should be removed by cascade.`);

    // Invalidate relevant caches
    await cacheService.invalidateGroupCache(groupId);
    await cacheService.deletePattern('groups:list:*');
  }

  async getGroupMembers(groupId: string, options: { page?: number; limit?: number } = {}): Promise<User[]> {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `group:members:${groupId}:${page}:${limit}`;

    return cacheService.cached(cacheKey, async () => {
      // First get the member user IDs
      const { data: memberData, error: memberError } = await this.supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', groupId)
        .range(offset, offset + limit - 1);

      if (memberError) {
        logger.error('Error fetching group members:', memberError);
        throw memberError;
      }

      if (!memberData || memberData.length === 0) {
        return [];
      }

      // Then fetch the profiles for those users (email is not in profiles table)
      const userIds = memberData.map(m => m.user_id);
      const { data: profileData, error: profileError } = await this.supabase
        .from('profiles')
        .select('id, name, username, avatar_url, phone, points, stats, badges, settings')
        .in('id', userIds);

      if (profileError) {
        logger.error('Error fetching member profiles:', profileError);
        throw profileError;
      }

      // Transform to User format
      return (profileData || []).map((profile: any) => ({
        id: profile.id,
        name: profile.name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        phoneNumber: profile.phone,
        points: profile.points || 0,
        stats: profile.stats || {},
        badges: profile.badges || [],
        settings: profile.settings,
      }));
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async getGroupStats(groupId: string): Promise<any> {
    const cacheKey = `group:stats:${groupId}`;

    return cacheService.cached(cacheKey, async () => {
      // Get member count
      const { count: memberCount, error: memberError } = await this.supabase
        .from('group_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('group_id', groupId);

      // Get message count
      const { count: messageCount, error: messageError } = await this.supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', groupId);

      // Get recent activity
      const { data: recentMessages, error: recentError } = await this.supabase
        .from('messages')
        .select('timestamp')
        .eq('group_id', groupId)
        .order('timestamp', { ascending: false })
        .limit(10);

      if (memberError || messageError || recentError) {
        throw memberError || messageError || recentError;
      }

      const lastActivity = recentMessages && recentMessages.length > 0
        ? new Date(recentMessages[0].timestamp)
        : null;

      return {
        groupId,
        memberCount: memberCount || 0,
        messageCount: messageCount || 0,
        lastActivity,
        isActive: lastActivity && (Date.now() - lastActivity.getTime()) < 7 * 24 * 60 * 60 * 1000, // Active if activity in last 7 days
      };
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  // Message Methods for API Routes
  async getGroupMessages(groupId: string, options: {
    page?: number;
    limit?: number;
    before?: string;
    after?: string;
    responseProfile?: 'compact' | 'full';
  } = {}): Promise<Message[]> {
    const {
      page = 1,
      limit = SupabaseService.DEFAULT_MESSAGE_PAGE_SIZE,
      before,
      after,
      responseProfile = 'full',
    } = options;
    const profile = this.getResponseProfile(responseProfile);
    const safeLimit = Math.min(SupabaseService.MAX_MESSAGE_PAGE_SIZE, Math.max(1, limit));
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    const cacheKey = `messages:group:${groupId}:${safePage}:${safeLimit}:${before || ''}:${after || ''}:profile:${profile}`;

    logger.debug('getGroupMessages: Fetching messages', { groupId, page: safePage, limit: safeLimit, cacheKey });

    return cacheService.cached(cacheKey, async () => {
      logger.debug('getGroupMessages: Cache miss, querying database');
      const selectClause = profile === 'compact'
        ? `
          id,
          group_id,
          sender_id,
          type,
          text,
          timestamp,
          upvotes,
          downvotes,
          is_archived,
          image_url,
          profiles!sender_id (
            id,
            name,
            avatar_url
          )
        `
        : `
          id,
          group_id,
          sender_id,
          type,
          text,
          question_data,
          flagged_as_similar_user_ids,
          timestamp,
          upvotes,
          downvotes,
          is_archived,
          image_url,
          profiles!sender_id (
            id,
            name,
            avatar_url
          )
        `;
      
      let query = this.supabase
        .from('messages')
        .select(selectClause)
        .eq('group_id', groupId);

      if (before) {
        query = query.lt('timestamp', before);
      }
      if (after) {
        query = query.gt('timestamp', after);
      }

      const { data, error } = await query
        .order('timestamp', { ascending: false })
        .range(offset, offset + safeLimit - 1);

      if (error) {
        logger.error('getGroupMessages: Database error', { error });
        throw error;
      }

      logger.info('getGroupMessages: Retrieved messages from DB', { 
        groupId,
        count: (data || []).length,
        questionCount: (data || []).filter((m: any) => m.type === 'QUESTION').length
      });

      return (data || []).reverse().map((msg: any) => ({
        id: msg.id,
        groupId: msg.group_id,
        sender: {
          id: msg.profiles?.id || msg.sender_id,
          name: msg.profiles?.name || 'Unknown',
          avatarUrl: msg.profiles?.avatar_url,
          points: 0,
          badges: [],
          stats: {},
        },
        timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
        flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
        upvotes: msg.upvotes || 0,
        downvotes: msg.downvotes || 0,
        isArchived: msg.is_archived || false,
        ...this.normalizeMessageRecord(msg),
      }));
    }, { ttl: 120 }); // Cache for 2 minutes
  }

  async getMessageById(messageId: string, userId?: string): Promise<Message | null> {
    const cacheKey = `message:${messageId}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('messages')
        .select(`
          id,
          group_id,
          sender_id,
          type,
          text,
          question_data,
          flagged_as_similar_user_ids,
          timestamp,
          upvotes,
          downvotes,
          profiles!sender_id (
            id,
            name,
            avatar_url
          )
        `)
        .eq('id', messageId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      // Check if user has access to this message (must be member of the group)
      if (userId) {
        const { data: membership, error: memberError } = await this.supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', data.group_id)
          .eq('user_id', userId)
          .single();

        if (memberError && memberError.code !== 'PGRST116') throw memberError;
        if (!membership) return null; // User doesn't have access
      }

      return {
        id: data.id,
        groupId: data.group_id,
        sender: {
          id: Array.isArray((data as any).profiles) ? (data as any).profiles[0]?.id || data.sender_id : (data as any).profiles?.id || data.sender_id,
          name: Array.isArray((data as any).profiles) ? (data as any).profiles[0]?.name || 'Unknown' : (data as any).profiles?.name || 'Unknown',
          avatarUrl: Array.isArray((data as any).profiles) ? (data as any).profiles[0]?.avatar_url : (data as any).profiles?.avatar_url,
          points: 0,
          badges: [],
          stats: {},
        },
        senderId: data.sender_id,
        timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
        flaggedAsSimilarUserIds: data.flagged_as_similar_user_ids || [],
        upvotes: data.upvotes || 0,
        downvotes: data.downvotes || 0,
        ...this.normalizeMessageRecord(data),
      };
    }, { ttl: 600 }); // Cache for 10 minutes
  }

  async updateMessage(messageId: string, content: string): Promise<Message | null> {
    const { data, error } = await this.supabase
      .from('messages')
      .update({
        text: content,
        type: 'TEXT',
      })
      .eq('id', messageId)
      .select(`
        id,
        group_id,
        sender_id,
        type,
        text,
        question_data,
        flagged_as_similar_user_ids,
        timestamp,
        profiles!sender_id (
          id,
          name,
          avatar_url
        )
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    // Invalidate caches
    await cacheService.invalidateGroupCache(data.group_id);
    await cacheService.delete(`message:${messageId}`);
    await cacheService.deletePattern(`messages:group:${data.group_id}:*`);

    return {
      id: data.id,
      groupId: data.group_id,
      sender: {
        id: Array.isArray(data.profiles) ? (data.profiles as unknown as any[])[0]?.id || data.sender_id : (data.profiles as unknown as any)?.id || data.sender_id,
        name: Array.isArray(data.profiles) ? (data.profiles as unknown as any[])[0]?.name || 'Unknown' : (data.profiles as unknown as any)?.name || 'Unknown',
        avatarUrl: Array.isArray(data.profiles) ? (data.profiles as unknown as any[])[0]?.avatar_url : (data.profiles as unknown as any)?.avatar_url,
        points: 0,
        badges: [],
        stats: {},
      },
      senderId: data.sender_id,
      timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
      flaggedAsSimilarUserIds: data.flagged_as_similar_user_ids || [],
      upvotes: 0,
      downvotes: 0,
      type: data.type || 'TEXT',
      text: data.text,
    };
  }

  async voteQuestion(messageId: string, userId: string, voteType: 'up' | 'down'): Promise<any> {
    // Check if vote already exists
    const { data: existingVote, error: checkError } = await this.supabase
      .from('question_votes')
      .select('*')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    const oldVoteType = existingVote?.vote_type;

    if (existingVote) {
      // Update existing vote using composite key
      const { error } = await this.supabase
        .from('question_votes')
        .update({ vote_type: voteType })
        .eq('message_id', messageId)
        .eq('user_id', userId);

      if (error) throw error;
      
      // Update message vote counts (if vote type changed)
      if (oldVoteType !== voteType) {
        // Get current message
        const { data: message } = await this.supabase
          .from('messages')
          .select('upvotes, downvotes')
          .eq('id', messageId)
          .single();
        
        if (message) {
          const updates: any = {};
          if (oldVoteType === 'up') {
            updates.upvotes = Math.max(0, (message.upvotes || 0) - 1);
          } else if (oldVoteType === 'down') {
            updates.downvotes = Math.max(0, (message.downvotes || 0) - 1);
          }
          if (voteType === 'up') {
            updates.upvotes = (updates.upvotes !== undefined ? updates.upvotes : (message.upvotes || 0)) + 1;
          } else if (voteType === 'down') {
            updates.downvotes = (updates.downvotes !== undefined ? updates.downvotes : (message.downvotes || 0)) + 1;
          }
          
          await this.supabase
            .from('messages')
            .update(updates)
            .eq('id', messageId);
        }
      }
    } else {
      // Create new vote
      const { error } = await this.supabase
        .from('question_votes')
        .insert({
          message_id: messageId,
          user_id: userId,
          vote_type: voteType,
        });

      if (error) throw error;
      
      // Update message vote counts
      const { data: message } = await this.supabase
        .from('messages')
        .select('upvotes, downvotes')
        .eq('id', messageId)
        .single();
      
      if (message) {
        const updates: any = {};
        if (voteType === 'up') {
          updates.upvotes = (message.upvotes || 0) + 1;
        } else {
          updates.downvotes = (message.downvotes || 0) + 1;
        }
        
        await this.supabase
          .from('messages')
          .update(updates)
          .eq('id', messageId);
      }
    }

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);
    // Also invalidate group messages cache
    const { data: msg } = await this.supabase.from('messages').select('group_id, upvotes, downvotes').eq('id', messageId).single();
    if (msg) {
      await cacheService.deletePattern(`messages:group:${msg.group_id}:*`);
    }

    return { success: true, voteType, upvotes: msg?.upvotes ?? 0, downvotes: msg?.downvotes ?? 0 };
  }

  async removeVote(messageId: string, userId: string): Promise<any> {
    // Get existing vote first
    const { data: existingVote } = await this.supabase
      .from('question_votes')
      .select('vote_type')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .single();
    
    const { error } = await this.supabase
      .from('question_votes')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId);

    if (error) throw error;
    
    // Update message vote counts
    if (existingVote) {
      const { data: message } = await this.supabase
        .from('messages')
        .select('upvotes, downvotes')
        .eq('id', messageId)
        .single();
      
      if (message) {
        const updates: any = {};
        if (existingVote.vote_type === 'up') {
          updates.upvotes = Math.max(0, (message.upvotes || 0) - 1);
        } else if (existingVote.vote_type === 'down') {
          updates.downvotes = Math.max(0, (message.downvotes || 0) - 1);
        }
        
        await this.supabase
          .from('messages')
          .update(updates)
          .eq('id', messageId);
      }
    }

    // Invalidate message cache
    await cacheService.delete(`message:${messageId}`);
    // Also invalidate group messages cache
    const { data: msg } = await this.supabase.from('messages').select('group_id, upvotes, downvotes').eq('id', messageId).single();
    if (msg) {
      await cacheService.deletePattern(`messages:group:${msg.group_id}:*`);
    }

    return { success: true, upvotes: msg?.upvotes ?? 0, downvotes: msg?.downvotes ?? 0 };
  }

  async getUserVotesForGroup(groupId: string, userId: string): Promise<Record<string, 'up' | 'down'>> {
    // Get all message IDs in the group
    const { data: messages, error: msgError } = await this.supabase
      .from('messages')
      .select('id')
      .eq('group_id', groupId);

    if (msgError) throw msgError;
    if (!messages || messages.length === 0) return {};

    const messageIds = messages.map(m => m.id);

    // Get user's votes for those messages
    const { data: votes, error: votesError } = await this.supabase
      .from('question_votes')
      .select('message_id, vote_type')
      .eq('user_id', userId)
      .in('message_id', messageIds);

    if (votesError) throw votesError;

    // Convert to a map
    const voteMap: Record<string, 'up' | 'down'> = {};
    for (const vote of votes || []) {
      voteMap[vote.message_id] = vote.vote_type;
    }

    return voteMap;
  }

  async updateQuestionStatus(messageId: string, questionStatus: string): Promise<any> {
    // First get the current message to get the question_data
    const { data: currentMessage, error: fetchError } = await this.supabase
      .from('messages')
      .select('question_data, group_id')
      .eq('id', messageId)
      .single();

    if (fetchError) throw fetchError;
    if (!currentMessage) throw new Error('Message not found');

    // Update the questionStatus in the question_data JSONB
    const updatedQuestionData = {
      ...currentMessage.question_data,
      questionStatus,
    };

    const { data, error } = await this.supabase
      .from('messages')
      .update({ question_data: updatedQuestionData })
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`message:${messageId}`);
    await cacheService.delete(`group:${currentMessage.group_id}:messages`);

    return data;
  }

  async updateMessageFlagged(messageId: string, flaggedUserIds: string[]): Promise<Message | null> {
    const { data, error } = await this.supabase
      .from('messages')
      .update({
        flagged_as_similar_user_ids: flaggedUserIds,
      })
      .eq('id', messageId)
      .select(`
        id,
        group_id,
        sender_id,
        type,
        text,
        question_data,
        flagged_as_similar_user_ids,
        timestamp,
        profiles!sender_id (
          id,
          name,
          avatar_url
        )
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    // Invalidate caches
    await cacheService.invalidateGroupCache(data.group_id);
    await cacheService.delete(`message:${messageId}`);
    await cacheService.deletePattern(`messages:group:${data.group_id}:*`);

    return {
      id: data.id,
      groupId: data.group_id,
      sender: {
        id: Array.isArray(data.profiles) ? (data.profiles as unknown as any[])[0]?.id || data.sender_id : (data.profiles as unknown as any)?.id || data.sender_id,
        name: Array.isArray(data.profiles) ? (data.profiles as unknown as any[])[0]?.name || 'Unknown' : (data.profiles as unknown as any)?.name || 'Unknown',
        avatarUrl: Array.isArray(data.profiles) ? (data.profiles as unknown as any[])[0]?.avatar_url : (data.profiles as unknown as any)?.avatar_url,
        points: 0,
        badges: [],
        stats: {},
      },
      senderId: data.sender_id,
      timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
      flaggedAsSimilarUserIds: data.flagged_as_similar_user_ids || [],
      upvotes: 0,
      downvotes: 0,
      type: data.type || 'TEXT',
      text: data.text,
    };
  }

  async createDeck(deckData: { name: string; description?: string; isShared?: boolean }, userId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('decks')
      .insert({
        name: deckData.name,
        description: deckData.description || '',
        user_id: userId,
        is_shared: deckData.isShared ?? false,
      })
      .select()
      .single();

    if (error) {
      logger.error('Error creating deck:', { error, deckData, userId });
      throw new Error(error.message || 'Failed to create deck');
    }

    // Cache the new deck
    await cacheService.set(`deck:${data.id}`, data, 1800); // 30 minutes

    return data;
  }

  async getDecks(
    userId: string,
    includeShared: boolean = false,
    options: { page?: number; limit?: number; responseProfile?: 'compact' | 'full' } = {}
  ): Promise<any[]> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(
      SupabaseService.MAX_DECK_PAGE_SIZE,
      Math.max(1, options.limit || SupabaseService.DEFAULT_DECK_PAGE_SIZE)
    );
    const profile = this.getResponseProfile(options.responseProfile);
    const offset = (page - 1) * limit;
    const cacheKey = `decks:user:${userId}:includeShared:${includeShared}:p${page}:l${limit}:profile:${profile}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const selectClause = profile === 'compact'
      ? 'id, name, user_id, is_shared, created_at'
      : 'id, name, description, user_id, is_shared, created_at';

    let query = this.supabase
      .from('decks')
      .select(selectClause)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (includeShared) {
      // Include decks owned by the user and decks that are shared by others
      query = query.or(`user_id.eq.${userId},is_shared.eq.true`);
    } else {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) throw error;

    const decks = (data || []) as unknown as Array<{ id: string; [key: string]: unknown }>;
    const deckIds = decks.map(d => d.id);
    const cardCountByDeck: Record<string, number> = {};

    if (deckIds.length > 0) {
      const { data: cardRows, error: countError } = await this.supabase
        .from('flashcards')
        .select('deck_id')
        .in('deck_id', deckIds);

      if (!countError && cardRows) {
        for (const row of cardRows) {
          const deckId = row.deck_id as string;
          cardCountByDeck[deckId] = (cardCountByDeck[deckId] || 0) + 1;
        }
      }
    }

    const decksWithCounts = decks.map(d => ({
      ...d,
      card_count: cardCountByDeck[d.id] || 0,
    }));

    await cacheService.set(cacheKey, decksWithCounts, 1800); // 30 minutes
    return decksWithCounts;
  }

  async getSharedDecks(): Promise<any[]> {
    const cacheKey = `decks:shared`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from('decks')
      .select('*')
      .eq('is_shared', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async getDeckCollaborators(deckId: string, userId: string): Promise<any[]> {
    const hasAccess = await this.verifyDeckAccess(userId, deckId, 'read');
    if (!hasAccess) return [];

    const cacheKey = `deck_collaborators:${deckId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from('deck_collaborators')
      .select('user_id, role, added_at, profiles!deck_collaborators_user_id_fkey(id, name, avatar_url)')
      .eq('deck_id', deckId);

    if (error) throw error;

    await cacheService.set(cacheKey, data, 300);
    return data;
  }

  async addDeckCollaborator(deckId: string, userId: string, role: string = 'editor', requesterId?: string): Promise<any> {
    const actorId = requesterId || userId;
    const canManage = await this.verifyDeckAccess(actorId, deckId, 'owner');
    if (!canManage) throw new Error('Access denied');

    const { data, error } = await this.supabase
      .from('deck_collaborators')
      .insert({ deck_id: deckId, user_id: userId, role })
      .select()
      .single();

    if (error) throw error;

    await cacheService.delete(`deck_collaborators:${deckId}`);
    return data;
  }

  async removeDeckCollaborator(deckId: string, userId: string, requesterId?: string): Promise<boolean> {
    const actorId = requesterId || userId;
    const isOwner = await this.verifyDeckAccess(actorId, deckId, 'owner');
    if (!isOwner && actorId !== userId) throw new Error('Access denied');

    const { error } = await this.supabase
      .from('deck_collaborators')
      .delete()
      .eq('deck_id', deckId)
      .eq('user_id', userId);

    if (error) throw error;

    await cacheService.delete(`deck_collaborators:${deckId}`);
    return true;
  }

  async getDeck(deckId: string): Promise<any | null> {
    const cacheKey = `deck:${deckId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from('decks')
      .select('id, name, description, user_id, is_shared, created_at')
      .eq('id', deckId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async updateDeck(deckId: string, updates: { name?: string; description?: string; isPublic?: boolean; isShared?: boolean }, userId: string): Promise<any | null> {
    const canEdit = await this.verifyDeckAccess(userId, deckId, 'edit');
    if (!canEdit) return null;

    const { data, error } = await this.supabase
      .from('decks')
      .update({
        name: updates.name,
        description: updates.description,
        is_public: updates.isPublic,
        is_shared: updates.isShared,
      })
      .eq('id', deckId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    // Update cache
    await cacheService.set(`deck:${deckId}`, data, 1800);
    await cacheService.deletePattern(`deck:${deckId}:user:*`);

    return data;
  }

  async deleteDeck(deckId: string, userId: string): Promise<boolean> {
    const isOwner = await this.verifyDeckAccess(userId, deckId, 'owner');
    if (!isOwner) return false;

    const { error } = await this.supabase
      .from('decks')
      .delete()
      .eq('id', deckId);

    if (error) throw error;

    // Clear cache
    await cacheService.delete(`deck:${deckId}`);
    await cacheService.deletePattern(`deck:${deckId}:user:*`);
    await cacheService.deletePattern(`decks:user:*`);

    return true;
  }

  async exportDeck(deckId: string, userId: string): Promise<any | null> {
    const deck = await this.getDeckForUser(deckId, userId);
    if (!deck) return null;

    const { data: flashcards, error } = await this.supabase
      .from('flashcards')
      .select('*')
      .eq('deck_id', deckId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return {
      deck,
      flashcards: flashcards || [],
    };
  }

  async importDeck(importData: any, userId: string): Promise<any> {
    // Create the deck (removed is_public as it doesn't exist in the schema)
    const { data: newDeck, error: deckError } = await this.supabase
      .from('decks')
      .insert({
        name: importData.deck.name,
        description: importData.deck.description || '',
        user_id: userId,
      })
      .select()
      .single();

    if (deckError) {
      logger.error('Error creating deck during import:', deckError);
      throw deckError;
    }

    // Import flashcards (removed user_id as it doesn't exist in flashcards schema)
    if (importData.flashcards && importData.flashcards.length > 0) {
      const flashcardsToInsert = importData.flashcards.map((card: any) => {
        const cardType = card.type || 'BASIC';
        const insertData: any = {
          deck_id: newDeck.id,
          type: cardType,
        };
        
        if (cardType === 'CLOZE') {
          insertData.cloze_text = card.clozeText || card.cloze_text;
        } else if (cardType === 'IMAGE_OCCLUSION') {
          insertData.front = card.front;
          insertData.back = card.back;
          const occlusionData = card.occlusion_data || card.occlusionData;
          if (occlusionData) {
            insertData.occlusion_data = occlusionData;
          }
        } else {
          insertData.front = card.front;
          insertData.back = card.back;
        }

        const imageUrl = card.image_url || card.imageUrl;
        if (imageUrl) {
          insertData.image_url = imageUrl;
        }
        
        if (card.tags && card.tags.length > 0) {
          insertData.tags = card.tags;
        }
        
        return insertData;
      });

      const { error: cardsError } = await this.supabase
        .from('flashcards')
        .insert(flashcardsToInsert);

      if (cardsError) {
        logger.error('Error importing flashcards:', cardsError);
        throw cardsError;
      }
    }

    // Invalidate user's deck cache so the new deck shows up
    await cacheService.delete(`decks:user:${userId}`);
    await cacheService.deletePattern(`decks:user:${userId}*`);
    
    // Invalidate flashcard caches so newly imported cards show up
    await cacheService.deletePattern('flashcards:*');
    
    // Cache the new deck
    await cacheService.set(`deck:${newDeck.id}`, newDeck, 1800);

    // fetch back the inserted cards so callers can update state immediately
    let insertedFlashcards: any[] = [];
    if (importData.flashcards && importData.flashcards.length > 0) {
      const { data: cards } = await this.supabase
        .from('flashcards')
        .select('*')
        .eq('deck_id', newDeck.id);
      insertedFlashcards = cards || [];
    }

    return { deck: newDeck, flashcards: insertedFlashcards };

  }

  async createFlashcard(flashcardData: { 
    deckId: string; 
    type?: string;
    front?: string; 
    back?: string; 
    clozeText?: string;
    imageUrl?: string;
    occlusionData?: any;
    tags?: string[];
    userId?: string 
  }): Promise<any> {
    const cardType = flashcardData.type || 'BASIC';

    if (!flashcardData.userId) {
      throw new Error('Authentication required');
    }
    const canEdit = await this.verifyDeckAccess(flashcardData.userId, flashcardData.deckId, 'edit');
    if (!canEdit) {
      throw new Error('Deck not found or access denied');
    }
    
    const insertData: any = {
      deck_id: flashcardData.deckId,
      type: cardType,
    };

    if (cardType === 'CLOZE') {
      // CLOZE cards must have cloze_text and front/back must be NULL per DB constraint
      insertData.cloze_text = flashcardData.clozeText;
      // front and back are left as NULL for CLOZE cards
    } else {
      // For BASIC and IMAGE_OCCLUSION, allow an optional image URL.
      insertData.front = flashcardData.front;
      insertData.back = cardType === 'IMAGE_OCCLUSION' ? null : flashcardData.back;
      insertData.image_url = flashcardData.imageUrl;
    }

    if (cardType === 'IMAGE_OCCLUSION') {
      insertData.occlusion_data = flashcardData.occlusionData;
    }

    if (flashcardData.tags && flashcardData.tags.length > 0) {
      insertData.tags = flashcardData.tags;
    }

    const { data, error } = await this.supabase
      .from('flashcards')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      logger.error('Error creating flashcard:', { error, flashcardData });
      throw new Error(error.message || 'Failed to create flashcard');
    }

    // Invalidate deck cache
    await cacheService.deletePattern(`flashcards:*`);

    return data;
  }

  async uploadFlashcardImage(params: {
    fileName: string;
    base64Data: string;
    contentType: string;
    userId: string;
    folder?: string;
  }): Promise<{ url: string; path: string }> {
    const bucket = 'flashcard-images';
    const timestamp = Date.now();
    const safeName = params.fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const ownerPrefix = `${params.userId.replace(/[^a-zA-Z0-9_-]/g, '')}/`;
    const folderSegment = params.folder
      ? `${params.folder.replace(/\.\./g, '').replace(/^\/+|\/+$/g, '')}/`
      : '';
    const filePath = `${ownerPrefix}${folderSegment}${timestamp}-${safeName}`;

    const buffer = Buffer.from(params.base64Data, 'base64');

    const attemptUpload = async () => {
      return this.supabase.storage
        .from(bucket)
        .upload(filePath, buffer, {
          contentType: params.contentType || 'application/octet-stream',
          cacheControl: '3600',
          upsert: false,
        });
    };

    let uploadResult = await attemptUpload();

    // If bucket doesn't exist, create it and retry once.
    if (
      uploadResult.error &&
      typeof uploadResult.error.message === 'string' &&
      uploadResult.error.message.toLowerCase().includes('bucket') &&
      uploadResult.error.message.toLowerCase().includes('not found')
    ) {
      await this.supabase.storage.createBucket(bucket, { public: true });
      uploadResult = await attemptUpload();
    }

    const { data, error } = uploadResult;
    if (error) {
      logger.error('Error uploading flashcard image:', { error, filePath });
      throw new Error(error.message);
    }

    // Build a public URL based on the configured Supabase URL.
    // This ensures the returned URL matches the environment (e.g., if using the local Supabase emulator vs a hosted project).
    const baseUrl = (process.env.SUPABASE_URL || this.supabaseUrl || '').replace(/\/+$/, '');
    const publicUrl = `${baseUrl}/storage/v1/object/public/${bucket}/${encodeURIComponent(filePath)}`;

    return {
      url: publicUrl,
      path: filePath,
    };
  }

  // Offline bundle persistence
  async getOfflineBundles(userId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('offline_bundles')
      .select('*')
      .eq('user_id', userId)
      .order('downloaded_at', { ascending: false });

    if (error) {
      logger.error('Error fetching offline bundles:', { error, userId });
      throw error;
    }

    return data || [];
  }

  async saveOfflineBundle(userId: string, bundle: any): Promise<void> {
    const insert = {
      user_id: userId,
      bundle_id: bundle.bundleId,
      config: bundle.config || {},
      questions: bundle.questions || [],
      group_name: bundle.groupName || null,
      display_name: bundle.displayName ?? null,
      downloaded_at: bundle.downloadedAt || new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from('offline_bundles')
      .upsert(insert, { onConflict: 'user_id,bundle_id' });

    if (error) {
      logger.error('Error saving offline bundle:', { error, userId, bundleId: bundle.bundleId });
      throw error;
    }

    return;
  }

  async deleteOfflineBundle(userId: string, bundleId: string): Promise<void> {
    const { error } = await this.supabase
      .from('offline_bundles')
      .delete()
      .eq('user_id', userId)
      .eq('bundle_id', bundleId);

    if (error) {
      logger.error('Error deleting offline bundle:', { error, userId, bundleId });
      throw error;
    }

    return;
  }

  async getAccessibleDeckIds(userId: string): Promise<string[]> {
    const [{ data: ownedDecks, error: ownedError }, { data: collaboratorRows, error: collabError }] =
      await Promise.all([
        this.supabase.from('decks').select('id').eq('user_id', userId),
        this.supabase.from('deck_collaborators').select('deck_id').eq('user_id', userId),
      ]);

    if (ownedError) throw ownedError;
    if (collabError) throw collabError;

    const ids = new Set<string>();
    for (const deck of ownedDecks || []) ids.add(deck.id);
    for (const row of collaboratorRows || []) {
      if (row.deck_id) ids.add(row.deck_id);
    }
    return Array.from(ids);
  }

  /** Internal fetch — no access check. */
  private async fetchDeckRecord(deckId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('decks')
      .select('id, name, description, user_id, is_shared, created_at')
      .eq('id', deckId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async verifyDeckAccess(userId: string, deckId: string, level: 'read' | 'edit' | 'owner' = 'read'): Promise<boolean> {
    const deck = await this.fetchDeckRecord(deckId);
    if (!deck) return false;

    const isOwner = deck.user_id === userId;
    if (level === 'owner') return isOwner;
    if (isOwner) return true;

    const { data: collab, error: collabError } = await this.supabase
      .from('deck_collaborators')
      .select('role')
      .eq('deck_id', deckId)
      .eq('user_id', userId)
      .maybeSingle();

    if (collabError) throw collabError;

    if (collab) {
      if (level === 'read') return true;
      if (level === 'edit') return collab.role === 'editor' || collab.role === 'owner';
    }

    if (level === 'read' && deck.is_shared) return true;
    return false;
  }

  async getDeckForUser(deckId: string, userId: string): Promise<any | null> {
    const cacheKey = `deck:${deckId}:user:${userId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached;

    const hasAccess = await this.verifyDeckAccess(userId, deckId, 'read');
    if (!hasAccess) return null;

    const deck = await this.fetchDeckRecord(deckId);
    if (deck) await cacheService.set(cacheKey, deck, 1800);
    return deck;
  }

  async getFlashcardForUser(flashcardId: string, userId: string): Promise<any | null> {
    const cacheKey = `flashcard:${flashcardId}:user:${userId}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from('flashcards')
      .select('*')
      .eq('id', flashcardId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const hasAccess = await this.verifyDeckAccess(userId, data.deck_id, 'read');
    if (!hasAccess) return null;

    await cacheService.set(cacheKey, data, 1800);
    return data;
  }

  async getFlashcards(
    userId: string,
    deckId?: string,
    options?: { page?: number; limit?: number; responseProfile?: 'compact' | 'full' }
  ): Promise<any[]> {
    const {
      page = 1,
      limit = SupabaseService.DEFAULT_FLASHCARD_PAGE_SIZE,
      responseProfile = 'full',
    } = options || {};
    const profile = this.getResponseProfile(responseProfile);
    const safeLimit = Math.min(SupabaseService.MAX_FLASHCARD_PAGE_SIZE, Math.max(1, limit));
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    const selectClause = profile === 'compact'
      ? 'id, deck_id, type, front, image_url, tags, created_at'
      : 'id, deck_id, type, front, back, cloze_text, image_url, occlusion_data, srs_data, tags, created_at';

    const accessibleDeckIds = await this.getAccessibleDeckIds(userId);

    if (accessibleDeckIds.length === 0) {
      return [];
    }

    let query = this.supabase
      .from('flashcards')
      .select(selectClause)
      .in('deck_id', accessibleDeckIds)
      .order('created_at', { ascending: false });

    if (deckId) {
      if (!accessibleDeckIds.includes(deckId)) {
        return [];
      }
      query = query.eq('deck_id', deckId);
    }

    const { data, error } = await query.range(offset, offset + safeLimit - 1);

    if (error) throw error;

    return data || [];
  }

  async getFlashcard(flashcardId: string): Promise<any | null> {
    const cacheKey = `flashcard:${flashcardId}`;
    const cached = await cacheService.get<any>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from('flashcards')
      .select('*')
      .eq('id', flashcardId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async getFlashcardComments(flashcardId: string): Promise<any[]> {
    const cacheKey = `flashcard_comments:${flashcardId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from('flashcard_comments')
      .select('*')
      .eq('flashcard_id', flashcardId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    await cacheService.set(cacheKey, data, 300);
    return data;
  }

  async addFlashcardComment(flashcardId: string, userId: string, comment: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('flashcard_comments')
      .insert({ flashcard_id: flashcardId, user_id: userId, comment })
      .select()
      .single();

    if (error) throw error;

    await cacheService.delete(`flashcard_comments:${flashcardId}`);
    return data;
  }

  async updateFlashcard(flashcardId: string, updates: { 
    front?: string; 
    back?: string; 
    clozeText?: string;
    imageUrl?: string;
    occlusionData?: any;
    srsData?: any;
    tags?: string[];
  }, userId?: string): Promise<any | null> {
    const existing = userId
      ? await this.getFlashcardForUser(flashcardId, userId)
      : await this.getFlashcard(flashcardId);
    if (!existing) return null;
    if (userId) {
      const canEdit = await this.verifyDeckAccess(userId, existing.deck_id, 'edit');
      if (!canEdit) return null;
    }

    // Build update object with only defined fields
    const updateData: any = {};
    if (updates.front !== undefined) updateData.front = updates.front;
    if (updates.back !== undefined) updateData.back = updates.back;
    if (updates.clozeText !== undefined) updateData.cloze_text = updates.clozeText;
    if (updates.imageUrl !== undefined) updateData.image_url = updates.imageUrl;
    if (updates.occlusionData !== undefined) updateData.occlusion_data = updates.occlusionData;
    if (updates.srsData !== undefined) updateData.srs_data = updates.srsData;
    if (updates.tags !== undefined) updateData.tags = updates.tags;

    // If no fields to update, just return the current flashcard
    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    const { data, error } = await this.supabase
      .from('flashcards')
      .update(updateData)
      .eq('id', flashcardId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      logger.error('Error updating flashcard:', { error, flashcardId, updates });
      throw new Error(error.message || 'Failed to update flashcard');
    }

    // Update cache and invalidate deck cache
    await cacheService.set(`flashcard:${flashcardId}`, data, 1800);
    if (userId) await cacheService.delete(`flashcard:${flashcardId}:user:${userId}`);
    await cacheService.deletePattern(`flashcards:*`);

    return data;
  }

  async deleteFlashcard(flashcardId: string, userId?: string): Promise<boolean> {
    const flashcard = userId
      ? await this.getFlashcardForUser(flashcardId, userId)
      : await this.getFlashcard(flashcardId);
    if (!flashcard) return false;
    if (userId) {
      const canEdit = await this.verifyDeckAccess(userId, flashcard.deck_id, 'edit');
      if (!canEdit) return false;
    }

    const { error } = await this.supabase
      .from('flashcards')
      .delete()
      .eq('id', flashcardId);

    if (error) throw error;

    // Clear caches
    await cacheService.delete(`flashcard:${flashcardId}`);
    await cacheService.deletePattern(`flashcards:*`);

    return true;
  }

  async getUserQuestionStats(userId: string): Promise<any[]> {
    const cacheKey = `user-stats:${userId}`;
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .from('user_question_stats')
      .select('*')
      .eq('user_id', userId)
      .order('last_attempted', { ascending: false });

    if (error) throw error;

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async updateUserQuestionStats(userId: string, questionId: string, stats: {
    correct_attempts?: number;
    incorrect_attempts?: number;
    last_attempted?: Date;
  }): Promise<any> {
    // Check if stats exist
    const { data: existing, error: checkError } = await this.supabase
      .from('user_question_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    let result;
    if (existing) {
      // Update existing stats
      const { data, error } = await this.supabase
        .from('user_question_stats')
        .update({
          correct_attempts: stats.correct_attempts !== undefined ? stats.correct_attempts : existing.correct_attempts,
          incorrect_attempts: stats.incorrect_attempts !== undefined ? stats.incorrect_attempts : existing.incorrect_attempts,
          last_attempted: stats.last_attempted || existing.last_attempted,
        })
        .eq('user_id', userId)
        .eq('question_id', questionId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Create new stats
      const { data, error } = await this.supabase
        .from('user_question_stats')
        .insert({
          user_id: userId,
          question_id: questionId,
          correct_attempts: stats.correct_attempts || 0,
          incorrect_attempts: stats.incorrect_attempts || 0,
          last_attempted: stats.last_attempted || new Date(),
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Invalidate cache
    await cacheService.delete(`user-stats:${userId}`);

    return result;
  }

  async getUserQuestionStat(userId: string, questionId: string): Promise<any | null> {
    const cacheKey = `user-stat:${userId}:${questionId}`;
    const cached = await cacheService.get(cacheKey);
    if (cached !== null) return cached as any;

    const { data, error } = await this.supabase
      .from('user_question_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    await cacheService.set(cacheKey, data, 1800); // 30 minutes
    return data;
  }

  async upsertUserQuestionStat(userId: string, questionId: string, stats: {
    correctAttempts?: number;
    incorrectAttempts?: number;
    lastAttempted?: Date;
  }): Promise<any> {
    // Check if stats exist
    const { data: existing, error: checkError } = await this.supabase
      .from('user_question_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    let result;
    if (existing) {
      // Update existing stats
      const { data, error } = await this.supabase
        .from('user_question_stats')
        .update({
          correct_attempts: stats.correctAttempts !== undefined ? stats.correctAttempts : existing.correct_attempts,
          incorrect_attempts: stats.incorrectAttempts !== undefined ? stats.incorrectAttempts : existing.incorrect_attempts,
          last_attempted: stats.lastAttempted || existing.last_attempted,
        })
        .eq('user_id', userId)
        .eq('question_id', questionId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Create new stats
      const { data, error } = await this.supabase
        .from('user_question_stats')
        .insert({
          user_id: userId,
          question_id: questionId,
          correct_attempts: stats.correctAttempts || 0,
          incorrect_attempts: stats.incorrectAttempts || 0,
          last_attempted: stats.lastAttempted || new Date(),
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Invalidate cache
    await cacheService.delete(`user-stats:${userId}`);

    return result;
  }

  async resetDeckStatistics(deckId: string, userId: string): Promise<any> {
    const canEdit = await this.verifyDeckAccess(userId, deckId, 'edit');
    if (!canEdit) throw new Error('Deck not found or access denied');

    // clear srs_data on all cards in deck so they appear new again
    const { error: cardError } = await this.supabase
      .from('flashcards')
      .update({ srs_data: {} })
      .eq('deck_id', deckId);

    if (cardError) throw cardError;

    // also invalidate any related cache entries
    await cacheService.deletePattern(`flashcards:*`);
    await cacheService.delete(`deck:${deckId}`);

    return { success: true };
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    // Get message first to know which group to invalidate
    const { data: message, error: fetchError } = await this.supabase
      .from('messages')
      .select('group_id')
      .eq('id', messageId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') return false; // Not found
      throw fetchError;
    }

    const { error } = await this.supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.invalidateGroupCache(message.group_id);
    await cacheService.delete(`message:${messageId}`);
    await cacheService.deletePattern(`messages:group:${message.group_id}:*`);

    return true;
  }

  async getDirectMessages(userId: string, otherUserId: string, options: {
    page?: number;
    limit?: number;
  } = {}): Promise<Message[]> {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    // Create thread ID from sorted user IDs
    const sortedIds = [userId, otherUserId].sort();
    const threadId = sortedIds.join('-');

    try {
      const { data, error } = await this.supabase
        .from('dm_messages')
        .select(`
          id,
          thread_id,
          sender_id,
          text,
          timestamp,
          profiles:sender_id (
            id,
            name,
            avatar_url
          )
        `)
        .eq('thread_id', threadId)
        .order('timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        logger.error('Error fetching DM messages from database', { error, threadId });
        return [];
      }

      return (data || []).reverse().map((msg: any) => ({
        id: msg.id,
        threadId: msg.thread_id,
        sender: {
          id: Array.isArray(msg.profiles) ? msg.profiles[0]?.id || msg.sender_id : msg.profiles?.id || msg.sender_id,
          name: Array.isArray(msg.profiles) ? msg.profiles[0]?.name || 'Unknown' : msg.profiles?.name || 'Unknown',
          avatarUrl: Array.isArray(msg.profiles) ? msg.profiles[0]?.avatar_url : msg.profiles?.avatar_url,
          points: 0,
          badges: [],
          stats: {},
        },
        senderId: msg.sender_id,
        timestamp: new Date(msg.timestamp),
        type: 'TEXT' as const,
        text: msg.text,
        upvotes: 0,
        downvotes: 0,
        flaggedAsSimilarUserIds: [],
      }));
    } catch (error) {
      logger.error('Exception fetching DM messages', { error, userId, otherUserId });
      return [];
    }
  }

  async sendDirectMessage(
    senderId: string,
    recipientId: string,
    content: string,
    options?: { bypassPrivacy?: boolean }
  ): Promise<Message> {
    if (!options?.bypassPrivacy) {
      const { data: recipientProfile, error: recipientError } = await this.supabase
        .from('profiles')
        .select('settings')
        .eq('id', recipientId)
        .single();

      if (recipientError || !recipientProfile) {
        throw new Error('Recipient not found');
      }

      const { canRecipientReceiveDirectMessage } = await import('../utils/userSettingsPolicy');
      const dmPolicy = await canRecipientReceiveDirectMessage(
        this.supabase,
        senderId,
        recipientId,
        recipientProfile.settings
      );
      if (!dmPolicy.allowed) {
        throw new Error(dmPolicy.reason || 'Direct messages are not allowed');
      }
    }

    // Create thread ID from sorted user IDs
    const sortedIds = [senderId, recipientId].sort();
    const threadId = sortedIds.join('-');

    try {
      // Ensure thread exists (upsert)
      const { error: threadError } = await this.supabase
        .from('dm_threads')
        .upsert({
          id: threadId,
          participant_ids: sortedIds,
          participants: {},
          last_message: content,
          last_message_time: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (threadError) {
        logger.error('Error creating/updating DM thread', { error: threadError });
        throw new Error(`Failed to create DM thread: ${threadError.message}`);
      }

      // Insert the message
      const { data, error } = await this.supabase
        .from('dm_messages')
        .insert({
          thread_id: threadId,
          sender_id: senderId,
          text: content,
        })
        .select(`
          id,
          thread_id,
          sender_id,
          text,
          timestamp,
          profiles:sender_id (
            id,
            name,
            avatar_url
          )
        `)
        .single();

      if (error) {
        logger.error('Error inserting DM message', { error });
        throw new Error(`Failed to send DM: ${error.message}`);
      }

      // Un-archive for recipient and update thread's last message
      const { data: threadRow } = await this.supabase
        .from('dm_threads')
        .select('archived_by')
        .eq('id', threadId)
        .single();

      const archivedBy: string[] = Array.isArray(threadRow?.archived_by) ? threadRow.archived_by : [];
      const updatedArchivedBy = archivedBy.filter((id: string) => id !== recipientId);

      await this.supabase
        .from('dm_threads')
        .update({
          last_message: content,
          last_message_time: new Date().toISOString(),
          archived_by: updatedArchivedBy,
        })
        .eq('id', threadId);

      const senderProfile = Array.isArray(data.profiles)
        ? (data.profiles as unknown as any[])[0]
        : (data.profiles as unknown as any);
      const senderName = senderProfile?.name || 'Someone';
      const preview = content.length > 80 ? `${content.slice(0, 80)}…` : content;

      void this.createNotification(recipientId, {
        message: `${senderName} sent you a message`,
        link: `dm:${threadId}:${senderId}`,
        type: 'dm_message',
        data: { threadId, senderId, preview },
      }).catch((err) => {
        logger.error('Failed to create DM notification', { error: err, recipientId, threadId });
      });

      return {
        id: data.id,
        sender: {
          id: Array.isArray(data.profiles) ? (data.profiles as unknown as any[])[0]?.id || data.sender_id : (data.profiles as unknown as any)?.id || data.sender_id,
          name: Array.isArray(data.profiles) ? (data.profiles as unknown as any[])[0]?.name || 'Unknown' : (data.profiles as unknown as any)?.name || 'Unknown',
          avatarUrl: Array.isArray(data.profiles) ? (data.profiles as unknown as any[])[0]?.avatar_url : (data.profiles as unknown as any)?.avatar_url,
          points: 0,
          badges: [],
          stats: {},
        },
        senderId: data.sender_id,
        recipientId,
        timestamp: new Date(data.timestamp),
        type: 'TEXT' as const,
        text: data.text,
        upvotes: 0,
        downvotes: 0,
        flaggedAsSimilarUserIds: [],
      };
    } catch (error: any) {
      logger.error('Exception sending DM', { error: error.message, senderId, recipientId });
      throw error;
    }
  }

  async searchMessages(query: string, options: {
    groupId?: string;
    userId?: string;
    limit?: number;
    requestingUserId?: string;
  } = {}): Promise<Message[]> {
    const { groupId, userId, limit = 50, requestingUserId } = options;

    // Build search query
    let searchQuery = this.supabase
      .from('messages')
      .select(`
        id,
        group_id,
        sender_id,
        type,
        text,
        question_data,
        flagged_as_similar_user_ids,
        timestamp,
        profiles!sender_id (
          id,
          name,
          avatar_url
        )
      `)
      .ilike('text', `%${query}%`)
      .limit(limit);

    if (groupId) {
      searchQuery = searchQuery.eq('group_id', groupId);
    }

    if (userId) {
      searchQuery = searchQuery.eq('sender_id', userId);
    }

    // If requesting user is specified, only search in groups they're members of
    if (requestingUserId && !groupId) {
      const { data: memberGroups, error: memberError } = await this.supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', requestingUserId);

      if (memberError) throw memberError;

      const groupIds = memberGroups?.map(mg => mg.group_id) || [];
      if (groupIds.length === 0) return [];

      searchQuery = searchQuery.in('group_id', groupIds);
    }

    const { data, error } = await searchQuery.order('timestamp', { ascending: false });

    if (error) throw error;

    return (data || []).map((msg: any) => ({
      id: msg.id,
      groupId: msg.group_id,
      sender: {
        id: msg.profiles?.id || msg.sender_id,
        name: msg.profiles?.name || 'Unknown',
        avatarUrl: msg.profiles?.avatar_url,
        points: 0,
        badges: [],
        stats: {},
      },
      senderId: msg.sender_id,
      timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
      flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
      upvotes: 0,
      downvotes: 0,
      ...this.normalizeMessageRecord(msg),
    }));
  }

  // Notification Methods for API Routes
  async getUserNotifications(userId: string, options: {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
  } = {}): Promise<Notification[]> {
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `notifications:${userId}:${page}:${limit}:${unreadOnly}`;

    return cacheService.cached(cacheKey, async () => {
      let query = this.supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId);

      if (unreadOnly) {
        query = query.eq('read', false);
      }

      const { data, error } = await query
        .order('date', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return data || [];
    }, { ttl: 120 }); // Cache for 2 minutes
  }

  async getNotificationById(notificationId: string, userId?: string): Promise<Notification | null> {
    const cacheKey = `notification:${notificationId}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('notifications')
        .select('*')
        .eq('id', notificationId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      // Check if notification belongs to user
      if (userId && data.user_id !== userId) {
        return null; // Access denied
      }

      return data;
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async createNotification(userId: string, notificationData: {
    message: string;
    link?: string;
    type?: string;
    data?: Record<string, unknown>;
    force?: boolean;
  }): Promise<Notification | null> {
    if (!notificationData.force) {
      const { data: profile, error: profileError } = await this.supabase
        .from('profiles')
        .select('settings')
        .eq('id', userId)
        .single();

      if (!profileError && profile) {
        const { shouldCreateInAppNotification } = await import('../utils/userSettingsPolicy');
        if (!shouldCreateInAppNotification(profile.settings, notificationData.type)) {
          return null;
        }
      }
    }

    const { data, error } = await this.supabase
      .from('notifications')
      .insert({
        user_id: userId,
        message: notificationData.message,
        link: notificationData.link,
        type: notificationData.type || 'info',
        data: notificationData.data || {},
        read: false,
      })
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await cacheService.delete(`notifications:stats:${userId}`);

    void this.sendExpoPushForNotification(userId, notificationData);

    return data;
  }

  async markNotificationAsRead(notificationId: string): Promise<Notification | null> {
    const { data, error } = await this.supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    // Invalidate caches
    await cacheService.delete(`notification:${notificationId}`);
    await cacheService.deletePattern(`notifications:${data.user_id}:*`);
    await cacheService.delete(`notifications:stats:${data.user_id}`);

    return data;
  }

  async markAllNotificationsAsRead(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)
      .select('id');

    if (error) throw error;

    const updatedCount = data?.length || 0;

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await cacheService.delete(`notifications:stats:${userId}`);

    return updatedCount;
  }

  async deleteNotification(notificationId: string): Promise<boolean> {
    // Get notification first to know which user to invalidate
    const { data: notification, error: fetchError } = await this.supabase
      .from('notifications')
      .select('user_id')
      .eq('id', notificationId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') return false; // Not found
      throw fetchError;
    }

    const { error } = await this.supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`notification:${notificationId}`);
    await cacheService.deletePattern(`notifications:${notification.user_id}:*`);
    await cacheService.delete(`notifications:stats:${notification.user_id}`);

    return true;
  }

  async deleteAllNotifications(userId: string): Promise<number> {
    // Count notifications first
    const { count, error: countError } = await this.supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) throw countError;

    // Delete all notifications for user
    const { error } = await this.supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`notifications:${userId}:*`);
    await cacheService.deletePattern(`notification:*`);
    await cacheService.delete(`notifications:stats:${userId}`);

    return count || 0;
  }

  async getNotificationStats(userId: string): Promise<{
    total: number;
    unread: number;
    read: number;
  }> {
    const cacheKey = `notifications:stats:${userId}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('notifications')
        .select('read')
        .eq('user_id', userId);

      if (error) throw error;

      const total = data?.length || 0;
      const unread = data?.filter(n => !n.read).length || 0;
      const read = total - unread;

      return { total, unread, read };
    }, { ttl: 60 }); // Cache for 1 minute
  }

  async createBulkNotifications(notifications: Array<{
    userId: string;
    message: string;
    link?: string;
    type?: string;
  }>): Promise<Notification[]> {
    const notificationsToInsert = notifications.map(n => ({
      user_id: n.userId,
      message: n.message,
      link: n.link,
      type: n.type || 'info',
      read: false,
    }));

    const { data, error } = await this.supabase
      .from('notifications')
      .insert(notificationsToInsert)
      .select();

    if (error) throw error;

    // Invalidate caches for affected users
    const affectedUserIds = [...new Set(notifications.map(n => n.userId))];
    for (const userId of affectedUserIds) {
      await cacheService.deletePattern(`notifications:${userId}:*`);
    }

    return data || [];
  }

  // Test Methods for API Routes
  async getUserTests(userId: string, options: {
    page?: number;
    limit?: number;
    status?: string;
    subject?: string;
  } = {}): Promise<any[]> {
    const { page = 1, limit = 20, status, subject } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `tests:${userId}:${page}:${limit}:${status || ''}:${subject || ''}`;

    return cacheService.cached(cacheKey, async () => {
      // Join with test_results to get score data
      let query = this.supabase
        .from('test_sessions')
        .select(`
          *,
          test_results (
            score,
            correct_answers_count,
            total_questions
          )
        `)
        .eq('user_id', userId);

      // Filter by status (derive from end_time)
      if (status === 'completed') {
        query = query.not('end_time', 'is', null);
      } else if (status === 'in_progress') {
        query = query.is('end_time', null).not('start_time', 'is', null);
      } else if (status === 'not_started') {
        query = query.is('start_time', null);
      }

      // Filter by subject (from config)
      if (subject) {
        query = query.eq('config->>subject', subject);
      }

      const { data, error } = await query
        .order('start_time', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Transform to TestResult format expected by frontend
      return (data || []).map((session: any) => {
        // Get score from joined test_results (may be array or single object)
        const result = Array.isArray(session.test_results) 
          ? session.test_results[0] 
          : session.test_results;
        
        return {
          session: {
            id: session.id,
            config: session.config || {},
            questions: session.questions || [],
            userAnswers: session.user_answers || {},
            currentQuestionIndex: 0,
            startTime: session.start_time ? new Date(session.start_time) : new Date(),
            endTime: session.end_time ? new Date(session.end_time) : undefined,
            isOffline: session.is_offline || false,
          },
          score: result?.score || 0,
          totalQuestions: result?.total_questions || session.questions?.length || 0,
          correctAnswersCount: result?.correct_answers_count || 0,
        };
      });
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async getTestById(testId: string, userId?: string): Promise<any | null> {
    const cacheKey = userId ? `test:${testId}:user:${userId}` : `test:${testId}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('test_sessions')
        .select('*')
        .eq('id', testId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      // Check if test belongs to user
      if (userId && data.user_id !== userId) {
        return null; // Access denied
      }

      return data;
    }, { ttl: 600 }); // Cache for 10 minutes
  }

  async createTest(testConfig: any, userId: string): Promise<any> {
    // Check if this is a completed test session (has questions and user_answers)
    const isCompletedSession = testConfig.questions && testConfig.questions.length > 0;
    
    const insertData: any = {
      user_id: userId,
    };

    if (isCompletedSession) {
      // This is a completed test being saved
      insertData.config = testConfig.config || testConfig;
      insertData.questions = testConfig.questions || [];
      insertData.user_answers = testConfig.user_answers || {};
      insertData.start_time = testConfig.start_time;
      insertData.end_time = testConfig.end_time;
      insertData.is_offline = testConfig.is_offline || false;
    } else {
      // This is a new test configuration
      insertData.config = testConfig;
      insertData.questions = [];
      insertData.user_answers = {};
    }

    const { data, error } = await this.supabase
      .from('test_sessions')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`tests:${userId}:*`);

    return data;
  }

  async startTest(testId: string, userId: string): Promise<any | null> {
    // Get test first
    const test = await this.getTestById(testId, userId);
    if (!test) return null;

    // Check if test has already been started (has questions)
    if (test.questions && test.questions.length > 0) {
      throw new Error('Test has already been started');
    }

    // Generate questions based on config (simplified - in real app this would be more complex)
    const questions = this.generateTestQuestions(test.config);

    const { data, error } = await this.supabase
      .from('test_sessions')
      .update({
        start_time: new Date().toISOString(),
        questions,
      })
      .eq('id', testId)
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`test:${testId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);

    return data;
  }

  async submitTest(testId: string, userId: string, answers: any[]): Promise<any> {
    // Get test first
    const test = await this.getTestById(testId, userId);
    if (!test) throw new Error('Test not found');

    // Check if test has already been completed
    if (test.end_time) {
      throw new Error('Test has already been completed');
    }

    // Calculate score
    const score = this.calculateTestScore(test.questions, answers);

    const { data, error } = await this.supabase
      .from('test_sessions')
      .update({
        end_time: new Date().toISOString(),
        user_answers: answers,
      })
      .eq('id', testId)
      .select()
      .single();

    if (error) throw error;

    // Create test result
    const { error: resultError } = await this.supabase
      .from('test_results')
      .insert({
        session_id: testId,
        score,
        total_questions: test.questions.length,
        correct_answers_count: score / 100 * test.questions.length,
      });

    if (resultError) throw resultError;

    // Update user stats
    await this.updateUserStats(userId, score);

    // Invalidate caches
    await cacheService.delete(`test:${testId}`);
    await cacheService.deletePattern(`tests:${userId}:*`);
    await cacheService.delete(`user:stats:${userId}`);

    return {
      test: data,
      score,
      totalQuestions: test.questions.length,
      correctAnswers: Math.round(score / 100 * test.questions.length),
    };
  }

  async createTestResult(testId: string, resultData: {
    score: number;
    correctAnswersCount: number;
    totalQuestions: number;
    activityDate?: string;
  }, userId?: string): Promise<any> {
    let score = resultData.score;
    let correctAnswersCount = resultData.correctAnswersCount;
    let totalQuestions = resultData.totalQuestions;

    const test = userId ? await this.getTestById(testId, userId) : await this.getTestById(testId);
    if (test?.questions?.length && test.user_answers?.length) {
      score = this.calculateTestScore(test.questions, test.user_answers);
      totalQuestions = test.questions.length;
      correctAnswersCount = Math.round((score / 100) * totalQuestions);
    }

    const { data, error } = await this.supabase
      .from('test_results')
      .insert({
        session_id: testId,
        score,
        correct_answers_count: correctAnswersCount,
        total_questions: totalQuestions,
      })
      .select()
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`test:results:${testId}`);

    let gamification:
      | { points: number; badges: User['badges']; stats: UserStats; awardedBadges: User['badges'] }
      | undefined;
    if (userId) {
      try {
        gamification = await this.applyTestCompletionGamification(
          userId,
          score,
          resultData.activityDate
        );
        await cacheService.invalidateUserCache(userId);
      } catch (err) {
        logger.warn('Test result gamification sync failed', { userId, testId, err });
      }
    }

    return gamification ? { ...data, gamification } : data;
  }

  async getTestResults(testId: string, userId?: string): Promise<any | null> {
    const cacheKey = `test:results:${testId}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('test_results')
        .select('*')
        .eq('session_id', testId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
      }

      // Check access if userId provided
      if (userId) {
        const test = await this.getTestById(testId, userId);
        if (!test) return null;
      }

      return data;
    }, { ttl: 1800 }); // Cache for 30 minutes
  }

  async getTestQuestions(testId: string, userId?: string): Promise<any[]> {
    const cacheKey = `test:questions:${testId}`;

    return cacheService.cached(cacheKey, async () => {
      const test = await this.getTestById(testId, userId);
      if (!test) return [];

      return test.questions || [];
    }, { ttl: 1800 }); // Cache for 30 minutes
  }

  async deleteTest(testId: string): Promise<boolean> {
    // Delete test results first
    const { error: resultsError } = await this.supabase
      .from('test_results')
      .delete()
      .eq('session_id', testId);

    if (resultsError) throw resultsError;

    // Delete the test session
    const { error } = await this.supabase
      .from('test_sessions')
      .delete()
      .eq('id', testId);

    if (error) throw error;

    // Invalidate caches
    await cacheService.delete(`test:${testId}`);
    await cacheService.delete(`test:results:${testId}`);
    await cacheService.delete(`test:questions:${testId}`);
    await cacheService.deletePattern(`tests:*`);

    return true;
  }

  async deleteCompletedTestSession(sessionId: string, userId: string): Promise<boolean> {
    const { data: session, error: fetchError } = await this.supabase
      .from('test_sessions')
      .select('id, user_id, end_time')
      .eq('id', sessionId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!session || session.user_id !== userId) return false;
    if (!session.end_time) {
      throw new Error('Cannot delete an in-progress test session');
    }

    return this.deleteTest(sessionId);
  }

  async clearCompletedTestHistory(userId: string): Promise<number> {
    const { data: sessions, error } = await this.supabase
      .from('test_sessions')
      .select('id')
      .eq('user_id', userId)
      .not('end_time', 'is', null);

    if (error) throw error;
    if (!sessions?.length) return 0;

    const sessionIds = sessions.map((row: { id: string }) => row.id);

    const { error: resultsError } = await this.supabase
      .from('test_results')
      .delete()
      .in('session_id', sessionIds);

    if (resultsError) throw resultsError;

    const { error: sessionsError } = await this.supabase
      .from('test_sessions')
      .delete()
      .in('id', sessionIds);

    if (sessionsError) throw sessionsError;

    for (const sessionId of sessionIds) {
      await cacheService.delete(`test:${sessionId}`);
      await cacheService.delete(`test:results:${sessionId}`);
      await cacheService.delete(`test:questions:${sessionId}`);
    }
    await cacheService.deletePattern(`tests:${userId}:*`);
    await cacheService.delete(`tests:stats:subject:${userId}`);
    await cacheService.deletePattern(`tests:stats:performance:${userId}:*`);
    await cacheService.delete(`user:stats:${userId}`);

    return sessionIds.length;
  }

  async getSubjectStats(userId: string): Promise<any> {
    const cacheKey = `tests:stats:subject:${userId}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('test_sessions')
        .select(`
          config,
          test_results (score)
        `)
        .eq('user_id', userId)
        .not('end_time', 'is', null); // Only completed tests

      if (error) throw error;

      // Group by subject (extract from config)
      const subjectStats: { [key: string]: any } = {};
      data?.forEach((test: any) => {
        const subject = test.config?.subject || 'General';
        const score = test.test_results?.[0]?.score;
        if (score !== undefined) {
          if (!subjectStats[subject]) {
            subjectStats[subject] = {
              subject,
              testsTaken: 0,
              averageScore: 0,
              scores: [],
            };
          }
          subjectStats[subject].testsTaken++;
          subjectStats[subject].scores.push(score);
        }
      });

      // Calculate averages
      Object.values(subjectStats).forEach((stats: any) => {
        stats.averageScore = stats.scores.reduce((sum: number, score: number) => sum + score, 0) / stats.scores.length;
        delete stats.scores;
      });

      return Object.values(subjectStats);
    }, { ttl: 600 }); // Cache for 10 minutes
  }

  async getPerformanceStats(userId: string, period: string = 'month'): Promise<any> {
    const cacheKey = `tests:stats:performance:${userId}:${period}`;

    return cacheService.cached(cacheKey, async () => {
      // Calculate date range based on period
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const { data, error } = await this.supabase
        .from('test_sessions')
        .select(`
          start_time,
          test_results (score)
        `)
        .eq('user_id', userId)
        .not('end_time', 'is', null) // Only completed tests
        .gte('start_time', startDate.toISOString());

      if (error) throw error;

      const scores = data?.map((test: any) => test.test_results?.[0]?.score).filter(score => score !== undefined) || [];
      const averageScore = scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;

      return {
        period,
        testsTaken: scores.length,
        averageScore: Math.round(averageScore * 100) / 100,
        highestScore: scores.length > 0 ? Math.max(...scores) : 0,
        lowestScore: scores.length > 0 ? Math.min(...scores) : 0,
      };
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async getTestTemplates(options: {
    page?: number;
    limit?: number;
    subject?: string;
    difficulty?: string;
  } = {}): Promise<any[]> {
    const { page = 1, limit = 20, subject, difficulty } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `tests:templates:${page}:${limit}:${subject || ''}:${difficulty || ''}`;

    return cacheService.cached(cacheKey, async () => {
      let query = this.supabase
        .from('test_templates')
        .select('*');

      if (subject) {
        query = query.eq('subject', subject);
      }

      if (difficulty) {
        query = query.eq('difficulty', difficulty);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return data || [];
    }, { ttl: 1800 }); // Cache for 30 minutes
  }

  // Gamification Methods for API Routes
  async getLeaderboard(options: {
    page?: number;
    limit?: number;
    timeframe?: string;
    metric?: string;
  } = {}): Promise<any[]> {
    const { page = 1, limit = 50, timeframe = 'all', metric = 'points' } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:leaderboard:${page}:${limit}:${timeframe}:${metric}`;

    return cacheService.cached(cacheKey, async () => {
      let query = this.supabase
        .from('profiles')
        .select('id, name, avatar_url, points, stats')
        .order('points', { ascending: false });

      // Apply timeframe filtering if needed (simplified)
      if (timeframe !== 'all') {
        // In a real implementation, you'd filter based on recent activity
        // For now, just return all users
      }

      const { data, error } = await query.range(offset, offset + limit - 1);

      if (error) throw error;

      return (data || []).map((user: any, index: number) => ({
        rank: offset + index + 1,
        user: {
          id: user.id,
          name: user.name,
          avatarUrl: user.avatar_url,
          points: user.points || 0,
          stats: user.stats || {},
        },
      }));
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async getAchievements(options: {
    page?: number;
    limit?: number;
    category?: string;
  } = {}): Promise<any[]> {
    const { page = 1, limit = 20, category } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:achievements:${page}:${limit}:${category || ''}`;

    return cacheService.cached(cacheKey, async () => {
      let query = this.supabase
        .from('achievements')
        .select('*');

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return data || [];
    }, { ttl: 1800 }); // Cache for 30 minutes
  }

  async getUserAchievements(userId: string, options: {
    page?: number;
    limit?: number;
  } = {}): Promise<any[]> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:user:achievements:${userId}:${page}:${limit}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('user_achievements')
        .select(`
          *,
          achievements (*)
        `)
        .eq('user_id', userId)
        .order('unlocked_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return data?.map((ua: any) => ({
        ...ua.achievements,
        unlockedAt: ua.unlocked_at,
        progress: ua.progress,
      })) || [];
    }, { ttl: 600 }); // Cache for 10 minutes
  }

  async awardPoints(userId: string, points: number, reason: string, source?: string): Promise<any> {
    // Get current points
    const { data: user, error: userError } = await this.supabase
      .from('profiles')
      .select('points')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    const currentPoints = user?.points || 0;
    const newPoints = currentPoints + points;

    // Update user points
    const { data, error } = await this.supabase
      .from('profiles')
      .update({ points: newPoints })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log the points transaction
    const { error: logError } = await this.supabase
      .from('points_transactions')
      .insert({
        user_id: userId,
        points,
        reason,
        source: source || 'manual',
      });

    if (logError) throw logError;

    // Invalidate caches
    await cacheService.deletePattern(`gamification:leaderboard:*`);
    await cacheService.delete(`user:stats:${userId}`);
    await cacheService.deletePattern(`gamification:user:achievements:${userId}:*`);

    return {
      userId,
      pointsAwarded: points,
      newTotal: newPoints,
      reason,
      source,
    };
  }

  async awardAchievement(userId: string, achievementId: string): Promise<any> {
    // Check if user already has this achievement
    const { data: existing, error: checkError } = await this.supabase
      .from('user_achievements')
      .select('id')
      .eq('user_id', userId)
      .eq('achievement_id', achievementId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    if (existing) {
      throw new Error('User already has this achievement');
    }

    // Award the achievement
    const { data, error } = await this.supabase
      .from('user_achievements')
      .insert({
        user_id: userId,
        achievement_id: achievementId,
        unlocked_at: new Date().toISOString(),
        progress: 100,
      })
      .select(`
        *,
        achievements (*)
      `)
      .single();

    if (error) throw error;

    // Award points for achievement if configured
    const achievement = data.achievements;
    if (achievement.points_reward) {
      await this.awardPoints(userId, achievement.points_reward, `Achievement unlocked: ${achievement.name}`, 'achievement');
    }

    // Invalidate caches
    await cacheService.deletePattern(`gamification:user:achievements:${userId}:*`);

    return {
      ...achievement,
      unlockedAt: data.unlocked_at,
      progress: data.progress,
    };
  }

  async getUserProgress(userId: string): Promise<any> {
    const cacheKey = `gamification:user:progress:${userId}`;

    return cacheService.cached(cacheKey, async () => {
      // Get user stats
      const user = await this.getUserById(userId);
      if (!user) throw new Error('User not found');

      // Get achievements progress
      const { data: achievements, error: achError } = await this.supabase
        .from('user_achievements')
        .select('achievement_id, progress')
        .eq('user_id', userId);

      if (achError) throw achError;

      // Get level info
      const level = await this.getUserLevel(userId);

      return {
        userId,
        points: user.points || 0,
        level: level.currentLevel,
        achievementsUnlocked: achievements?.length || 0,
        nextLevelPoints: level.nextLevelPoints,
        progressToNextLevel: level.progressToNextLevel,
        stats: user.stats || {},
      };
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async getGamificationStats(): Promise<any> {
    const cacheKey = 'gamification:stats';

    return cacheService.cached(cacheKey, async () => {
      // Get total users
      const { count: totalUsers, error: usersError } = await this.supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true });

      // Get total achievements unlocked
      const { count: totalAchievements, error: achError } = await this.supabase
        .from('user_achievements')
        .select('id', { count: 'exact', head: true });

      // Get total points awarded
      const { data: pointsData, error: pointsError } = await this.supabase
        .from('profiles')
        .select('points');

      if (usersError || achError || pointsError) {
        throw usersError || achError || pointsError;
      }

      const totalPoints = pointsData?.reduce((sum, user) => sum + (user.points || 0), 0) || 0;

      return {
        totalUsers: totalUsers || 0,
        totalAchievements: totalAchievements || 0,
        totalPoints,
        averagePointsPerUser: totalUsers ? totalPoints / totalUsers : 0,
      };
    }, { ttl: 600 }); // Cache for 10 minutes
  }

  async getBadges(options: {
    page?: number;
    limit?: number;
    category?: string;
  } = {}): Promise<any[]> {
    const { page = 1, limit = 20, category } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:badges:${page}:${limit}:${category || ''}`;

    return cacheService.cached(cacheKey, async () => {
      let query = this.supabase
        .from('badges')
        .select('*');

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return data || [];
    }, { ttl: 1800 }); // Cache for 30 minutes
  }

  async getUserBadges(userId: string, options: {
    page?: number;
    limit?: number;
  } = {}): Promise<any[]> {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const cacheKey = `gamification:user:badges:${userId}:${page}:${limit}`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('user_badges')
        .select(`
          *,
          badges (*)
        `)
        .eq('user_id', userId)
        .order('awarded_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return data?.map((ub: any) => ({
        ...ub.badges,
        awardedAt: ub.awarded_at,
      })) || [];
    }, { ttl: 600 }); // Cache for 10 minutes
  }

  async awardBadge(userId: string, badgeId: string): Promise<any> {
    // Check if user already has this badge
    const { data: existing, error: checkError } = await this.supabase
      .from('user_badges')
      .select('id')
      .eq('user_id', userId)
      .eq('badge_id', badgeId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') throw checkError;

    if (existing) {
      throw new Error('User already has this badge');
    }

    // Award the badge
    const { data, error } = await this.supabase
      .from('user_badges')
      .insert({
        user_id: userId,
        badge_id: badgeId,
        awarded_at: new Date().toISOString(),
      })
      .select(`
        *,
        badges (*)
      `)
      .single();

    if (error) throw error;

    // Invalidate caches
    await cacheService.deletePattern(`gamification:user:badges:${userId}:*`);

    return {
      ...data.badges,
      awardedAt: data.awarded_at,
    };
  }

  async getLevels(): Promise<any[]> {
    const cacheKey = 'gamification:levels';

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('levels')
        .select('*')
        .order('level_number', { ascending: true });

      if (error) throw error;

      return data || [];
    }, { ttl: 3600 }); // Cache for 1 hour
  }

  async getUserLevel(userId: string): Promise<any> {
    const cacheKey = `gamification:user:level:${userId}`;

    return cacheService.cached(cacheKey, async () => {
      const user = await this.getUserById(userId);
      if (!user) throw new Error('User not found');

      const points = user.points || 0;
      const levels = await this.getLevels();

      // Find current level
      let currentLevel = levels[0]; // Default to first level
      let nextLevel = null;

      for (let i = 0; i < levels.length; i++) {
        if (points >= levels[i].points_required) {
          currentLevel = levels[i];
          nextLevel = levels[i + 1] || null;
        } else {
          break;
        }
      }

      const progressToNextLevel = nextLevel
        ? ((points - currentLevel.points_required) / (nextLevel.points_required - currentLevel.points_required)) * 100
        : 100;

      return {
        currentLevel: currentLevel.level_number,
        levelName: currentLevel.name,
        currentPoints: points,
        pointsRequired: currentLevel.points_required,
        nextLevelPoints: nextLevel?.points_required || currentLevel.points_required,
        progressToNextLevel: Math.min(100, Math.max(0, progressToNextLevel)),
        rewards: currentLevel.rewards || [],
      };
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  async recordStudyActivity(
    userId: string,
    type: string,
    amount = 1,
    activityDate?: string
  ): Promise<any> {
    const vAmount = Math.max(Math.floor(Number(amount) || 1), 0);
    const activityDateStr =
      activityDate && /^\d{4}-\d{2}-\d{2}$/.test(activityDate)
        ? activityDate
        : new Date().toISOString().slice(0, 10);

    const typeIncrements = {
      test_count: type === 'test' ? vAmount : 0,
      flashcard_count: type === 'flashcard' || type === 'flashcard_new' ? vAmount : 0,
      new_flashcard_count: type === 'flashcard_new' ? vAmount : 0,
      question_count: type === 'study_question' ? vAmount : 0,
      game_count: type === 'game' ? vAmount : 0,
      daily_quiz_count: type === 'daily_quiz' ? vAmount : 0,
    };

    if (vAmount === 0) {
      const { data, error } = await this.supabase
        .from('study_activity')
        .select('*')
        .eq('user_id', userId)
        .eq('activity_date', activityDateStr)
        .maybeSingle();
      if (error) throw error;
      return data;
    }

    const { data: existing, error: readError } = await this.supabase
      .from('study_activity')
      .select('*')
      .eq('user_id', userId)
      .eq('activity_date', activityDateStr)
      .maybeSingle();
    if (readError) throw readError;

    const now = new Date().toISOString();

    if (existing) {
      const { data, error } = await this.supabase
        .from('study_activity')
        .update({
          count: (existing.count ?? 0) + vAmount,
          test_count: (existing.test_count ?? 0) + typeIncrements.test_count,
          flashcard_count: (existing.flashcard_count ?? 0) + typeIncrements.flashcard_count,
          new_flashcard_count: (existing.new_flashcard_count ?? 0) + typeIncrements.new_flashcard_count,
          question_count: (existing.question_count ?? 0) + typeIncrements.question_count,
          game_count: (existing.game_count ?? 0) + typeIncrements.game_count,
          daily_quiz_count: (existing.daily_quiz_count ?? 0) + typeIncrements.daily_quiz_count,
          updated_at: now,
        })
        .eq('user_id', userId)
        .eq('activity_date', activityDateStr)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await this.supabase
      .from('study_activity')
      .insert({
        user_id: userId,
        activity_date: activityDateStr,
        count: vAmount,
        ...typeIncrements,
        updated_at: now,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  private profileToGamificationUser(profile: Record<string, unknown>, statsOverride?: Partial<UserStats>): User {
    return {
      id: String(profile.id),
      name: String(profile.name || ''),
      email: String(profile.email || ''),
      password: '',
      phoneNumber: String(profile.phone || ''),
      avatarUrl: String(profile.avatar_url || profile.avatarUrl || ''),
      points: Number(profile.points) || 0,
      badges: (profile.badges as User['badges']) || [],
      stats: { ...initialUserStats, ...(profile.stats as UserStats), ...(statsOverride || {}) },
    } as User;
  }

  async syncGamificationProgress(
    userId: string,
    options: {
      stats?: Partial<UserStats>;
      bonusPoints?: number;
      bonusReason?: string;
      activityDate?: string;
    } = {}
  ): Promise<{ points: number; badges: User['badges']; stats: UserStats; awardedBadges: User['badges'] }> {
    const profile = await this.getUserById(userId);
    if (!profile) {
      throw new Error('User not found');
    }

    let user = this.profileToGamificationUser(profile as unknown as Record<string, unknown>, options.stats);

    if (options.bonusPoints && options.bonusPoints > 0 && options.bonusReason) {
      await this.awardPoints(userId, options.bonusPoints, options.bonusReason, 'sync_progress');
      const refreshed = await this.getUserById(userId);
      if (refreshed) {
        user = this.profileToGamificationUser(refreshed as unknown as Record<string, unknown>, options.stats);
      }
    }

    const { updatedUser, awardedBadges } = checkAndAwardBadges(user);

    await this.updateUser(userId, {
      points: updatedUser.points,
      badges: updatedUser.badges,
      stats: updatedUser.stats,
    });

    return {
      points: updatedUser.points,
      badges: updatedUser.badges,
      stats: updatedUser.stats,
      awardedBadges,
    };
  }

  async applyTestCompletionGamification(
    userId: string,
    score: number,
    activityDate?: string
  ): Promise<{ points: number; badges: User['badges']; stats: UserStats; awardedBadges: User['badges'] }> {
    const profile = await this.getUserById(userId);
    if (!profile) {
      throw new Error('User not found');
    }

    const stats = {
      ...initialUserStats,
      ...((profile.stats as UserStats) || {}),
    };
    stats.testsCompleted = (stats.testsCompleted || 0) + 1;
    if (score >= 80) {
      stats.highScoreTests = (stats.highScoreTests || 0) + 1;
    }
    if (score === 100) {
      stats.perfectScoreTests = (stats.perfectScoreTests || 0) + 1;
    }

    const result = await this.syncGamificationProgress(userId, { stats });
    await this.recordStudyActivity(userId, 'test', 1, activityDate).catch((err) => {
      logger.warn('Failed to record study activity after test', { userId, err });
    });
    await this.recomputeUserStreak(userId, activityDate).catch((err) => {
      logger.warn('Failed to recompute streak after test', { userId, err });
    });
    return result;
  }

  async touchLastSeen(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw error;
  }

  async getStudyActivity(userId: string, days = 112): Promise<Array<{
    date: string;
    count: number;
    breakdown: Partial<Record<string, number>>;
  }>> {
    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, days) + 1);
    const sinceDate = since.toISOString().slice(0, 10);

    const { data, error } = await this.supabase
      .from('study_activity')
      .select('activity_date, count, test_count, flashcard_count, new_flashcard_count, question_count, game_count, daily_quiz_count')
      .eq('user_id', userId)
      .gte('activity_date', sinceDate)
      .order('activity_date', { ascending: true });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      date: row.activity_date,
      count: row.count ?? 0,
      breakdown: {
        test: row.test_count ?? 0,
        flashcard: row.flashcard_count ?? 0,
        flashcard_new: row.new_flashcard_count ?? 0,
        study_question: row.question_count ?? 0,
        game: row.game_count ?? 0,
        daily_quiz: row.daily_quiz_count ?? 0,
      },
    }));
  }

  private parseStreakReferenceDate(referenceDate?: string): Date {
    if (referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
      const [y, m, d] = referenceDate.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }

  /** Recompute streak from study_activity (heatmap-aligned, client-local dates). */
  async recomputeUserStreak(userId: string, referenceDate?: string): Promise<{
    user_id: string;
    current_streak: number;
    longest_streak: number;
    last_login_date: string | null;
    streak_freezes: number;
    updated_at: string;
  }> {
    const STREAK_LOOKBACK_DAYS = 400;
    const activityDays = await this.getStudyActivity(userId, STREAK_LOOKBACK_DAYS);
    const ref = this.parseStreakReferenceDate(referenceDate);
    const { current, longest, lastActiveDate } = computeStudyStreak(activityDays, ref);

    const { data: existing } = await this.supabase
      .from('user_streaks')
      .select('streak_freezes, longest_streak')
      .eq('user_id', userId)
      .maybeSingle();

    const streakFreezes = existing?.streak_freezes ?? 0;
    const longestStreak = Math.max(existing?.longest_streak ?? 0, longest);

    const { data, error } = await this.supabase
      .from('user_streaks')
      .upsert({
        user_id: userId,
        current_streak: current,
        longest_streak: longestStreak,
        last_login_date: lastActiveDate,
        streak_freezes: streakFreezes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Helper methods
  private generateTestQuestions(config: any): any[] {
    // Simplified question generation - in a real app this would be more sophisticated
    const questions = [];
    const numQuestions = config.numQuestions || 10;

    for (let i = 0; i < numQuestions; i++) {
      questions.push({
        id: `q${i + 1}`,
        question: `Sample question ${i + 1}?`,
        options: ['A', 'B', 'C', 'D'],
        correctAnswer: 'A',
        subject: config.subject || 'General',
        difficulty: config.difficulty || 'medium',
      });
    }

    return questions;
  }

  private calculateTestScore(questions: any[], answers: any[]): number {
    let correct = 0;
    questions.forEach((question, index) => {
      if (answers[index] === question.correctAnswer) {
        correct++;
      }
    });
    return (correct / questions.length) * 100;
  }

  private async updateUserStats(userId: string, score: number): Promise<void> {
    // Update user stats (simplified)
    const { data: user, error: userError } = await this.supabase
      .from('profiles')
      .select('stats')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    const currentStats = user?.stats || {};
    const testsTaken = (currentStats.testsTaken || 0) + 1;
    const totalScore = (currentStats.totalScore || 0) + score;
    const averageScore = totalScore / testsTaken;

    const { error } = await this.supabase
      .from('profiles')
      .update({
        stats: {
          ...currentStats,
          testsTaken,
          totalScore,
          averageScore,
        },
      })
      .eq('id', userId);

    if (error) throw error;
  }

  // Group Functions
  async fetchGroups(userId: string): Promise<Group[]> {
    const cacheKey = `user:${userId}:groups`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('group_members')
        .select(`
          groups (
            id,
            name,
            avatar_url,
            description,
            last_message,
            last_message_time,
            admin_ids,
            permissions,
            parent_id,
            is_archived,
            invite_id,
            created_at
          )
        `)
        .eq('user_id', userId);

      if (error) throw error;
      return data.map((item: any) => item.groups);
    }, { ttl: 60 }); // Cache for 1 minute
  }

  async fetchGroupMembers(groupId: string): Promise<User[]> {
    const cacheKey = `group:${groupId}:members`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('group_members')
        .select(`
          user_id,
          profiles!user_id (
            id,
            name,
            avatar_url,
            phone
          )
        `)
        .eq('group_id', groupId);

      if (error) throw error;
      return data.map((item: any) => item.profiles);
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  // Message Functions
  async sendMessage(groupId: string, userId: string, content: string): Promise<any> {
    let messageData: any;
    let isQuestion = false;

    // First, try to parse as JSON to check if it's a question
    try {
      messageData = JSON.parse(content);
      isQuestion = messageData.type === 'QUESTION' || messageData.questionStem;
      logger.info('sendMessage: Parsed content as JSON', { 
        isQuestion, 
        type: messageData.type,
        hasQuestionStem: !!messageData.questionStem 
      });
    } catch (parseError) {
      // Not JSON, treat as text message
      logger.info('sendMessage: Content is plain text');
      isQuestion = false;
    }

    if (isQuestion) {
      // Question message
      logger.info('sendMessage: Inserting QUESTION message', { 
        groupId, 
        userId,
        questionStem: messageData.questionStem?.substring(0, 50),
        questionType: messageData.questionType
      });
      
      const { data, error } = await this.supabase
        .from('messages')
        .insert({
          group_id: groupId,
          sender_id: userId,
          type: 'QUESTION',
          question_data: messageData,
        })
        .select()
        .single();

      if (error) {
        logger.error('sendMessage: Failed to insert QUESTION message', { error });
        throw error;
      }

      logger.info('sendMessage: QUESTION message inserted successfully', { 
        messageId: data.id,
        timestamp: data.timestamp 
      });

      // Invalidate cache
      await cacheService.invalidateGroupCache(groupId);

      return data;
    } else {
      // Text message
      logger.info('sendMessage: Inserting TEXT message', { groupId, userId });
      
      const { data, error } = await this.supabase
        .from('messages')
        .insert({
          group_id: groupId,
          sender_id: userId,
          type: 'TEXT',
          text: content,
        })
        .select()
        .single();

      if (error) {
        logger.error('sendMessage: Failed to insert TEXT message', { error });
        throw error;
      }

      logger.info('sendMessage: TEXT message inserted successfully', { messageId: data.id });

      // Invalidate cache
      await cacheService.invalidateGroupCache(groupId);

      return data;
    }
  }

  async fetchMessages(groupId: string): Promise<Message[]> {
    const cacheKey = `group:${groupId}:messages`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('messages')
        .select(`
          id,
          group_id,
          sender_id,
          type,
          text,
          question_data,
          flagged_as_similar_user_ids,
          timestamp,
          upvotes,
          downvotes,
          is_archived,
          image_url,
          profiles!sender_id (
            id,
            name,
            avatar_url
          )
        `)
        .eq('group_id', groupId)
        .order('timestamp', { ascending: true });

      if (error) throw error;

      return data.map((msg: any) => ({
        id: msg.id,
        groupId: msg.group_id,
        sender: {
          id: Array.isArray(msg.profiles) ? (msg.profiles as unknown as any[])[0]?.id || msg.sender_id : (msg.profiles as unknown as any)?.id || msg.sender_id,
          name: Array.isArray(msg.profiles) ? (msg.profiles as unknown as any[])[0]?.name || 'Unknown' : (msg.profiles as unknown as any)?.name || 'Unknown',
          avatarUrl: Array.isArray(msg.profiles) ? (msg.profiles as unknown as any[])[0]?.avatar_url : (msg.profiles as unknown as any)?.avatar_url,
          points: 0,
          badges: [],
          stats: {},
        },
        timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
        flaggedAsSimilarUserIds: msg.flagged_as_similar_user_ids || [],
        upvotes: msg.upvotes || 0,
        downvotes: msg.downvotes || 0,
        isArchived: msg.is_archived || false,
        ...this.normalizeMessageRecord(msg),
      }));
    }, { ttl: 30 }); // Cache for 30 seconds
  }

  private parseMessageContent(msg: any): Partial<Message> {
    if (msg.type === 'TEXT') {
      return {
        type: 'TEXT',
        text: msg.text,
      };
    } else if (msg.type === 'QUESTION') {
      return {
        type: 'QUESTION',
        ...msg.question_data,
      };
    }
    return {};
  }

  // Test Results Functions
  async fetchTestResults(userId: string): Promise<TestResult[]> {
    const cacheKey = `user:${userId}:test-results`;

    return cacheService.cached(cacheKey, async () => {
      const { data, error } = await this.supabase
        .from('test_sessions')
        .select(`
          *,
          test_results (*)
        `)
        .eq('user_id', userId)
        .order('start_time', { ascending: false });

      if (error) throw error;

      return data.flatMap((session: any) =>
        session.test_results.map((result: any) => ({
          id: result.id,
          session: {
            ...session,
            startTime: session.start_time,
            endTime: session.end_time,
            isOffline: session.is_offline,
            config: session.config,
            questions: session.questions,
            userAnswers: session.user_answers,
          },
          score: result.score,
          totalQuestions: result.total_questions,
          correctAnswersCount: result.correct_answers_count,
        }))
      );
    }, { ttl: 300 }); // Cache for 5 minutes
  }

  // Real-time subscription helpers (for future use)
  getSupabaseClient() {
    return this.supabase;
  }

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const { data: row } = await this.supabase
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (row) return true;

    const { data: authData, error } = await this.supabase.auth.admin.getUserById(userId);
    if (error || !authData?.user) return false;
    return authData.user.app_metadata?.is_platform_admin === true;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('id')
        .limit(1);

      if (error) throw error;
      return true;
    } catch (error) {
      logger.error('Database health check failed:', error);
      return false;
    }
  }

  async verifySupabaseToken(accessToken: string): Promise<{ user: any; isValid: boolean }> {
    try {
      const { data, error } = await this.supabase.auth.getUser(accessToken);
      if (error) {
        return { user: null, isValid: false };
      }
      return { user: data.user, isValid: true };
    } catch (error) {
      logger.error('Token verification failed:', error);
      return { user: null, isValid: false };
    }
  }

  // Marketplace Methods for API Routes
  async getMarketplaceListings(options: {
    page?: number;
    limit?: number;
    category?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    location?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    responseProfile?: 'compact' | 'full';
  } = {}): Promise<any[]> {
    const {
      page = 1,
      limit = 20,
      category,
      search,
      minPrice,
      maxPrice,
      location,
      sortBy = 'created_at',
      sortOrder = 'desc',
      responseProfile = 'full',
    } = options;
    const profile = this.getResponseProfile(responseProfile);

    const offset = (page - 1) * limit;

    if (search || category || minPrice !== undefined || maxPrice !== undefined || location) {
      const { data: rpcRows, error: rpcError } = await this.supabase.rpc('marketplace_search_listings', {
        p_search: search || '',
        p_page: page,
        p_limit: limit,
        p_category: category || null,
        p_min_price: minPrice ?? null,
        p_max_price: maxPrice ?? null,
        p_location: location || null,
        p_sort_by: sortBy,
        p_sort_order: sortOrder,
      });

      if (!rpcError && rpcRows) {
        return (rpcRows as any[]).map((row) => ({
          ...row,
          seller: row.profiles || row.seller,
        }));
      }
      if (rpcError) {
        console.warn('marketplace_search_listings RPC failed, falling back to ilike query', rpcError.message);
      }
    }

    const selectClause = profile === 'compact'
      ? `
        id,
        user_id,
        category,
        title,
        price,
        location,
        images,
        created_at,
        status,
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        )
      `
      : `
        *,
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        )
      `;

    let query = this.supabase
      .from('marketplace_listings')
      .select(selectClause)
      .eq('status', 'active')
      .range(offset, offset + limit - 1);

    if (category) {
      query = query.eq('category', category);
    }

    if (search) {
      query = query.ilike('title', `%${search}%`);
    }

    if (minPrice !== undefined) {
      query = query.gte('price', minPrice);
    }

    if (maxPrice !== undefined) {
      query = query.lte('price', maxPrice);
    }

    if (location) {
      query = query.ilike('location', `%${location}%`);
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((listing: any) => this.normalizeListingRecord(listing));
  }

  async getMarketplaceCategoryAnalytics(): Promise<Array<{
    category: string;
    total: number;
    active: number;
    sold: number;
  }>> {
    const { data, error } = await this.supabase
      .from('marketplace_listings')
      .select('category, status');
    if (error) throw error;

    const counts = new Map<string, { total: number; active: number; sold: number }>();
    for (const row of data || []) {
      const category = String(row.category || 'unknown');
      const entry = counts.get(category) || { total: 0, active: 0, sold: 0 };
      entry.total += 1;
      if (row.status === 'active') entry.active += 1;
      if (row.status === 'sold') entry.sold += 1;
      counts.set(category, entry);
    }

    return Array.from(counts.entries())
      .map(([category, stats]) => ({ category, ...stats }))
      .sort((a, b) => b.total - a.total);
  }

  async getMarketplaceListingById(listingId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('marketplace_listings')
      .select(`
        *,
        seller:profiles!user_id (
          id,
          name,
          avatar_url
        )
      `)
      .eq('id', listingId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this.normalizeListingRecord(data);
  }

  async createMarketplaceListing(listingData: any, userId: string): Promise<any> {
    // Transform camelCase to snake_case for database columns
    const dbData = {
      user_id: userId,
      category: listingData.category,
      title: listingData.title,
      description: listingData.description,
      price: listingData.price,
      sale_price: listingData.sale_price ?? listingData.salePrice,
      sale_ends_at: listingData.sale_ends_at ?? listingData.saleEndsAt,
      promo_label: listingData.promo_label ?? listingData.promoLabel,
      location: listingData.location,
      images: listingData.images || [],
      category_specific_fields: listingData.categorySpecificFields || listingData.category_specific_fields || {},
      listing_kind: listingData.listing_kind || listingData.listingKind || 'single',
      bundle_items: listingData.bundle_items || listingData.bundleItems || [],
      quantity: listingData.quantity ?? null,
      status: listingData.status || 'active',
    };

    const { data, error } = await this.supabase
      .from('marketplace_listings')
      .insert(dbData)
      .select()
      .single();

    if (error) {
      logger.error('Failed to create marketplace listing:', error);
      throw error;
    }
    return data;
  }

  async updateMarketplaceListing(listingId: string, updates: any): Promise<any | null> {
    const dbUpdates: Record<string, unknown> = {};
    const assign = (key: string, ...sources: string[]) => {
      for (const source of sources) {
        if (updates?.[source] !== undefined) {
          dbUpdates[key] = updates[source];
          return;
        }
      }
    };

    assign('category', 'category');
    assign('title', 'title');
    assign('description', 'description');
    assign('price', 'price');
    assign('sale_price', 'sale_price', 'salePrice');
    assign('sale_ends_at', 'sale_ends_at', 'saleEndsAt');
    assign('promo_label', 'promo_label', 'promoLabel');
    assign('location', 'location');
    if (updates?.images !== undefined) dbUpdates.images = updates.images;
    assign('category_specific_fields', 'categorySpecificFields', 'category_specific_fields');
    assign('listing_kind', 'listing_kind', 'listingKind');
    if (updates?.bundle_items !== undefined || updates?.bundleItems !== undefined) {
      dbUpdates.bundle_items = updates.bundle_items ?? updates.bundleItems;
    }
    if (updates?.quantity !== undefined) dbUpdates.quantity = updates.quantity;
    assign('status', 'status');

    if (Object.keys(dbUpdates).length === 0) {
      return this.getMarketplaceListingById(listingId);
    }

    const { data, error } = await this.supabase
      .from('marketplace_listings')
      .update(dbUpdates)
      .eq('id', listingId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    if (updates?.status === 'sold' && data?.user_id) {
      await this.maybeLogManualSoldBudget(listingId, data.user_id);
    }

    return data;
  }

  async deleteMarketplaceListing(listingId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('marketplace_listings')
      .delete()
      .eq('id', listingId);

    if (error) throw error;
    return true;
  }

  async addMarketplaceReview(listingId: string, reviewerId: string, review: { rating: number; comment?: string }): Promise<any> {
    const { data, error } = await this.supabase
      .from('marketplace_reviews')
      .insert({
        listing_id: listingId,
        reviewer_id: reviewerId,
        rating: review.rating,
        comment: review.comment,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getMarketplaceReviews(listingId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('marketplace_reviews')
      .select(`
        id,
        listing_id,
        reviewer_id,
        rating,
        comment,
        created_at,
        profiles!reviewer_id (
          id,
          name,
          avatar_url
        )
      `)
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      listing_id: row.listing_id,
      reviewer_id: row.reviewer_id,
      rating: row.rating,
      comment: row.comment,
      created_at: row.created_at,
      reviewer: row.profiles
        ? {
            id: row.profiles.id,
            name: row.profiles.name,
            avatar_url: row.profiles.avatar_url,
          }
        : undefined,
    }));
  }

  async buyMarketplaceListingNow(
    listingId: string,
    buyerId: string,
    couponCode?: string
  ): Promise<{ order: Record<string, unknown>; budgetLogged?: boolean }> {
    const { getMarketplaceOrdersService } = await import('./marketplaceOrders');
    const order = await getMarketplaceOrdersService(this).createOrderFromBuyNow(
      listingId,
      buyerId,
      couponCode
    );
    return { order, budgetLogged: false };
  }

  async boostMarketplaceListing(
    listingId: string,
    userId: string,
    durationHours: number = 72
  ): Promise<any> {
    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) throw new Error('Listing not found');
    if (listing.user_id !== userId) throw new Error('Unauthorized: You do not own this listing');

    const existingFields =
      listing.category_specific_fields || listing.categorySpecificFields || {};
    const boostedUntil = existingFields.boosted_until as string | undefined;
    if (boostedUntil && new Date(boostedUntil) > new Date()) {
      return this.normalizeListingRecord(listing);
    }

    const { getMarketplaceSellerToolsService } = await import('./marketplaceSellerTools');
    await getMarketplaceSellerToolsService(this).consumeBoostCredit(userId);

    const newBoostedUntil = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
    const categorySpecificFields = {
      ...existingFields,
      boosted_until: newBoostedUntil,
      boost_level: 'standard',
    };

    const { data, error } = await this.supabase
      .from('marketplace_listings')
      .update({
        category_specific_fields: categorySpecificFields,
        updated_at: new Date().toISOString(),
      })
      .eq('id', listingId)
      .select('*')
      .single();

    if (error) throw error;
    return this.normalizeListingRecord(data);
  }

  async reportMarketplaceListing(listingId: string, reporterId: string, report: { reason: string; details?: string }): Promise<any> {
    const { data, error } = await this.supabase
      .from('marketplace_reports')
      .insert({
        listing_id: listingId,
        reporter_id: reporterId,
        reason: report.reason,
        details: report.details,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async initiateMarketplaceTransaction(
    listingId: string,
    buyerId: string,
    amount: number,
    source: 'buy_now' | 'offer_accept' = 'buy_now',
    options?: { skipBudgetLog?: boolean }
  ): Promise<any> {
    // Get listing to verify seller
    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) throw new Error('Listing not found');

    const { data, error } = await this.supabase
      .from('marketplace_transactions')
      .insert({
        buyer_id: buyerId,
        seller_id: listing.user_id,
        listing_id: listingId,
        amount,
      })
      .select()
      .single();

    if (error) throw error;

    if (!options?.skipBudgetLog) {
      await this.logMarketplaceBudgetTransactions({
        listingId,
        listingTitle: listing.title || 'Marketplace item',
        amount,
        sellerId: listing.user_id,
        buyerId,
        marketplaceTransactionId: data.id,
        source,
      });
    }

    return data;
  }

  async logMarketplaceBudgetTransactions(params: {
    listingId: string;
    listingTitle: string;
    amount: number;
    sellerId: string;
    buyerId?: string;
    marketplaceTransactionId?: string;
    source: 'buy_now' | 'offer_accept' | 'manual_sold';
  }): Promise<boolean> {
    const amount = Number(params.amount) || 0;
    if (amount <= 0 || !params.sellerId) return false;

    const date = new Date().toISOString().split('T')[0];
    const title = params.listingTitle || 'Marketplace item';
    const rows: Record<string, unknown>[] = [];

    if (params.marketplaceTransactionId && params.buyerId) {
      const { purchaseTxId, saleTxId } = buildMarketplaceBudgetTxIds(params.marketplaceTransactionId);
      rows.push(
        {
          id: purchaseTxId,
          user_id: params.buyerId,
          type: MARKETPLACE_BUDGET_TYPES.PURCHASE,
          amount,
          category: MARKETPLACE_BUDGET_CATEGORIES.PURCHASE,
          description: buildMarketplacePurchaseDescription(title),
          date,
        },
        {
          id: saleTxId,
          user_id: params.sellerId,
          type: MARKETPLACE_BUDGET_TYPES.SALE,
          amount,
          category: MARKETPLACE_BUDGET_CATEGORIES.SALE,
          description: buildMarketplaceSaleDescription(title),
          date,
        }
      );
    } else if (params.source === 'manual_sold') {
      rows.push({
        id: buildManualSaleBudgetTxId(params.listingId),
        user_id: params.sellerId,
        type: MARKETPLACE_BUDGET_TYPES.SALE,
        amount,
        category: MARKETPLACE_BUDGET_CATEGORIES.SALE,
        description: buildMarketplaceSaleDescription(title),
        date,
      });
    }

    if (rows.length === 0) return false;

    const { error } = await this.supabase
      .from('budget_transactions')
      .upsert(rows, { onConflict: 'id' });

    if (error) {
      logger.warn('Failed to log marketplace budget transactions', { error, source: params.source });
      return false;
    }
    return true;
  }

  async maybeLogManualSoldBudget(listingId: string, sellerId: string): Promise<boolean> {
    const { data: existingTxn } = await this.supabase
      .from('marketplace_transactions')
      .select('id')
      .eq('listing_id', listingId)
      .limit(1)
      .maybeSingle();

    if (existingTxn) return false;

    const listing = await this.getMarketplaceListingById(listingId);
    if (!listing) return false;

    return this.logMarketplaceBudgetTransactions({
      listingId,
      listingTitle: listing.title || 'Marketplace item',
      amount: Number(listing.price) || 0,
      sellerId,
      source: 'manual_sold',
    });
  }

  async finalizeOfferAcceptSale(offerId: string): Promise<{ orderId: string; budgetLogged: boolean }> {
    const { getMarketplaceOrdersService } = await import('./marketplaceOrders');
    const order = await getMarketplaceOrdersService(this).createOrderFromOfferAccept(offerId);
    return { orderId: order.id, budgetLogged: false };
  }

  // Get unread message count for a group for a specific user
  async getGroupUnreadCount(groupId: string, userId: string): Promise<number> {
    try {
      // Get user's last read timestamp for this group
      const { data: memberData, error: memberError } = await this.supabase
        .from('group_members')
        .select('last_read_at')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .single();

      if (memberError) {
        console.error('Error getting last_read_at:', memberError);
        return 0;
      }

      const lastReadAt = memberData?.last_read_at || new Date(0).toISOString();

      // Count messages after last read that were not sent by the user
      const { count, error: countError } = await this.supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', groupId)
        .neq('sender_id', userId)
        .gt('timestamp', lastReadAt);

      if (countError) {
        console.error('Error counting unread messages:', countError);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Error in getGroupUnreadCount:', error);
      return 0;
    }
  }

  // Get unread counts for all groups a user is in - OPTIMIZED: single query instead of N+1
  async getAllGroupUnreadCounts(userId: string): Promise<Record<string, number>> {
    try {
      // Use batch RPC function for single-query performance
      const { data, error } = await this.supabase
        .rpc('get_unread_counts_batch', { p_user_id: userId });

      if (error) {
        console.error('Error in batch unread counts:', error);
        if (process.env.NODE_ENV === 'production') {
          return {};
        }
        return await this.getAllGroupUnreadCountsFallback(userId);
      }

      // Convert array result to Record
      const unreadCounts: Record<string, number> = {};
      if (data && Array.isArray(data)) {
        for (const item of data) {
          unreadCounts[item.group_id] = item.unread_count || 0;
        }
      }

      return unreadCounts;
    } catch (error) {
      console.error('Error in getAllGroupUnreadCounts:', error);
      return {};
    }
  }

  // Fallback method for environments without the batch function
  private async getAllGroupUnreadCountsFallback(userId: string): Promise<Record<string, number>> {
    try {
      // Get all groups the user is a member of with their last_read_at
      const { data: memberships, error: memberError } = await this.supabase
        .from('group_members')
        .select('group_id, last_read_at')
        .eq('user_id', userId);

      if (memberError || !memberships) {
        console.error('Error getting memberships:', memberError);
        return {};
      }

      const unreadCounts: Record<string, number> = {};

      // For each group, count unread messages
      for (const membership of memberships) {
        const lastReadAt = membership.last_read_at || new Date(0).toISOString();

        const { count, error: countError } = await this.supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('group_id', membership.group_id)
          .neq('sender_id', userId)
          .gt('timestamp', lastReadAt);

        if (!countError) {
          unreadCounts[membership.group_id] = count || 0;
        }
      }

      return unreadCounts;
    } catch (error) {
      console.error('Error in getAllGroupUnreadCountsFallback:', error);
      return {};
    }
  }

  // Mark group as read for a user
  async markGroupAsRead(groupId: string, userId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('group_members')
        .update({ last_read_at: new Date().toISOString() })
        .eq('group_id', groupId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error marking group as read:', error);
        return false;
      }

      // Invalidate cache
      cacheService.delete(`group:unread:${groupId}:${userId}`);
      cacheService.delete(`user:unread:${userId}`);

      return true;
    } catch (error) {
      console.error('Error in markGroupAsRead:', error);
      return false;
    }
  }

  // Get unread DM count for a thread for a specific user
  async getDMUnreadCount(threadId: string, userId: string): Promise<number> {
    try {
      // Get user's last read timestamp for this thread
      const { data: readStatus, error: readError } = await this.supabase
        .from('dm_read_status')
        .select('last_read_at')
        .eq('thread_id', threadId)
        .eq('user_id', userId)
        .single();

      // If no read status exists, count all messages not from this user
      const lastReadAt = readStatus?.last_read_at || new Date(0).toISOString();

      // Count messages after last read that were not sent by the user
      const { count, error: countError } = await this.supabase
        .from('dm_messages')
        .select('id', { count: 'exact', head: true })
        .eq('thread_id', threadId)
        .neq('sender_id', userId)
        .gt('timestamp', lastReadAt);

      if (countError) {
        console.error('Error counting unread DMs:', countError);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('Error in getDMUnreadCount:', error);
      return 0;
    }
  }

  // Get all DM unread counts for a user - OPTIMIZED: single query instead of N+1
  async getAllDMUnreadCounts(userId: string): Promise<Record<string, number>> {
    try {
      // Use batch RPC function for single-query performance
      const { data, error } = await this.supabase
        .rpc('get_dm_unread_counts_batch', { p_user_id: userId });

      if (error) {
        console.error('Error in batch DM unread counts:', error);
        if (process.env.NODE_ENV === 'production') {
          return {};
        }
        return await this.getAllDMUnreadCountsFallback(userId);
      }

      // Convert array result to Record of unread counts
      const unreadCounts: Record<string, number> = {};
      if (data && Array.isArray(data)) {
        for (const item of data) {
          // Calculate unread based on last_read_at vs messages
          unreadCounts[item.thread_id] = item.unread_count || 0;
        }
      }

      return unreadCounts;
    } catch (error) {
      console.error('Error in getAllDMUnreadCounts:', error);
      return {};
    }
  }

  // Fallback method for environments without the batch function
  private async getAllDMUnreadCountsFallback(userId: string): Promise<Record<string, number>> {
    try {
      // Get all DM threads the user is part of
      const { data: threads, error: threadError } = await this.supabase
        .from('dm_threads')
        .select('id, participant_ids');

      if (threadError || !threads) {
        console.error('Error getting DM threads:', threadError);
        return {};
      }

      // Filter to threads that include this user
      const userThreads = threads.filter((t: any) => {
        const participantIds = t.participant_ids;
        return Array.isArray(participantIds) && participantIds.includes(userId);
      });

      const unreadCounts: Record<string, number> = {};

      for (const thread of userThreads) {
        const count = await this.getDMUnreadCount(thread.id, userId);
        unreadCounts[thread.id] = count;
      }

      return unreadCounts;
    } catch (error) {
      console.error('Error in getAllDMUnreadCountsFallback:', error);
      return {};
    }
  }

  // Mark DM thread as read for a user
  async markDMAsRead(threadId: string, userId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('dm_read_status')
        .upsert({
          thread_id: threadId,
          user_id: userId,
          last_read_at: new Date().toISOString()
        }, { onConflict: 'thread_id,user_id' });

      if (error) {
        console.error('Error marking DM as read:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in markDMAsRead:', error);
      return false;
    }
  }

  // Delete a DM thread and all associated messages (cascade)
  async deleteDmThread(threadId: string, userId: string): Promise<boolean> {
    try {
      // Verify the user is a participant of this thread
      const { data: thread, error: fetchError } = await this.supabase
        .from('dm_threads')
        .select('participant_ids')
        .eq('id', threadId)
        .single();

      if (fetchError || !thread) {
        console.error('DM thread not found:', fetchError);
        return false;
      }

      const participantIds = Array.isArray(thread.participant_ids) ? thread.participant_ids : [];
      if (!participantIds.includes(userId)) {
        console.error('User is not a participant of this DM thread');
        return false;
      }

      // Delete the thread — dm_messages, dm_read_status, marketplace_inquiries cascade
      const { error: deleteError } = await this.supabase
        .from('dm_threads')
        .delete()
        .eq('id', threadId);

      if (deleteError) {
        console.error('Error deleting DM thread:', deleteError);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in deleteDmThread:', error);
      return false;
    }
  }

  // Archive a DM thread for a specific user
  async archiveDmThread(threadId: string, userId: string): Promise<boolean> {
    try {
      const { data: thread, error: fetchError } = await this.supabase
        .from('dm_threads')
        .select('participant_ids, archived_by')
        .eq('id', threadId)
        .single();

      if (fetchError || !thread) {
        console.error('DM thread not found:', fetchError);
        return false;
      }

      const participantIds = Array.isArray(thread.participant_ids) ? thread.participant_ids : [];
      if (!participantIds.includes(userId)) {
        console.error('User is not a participant of this DM thread');
        return false;
      }

      const archivedBy = Array.isArray(thread.archived_by) ? thread.archived_by : [];
      if (archivedBy.includes(userId)) return true; // Already archived

      const { error } = await this.supabase
        .from('dm_threads')
        .update({ archived_by: [...archivedBy, userId] })
        .eq('id', threadId);

      if (error) {
        console.error('Error archiving DM thread:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error in archiveDmThread:', error);
      return false;
    }
  }

  // Unarchive a DM thread for a specific user
  async unarchiveDmThread(threadId: string, userId: string): Promise<boolean> {
    try {
      const { data: thread, error: fetchError } = await this.supabase
        .from('dm_threads')
        .select('archived_by')
        .eq('id', threadId)
        .single();

      if (fetchError || !thread) {
        console.error('DM thread not found:', fetchError);
        return false;
      }

      const archivedBy = Array.isArray(thread.archived_by) ? thread.archived_by : [];
      const { error } = await this.supabase
        .from('dm_threads')
        .update({ archived_by: archivedBy.filter((id: string) => id !== userId) })
        .eq('id', threadId);

      if (error) {
        console.error('Error unarchiving DM thread:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error in unarchiveDmThread:', error);
      return false;
    }
  }

  // ============ MARKETPLACE SELLER DASHBOARD METHODS ============

  // Get listings by seller (for seller dashboard)
  async getListingsBySeller(userId: string, status?: string): Promise<any[]> {
    let query = this.supabase
      .from('marketplace_listings')
      .select(`
        *,
        favorites_count:marketplace_favorites(count),
        inquiries_count:marketplace_inquiries(count)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Error fetching seller listings:', error);
      throw error;
    }

    // Transform the count results
    return (data || []).map(listing => this.normalizeListingRecord({
      ...listing,
      favorites_count: listing.favorites_count?.[0]?.count || 0,
      inquiries_count: listing.inquiries_count?.[0]?.count || 0
    }));
  }

  // Update listing status (active, inactive, sold)
  async updateListingStatus(listingId: string, status: string, userId: string): Promise<any> {
    // Verify ownership
    const { data: listing } = await this.supabase
      .from('marketplace_listings')
      .select('user_id, status, title')
      .eq('id', listingId)
      .single();

    if (!listing || listing.user_id !== userId) {
      throw new Error('Unauthorized: You do not own this listing');
    }

    const previousStatus = listing.status;

    const { data, error } = await this.supabase
      .from('marketplace_listings')
      .update({ status })
      .eq('id', listingId)
      .select()
      .single();

    if (error) throw error;

    if (status === 'sold') {
      await this.maybeLogManualSoldBudget(listingId, userId);
    }

    if (status === 'active' && previousStatus !== 'active') {
      const { notifyListingBackAvailable } = await import('./marketplaceFavoriteAlerts');
      await notifyListingBackAvailable(this, { id: listingId, user_id: userId, title: data.title || listing.title }, previousStatus);
    }

    return data;
  }

  // Increment view count
  async incrementListingViews(listingId: string): Promise<void> {
    try {
      const { error: rpcError } = await this.supabase.rpc('increment_listing_views', { listing_id: listingId });
      
      // Fallback if RPC doesn't exist — do a read-then-write
      if (rpcError) {
        const { data } = await this.supabase
          .from('marketplace_listings')
          .select('views_count')
          .eq('id', listingId)
          .single();

        const currentViews = data?.views_count || 0;
        await this.supabase
          .from('marketplace_listings')
          .update({ views_count: currentViews + 1 })
          .eq('id', listingId);
      }
    } catch (err) {
      logger.error('Failed to increment listing views', { listingId, error: err });
    }
  }

  // Get seller stats
  async getSellerStats(userId: string): Promise<{
    totalListings: number;
    activeListings: number;
    soldListings: number;
    completedOrders: number;
    totalViews: number;
    totalInquiries: number;
    totalFavorites: number;
  }> {
    const [listingsRes, ordersRes] = await Promise.all([
      this.supabase
        .from('marketplace_listings')
        .select(`
          id,
          status,
          views_count,
          favorites:marketplace_favorites(count),
          inquiries:marketplace_inquiries(count)
        `)
        .eq('user_id', userId),
      this.supabase
        .from('marketplace_orders')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', userId)
        .eq('status', 'completed'),
    ]);

    const { data: listings, error } = listingsRes;
    if (error) throw error;
    if (ordersRes.error) throw ordersRes.error;

    return {
      totalListings: listings?.length || 0,
      activeListings: listings?.filter(l => l.status === 'active').length || 0,
      soldListings: listings?.filter(l => l.status === 'sold').length || 0,
      completedOrders: ordersRes.count || 0,
      totalViews: listings?.reduce((sum, l) => sum + (l.views_count || 0), 0) || 0,
      totalInquiries: listings?.reduce((sum, l) => sum + (l.inquiries?.[0]?.count || 0), 0) || 0,
      totalFavorites: listings?.reduce((sum, l) => sum + (l.favorites?.[0]?.count || 0), 0) || 0,
    };
  }

  // ============ MARKETPLACE FAVORITES METHODS ============

  // Add listing to favorites
  async addFavorite(userId: string, listingId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('marketplace_favorites')
      .insert({ user_id: userId, listing_id: listingId })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Already favorited
        return { alreadyExists: true };
      }
      throw error;
    }
    return data;
  }

  // Remove listing from favorites
  async removeFavorite(userId: string, listingId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('marketplace_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('listing_id', listingId);

    if (error) throw error;
    return true;
  }

  // Get user's favorites
  async getUserFavorites(userId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('marketplace_favorites')
      .select(`
        id,
        created_at,
        listing:marketplace_listings(
          *,
          profiles!user_id(id, name, avatar_url)
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((favorite: any) => this.normalizeFavoriteRecord(favorite));
  }

  // Check if listing is favorited by user
  async isListingFavorited(userId: string, listingId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('marketplace_favorites')
      .select('id')
      .eq('user_id', userId)
      .eq('listing_id', listingId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  }

  // ============ MARKETPLACE INQUIRIES METHODS ============

  // Create an inquiry (when buyer contacts seller about a listing)
  async createInquiry(
    listingId: string,
    buyerId: string,
    sellerId: string,
    dmThreadId: string,
    initialMessage: string
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from('marketplace_inquiries')
      .insert({
        listing_id: listingId,
        buyer_id: buyerId,
        seller_id: sellerId,
        dm_thread_id: dmThreadId,
        initial_message: initialMessage,
        status: 'open'
      })
      .select(`
        *,
        listing:marketplace_listings(*),
        buyer:profiles!buyer_id(id, name, avatar_url),
        seller:profiles!seller_id(id, name, avatar_url)
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        // Inquiry already exists, return it
        return this.getInquiryByListingAndBuyer(listingId, buyerId);
      }
      throw error;
    }
    return data;
  }

  // Get inquiry by listing and buyer
  async getInquiryByListingAndBuyer(listingId: string, buyerId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('marketplace_inquiries')
      .select(`
        *,
        listing:marketplace_listings(*),
        buyer:profiles!buyer_id(id, name, avatar_url),
        seller:profiles!seller_id(id, name, avatar_url)
      `)
      .eq('listing_id', listingId)
      .eq('buyer_id', buyerId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  // Get seller's inquiries
  async getSellerInquiries(sellerId: string, status?: string): Promise<any[]> {
    let query = this.supabase
      .from('marketplace_inquiries')
      .select(`
        *,
        listing:marketplace_listings(id, title, price, images, status),
        buyer:profiles!buyer_id(id, name, avatar_url)
      `)
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((inquiry: any) => this.normalizeInquiryRecord(inquiry));
  }

  // Get buyer's inquiries
  async getBuyerInquiries(buyerId: string): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('marketplace_inquiries')
      .select(`
        *,
        listing:marketplace_listings(id, title, price, images, status),
        seller:profiles!seller_id(id, name, avatar_url)
      `)
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((inquiry: any) => this.normalizeInquiryRecord(inquiry));
  }

  // Update inquiry status
  async updateInquiryStatus(inquiryId: string, status: string, userId: string): Promise<any> {
    // Verify user is participant
    const { data: inquiry } = await this.supabase
      .from('marketplace_inquiries')
      .select('buyer_id, seller_id')
      .eq('id', inquiryId)
      .single();

    if (!inquiry || (inquiry.buyer_id !== userId && inquiry.seller_id !== userId)) {
      throw new Error('Unauthorized');
    }

    const { data, error } = await this.supabase
      .from('marketplace_inquiries')
      .update({ status })
      .eq('id', inquiryId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Get inquiry by DM thread
  async getInquiryByThread(threadId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('marketplace_inquiries')
      .select(`
        *,
        listing:marketplace_listings(id, title, price, images, status, user_id)
      `)
      .eq('dm_thread_id', threadId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data ? this.normalizeInquiryRecord(data) : data;
  }

  // ============ MARKETPLACE NOTIFICATIONS ============

  // Create notification for new inquiry
  async createInquiryNotification(sellerId: string, buyerName: string, listingTitle: string, inquiryId: string): Promise<void> {
    await this.createNotification(sellerId, {
      type: 'marketplace_inquiry',
      message: `${buyerName} is interested in your listing "${listingTitle}"`,
      link: `/marketplace/inquiries/${inquiryId}`
    });
  }

  // Create notification for listing purchase
  async createPurchaseNotification(sellerId: string, buyerName: string, listingTitle: string, transactionId: string): Promise<void> {
    await this.createNotification(sellerId, {
      type: 'marketplace_purchase',
      message: `${buyerName} purchased your listing "${listingTitle}"`,
      link: `/marketplace/transactions/${transactionId}`
    });
  }

  // ============ CUSTOM CATEGORIES ============

  async getCustomCategories(): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('custom_categories')
      .select('*')
      .order('usage_count', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async createCustomCategory(name: string, userId: string): Promise<any> {
    // Upsert: if name exists, return existing
    const { data: existing } = await this.supabase
      .from('custom_categories')
      .select('*')
      .eq('name', name)
      .single();

    if (existing) return existing;

    const { data, error } = await this.supabase
      .from('custom_categories')
      .insert({ name, created_by: userId })
      .select()
      .single();

    if (error) {
      // Handle race condition: another insert happened between select and insert
      if (error.code === '23505') {
        const { data: raceData } = await this.supabase
          .from('custom_categories')
          .select('*')
          .eq('name', name)
          .single();
        return raceData;
      }
      throw error;
    }
    return data;
  }

  async incrementCategoryUsage(categoryName: string): Promise<void> {
    // Increment usage_count by 1 for the given category
    const { data } = await this.supabase
      .from('custom_categories')
      .select('usage_count')
      .eq('name', categoryName)
      .single();

    if (data) {
      await this.supabase
        .from('custom_categories')
        .update({ usage_count: (data.usage_count || 0) + 1 })
        .eq('name', categoryName);
    }
  }

  // ============ USER PREFERENCES ============

  async getUserPreferences(userId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      logger.error('Error fetching user preferences', { userId, error });
      throw error;
    }

    return data;
  }

  async upsertUserPreferences(userId: string, prefs: { theme?: string; preferences?: Record<string, any> }): Promise<any> {
    const { data, error } = await this.supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        theme: prefs.theme || 'light',
        preferences: prefs.preferences || {},
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) {
      logger.error('Error upserting user preferences', { userId, error });
      throw error;
    }

    return data;
  }

  // ─── Notes ───────────────────────────────────────────────────

  private mapNote(row: any) {
    return {
      id: row.id,
      userId: row.user_id,
      folderId: row.folder_id || undefined,
      groupId: row.group_id || undefined,
      title: row.title,
      body: row.body || '',
      summary: row.summary || undefined,
      sourceType: row.source_type || 'typed',
      youtubeUrl: row.youtube_url || undefined,
      youtubeVideoId: row.youtube_video_id || undefined,
      isShared: row.is_shared || false,
      shareToken: row.share_token || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapNoteFolder(row: any) {
    return {
      id: row.id,
      userId: row.user_id,
      groupId: row.group_id || undefined,
      parentId: row.parent_id || undefined,
      name: row.name,
      color: row.color || '#6366f1',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getNoteFolders(userId: string) {
    const { data, error } = await this.supabase
      .from('note_folders')
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map((row: any) => this.mapNoteFolder(row));
  }

  async createNoteFolder(userId: string, payload: { name: string; color?: string; groupId?: string; parentId?: string }) {
    const { data, error } = await this.supabase
      .from('note_folders')
      .insert({
        user_id: userId,
        name: payload.name,
        color: payload.color || '#6366f1',
        group_id: payload.groupId || null,
        parent_id: payload.parentId || null,
      })
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteFolder(data);
  }

  async updateNoteFolder(userId: string, folderId: string, updates: { name?: string; color?: string }) {
    const { data, error } = await this.supabase
      .from('note_folders')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', folderId)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteFolder(data);
  }

  async deleteNoteFolder(userId: string, folderId: string) {
    const { error } = await this.supabase
      .from('note_folders')
      .delete()
      .eq('id', folderId)
      .eq('user_id', userId);
    if (error) throw error;
    return true;
  }

  async getNotes(userId: string, options?: { folderId?: string; groupId?: string }) {
    let query = this.supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (options?.folderId) query = query.eq('folder_id', options.folderId);
    if (options?.groupId) query = query.eq('group_id', options.groupId);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((row: any) => this.mapNote(row));
  }

  async getNote(noteId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('notes')
      .select('*')
      .eq('id', noteId)
      .single();
    if (error) throw error;
    if (data.user_id !== userId) {
      const { data: collab } = await this.supabase
        .from('note_collaborators')
        .select('role')
        .eq('note_id', noteId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!collab && data.group_id) {
        const { data: member } = await this.supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', data.group_id)
          .eq('user_id', userId)
          .maybeSingle();
        if (!member) throw new Error('Note not found or access denied');
      } else if (!collab) {
        throw new Error('Note not found or access denied');
      }
    }
    return this.mapNote(data);
  }

  async createNote(userId: string, payload: {
    title?: string;
    body?: string;
    folderId?: string;
    groupId?: string;
    sourceType?: string;
    youtubeUrl?: string;
    youtubeVideoId?: string;
    summary?: string;
  }) {
    const { data, error } = await this.supabase
      .from('notes')
      .insert({
        user_id: userId,
        title: payload.title || 'Untitled Note',
        body: payload.body || '',
        folder_id: payload.folderId || null,
        group_id: payload.groupId || null,
        source_type: payload.sourceType || 'typed',
        youtube_url: payload.youtubeUrl || null,
        youtube_video_id: payload.youtubeVideoId || null,
        summary: payload.summary || null,
      })
      .select()
      .single();
    if (error) throw error;
    return this.mapNote(data);
  }

  async updateNote(userId: string, noteId: string, updates: Record<string, unknown>) {
    const dbUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.body !== undefined) dbUpdates.body = updates.body;
    if (updates.summary !== undefined) dbUpdates.summary = updates.summary;
    if (updates.folderId !== undefined) dbUpdates.folder_id = updates.folderId || null;
    if (updates.groupId !== undefined) dbUpdates.group_id = updates.groupId || null;
    if (updates.isShared !== undefined) dbUpdates.is_shared = updates.isShared;
    if (updates.youtubeUrl !== undefined) dbUpdates.youtube_url = updates.youtubeUrl;
    if (updates.youtubeVideoId !== undefined) dbUpdates.youtube_video_id = updates.youtubeVideoId;

    const { data, error } = await this.supabase
      .from('notes')
      .update(dbUpdates)
      .eq('id', noteId)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return this.mapNote(data);
  }

  async deleteNote(userId: string, noteId: string) {
    const { error } = await this.supabase
      .from('notes')
      .delete()
      .eq('id', noteId)
      .eq('user_id', userId);
    if (error) throw error;
    return true;
  }

  async getNoteAttachment(noteId: string, attachmentId: string) {
    const { data, error } = await this.supabase
      .from('note_attachments')
      .select('*')
      .eq('note_id', noteId)
      .eq('id', attachmentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      noteId: data.note_id,
      type: data.type,
      fileUrl: data.file_url || undefined,
      fileName: data.file_name || undefined,
      extractedText: data.extracted_text || undefined,
      metadata: data.metadata || {},
      createdAt: data.created_at,
    };
  }

  async updateNoteAttachment(
    attachmentId: string,
    updates: { metadata?: Record<string, unknown>; extractedText?: string }
  ) {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;
    if (updates.extractedText !== undefined) dbUpdates.extracted_text = updates.extractedText;

    const { data, error } = await this.supabase
      .from('note_attachments')
      .update(dbUpdates)
      .eq('id', attachmentId)
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      noteId: data.note_id,
      type: data.type,
      fileUrl: data.file_url || undefined,
      fileName: data.file_name || undefined,
      extractedText: data.extracted_text || undefined,
      metadata: data.metadata || {},
      createdAt: data.created_at,
    };
  }

  async uploadNoteFile(params: {
    storagePath: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<{ path: string }> {
    const bucket = 'note-files';
    const attemptUpload = async () =>
      this.supabase.storage.from(bucket).upload(params.storagePath, params.buffer, {
        contentType: params.contentType,
        cacheControl: '3600',
        upsert: false,
      });

    let uploadResult = await attemptUpload();
    if (
      uploadResult.error &&
      typeof uploadResult.error.message === 'string' &&
      uploadResult.error.message.toLowerCase().includes('bucket') &&
      uploadResult.error.message.toLowerCase().includes('not found')
    ) {
      await this.supabase.storage.createBucket(bucket, { public: false });
      uploadResult = await attemptUpload();
    }

    const { error } = uploadResult;
    if (error) {
      logger.error('Error uploading note file:', { error, path: params.storagePath });
      throw new Error(error.message);
    }
    return { path: params.storagePath };
  }

  async createSignedNoteFileUrl(storagePath: string, expiresInSeconds = 60 * 60 * 24): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from('note-files')
      .createSignedUrl(storagePath, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || 'Failed to create signed URL');
    }
    return data.signedUrl;
  }

  async deleteNoteFile(storagePath: string): Promise<void> {
    const { error } = await this.supabase.storage.from('note-files').remove([storagePath]);
    if (error) {
      logger.warn('Failed to delete note file from storage', { error, storagePath });
    }
  }

  async downloadNoteFile(storagePath: string): Promise<{ buffer: Buffer; contentType: string }> {
    const { data, error } = await this.supabase.storage.from('note-files').download(storagePath);
    if (error || !data) {
      throw new Error(error?.message || 'Failed to download note file');
    }
    const arrayBuffer = await data.arrayBuffer();
    const lower = storagePath.toLowerCase();
    let contentType = 'application/octet-stream';
    if (lower.endsWith('.pdf')) contentType = 'application/pdf';
    else if (lower.endsWith('.pptx')) {
      contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    } else if (lower.endsWith('.ppt')) contentType = 'application/vnd.ms-powerpoint';
    return { buffer: Buffer.from(arrayBuffer), contentType };
  }

  resolveNoteAttachmentStoragePath(attachment: {
    fileUrl?: string;
    metadata?: Record<string, unknown>;
    type?: string;
  }): string | null {
    const meta = attachment.metadata || {};
    if (typeof meta.previewStoragePath === 'string' && meta.previewStoragePath) {
      return meta.previewStoragePath;
    }
    if (typeof meta.storagePath === 'string' && meta.storagePath) {
      return meta.storagePath;
    }
    if (!attachment.fileUrl) return null;
    try {
      const url = new URL(attachment.fileUrl);
      const marker = '/storage/v1/object/';
      const idx = url.pathname.indexOf(marker);
      if (idx === -1) return null;
      let after = url.pathname.slice(idx + marker.length);
      if (after.startsWith('sign/')) after = after.slice('sign/'.length);
      if (after.startsWith('public/')) after = after.slice('public/'.length);
      const parts = after.split('/');
      if (parts.length < 2) return null;
      const bucket = parts[0];
      if (bucket !== 'note-files') return null;
      return decodeURIComponent(parts.slice(1).join('/'));
    } catch {
      return null;
    }
  }

  async getNoteAttachments(noteId: string) {
    const { data, error } = await this.supabase
      .from('note_attachments')
      .select('*')
      .eq('note_id', noteId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      noteId: row.note_id,
      type: row.type,
      fileUrl: row.file_url || undefined,
      fileName: row.file_name || undefined,
      extractedText: row.extracted_text || undefined,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    }));
  }

  async addNoteAttachment(noteId: string, payload: {
    type: string;
    fileUrl?: string;
    fileName?: string;
    extractedText?: string;
    metadata?: Record<string, unknown>;
  }) {
    const { data, error } = await this.supabase
      .from('note_attachments')
      .insert({
        note_id: noteId,
        type: payload.type,
        file_url: payload.fileUrl || null,
        file_name: payload.fileName || null,
        extracted_text: payload.extractedText || null,
        metadata: payload.metadata || {},
      })
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      noteId: data.note_id,
      type: data.type,
      fileUrl: data.file_url || undefined,
      fileName: data.file_name || undefined,
      extractedText: data.extracted_text || undefined,
      metadata: data.metadata || {},
      createdAt: data.created_at,
    };
  }

  async getNoteCollaborators(noteId: string) {
    const { data, error } = await this.supabase
      .from('note_collaborators')
      .select('*, profiles(id, name, avatar_url)')
      .eq('note_id', noteId);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      noteId: row.note_id,
      userId: row.user_id,
      role: row.role,
      addedAt: row.added_at,
      user: row.profiles ? { id: row.profiles.id, name: row.profiles.name, avatarUrl: row.profiles.avatar_url } : undefined,
    }));
  }

  async addNoteCollaborator(noteId: string, ownerId: string, collaboratorUserId: string, role: string = 'editor') {
    const note = await this.getNote(noteId, ownerId);
    if (note.userId !== ownerId) throw new Error('Only the note owner can add collaborators');

    const resolvedUserId = await this.resolveCollaboratorUserId(collaboratorUserId);
    if (resolvedUserId === ownerId) {
      throw new Error('You cannot add yourself as a collaborator.');
    }

    const { data, error } = await this.supabase
      .from('note_collaborators')
      .upsert({
        note_id: noteId,
        user_id: resolvedUserId,
        role,
      })
      .select()
      .single();
    if (error) throw error;
    return { noteId: data.note_id, userId: data.user_id, role: data.role, addedAt: data.added_at };
  }

  async removeNoteCollaborator(noteId: string, ownerId: string, collaboratorUserId: string) {
    const note = await this.getNote(noteId, ownerId);
    if (note.userId !== ownerId) throw new Error('Only the note owner can remove collaborators');

    const { error } = await this.supabase
      .from('note_collaborators')
      .delete()
      .eq('note_id', noteId)
      .eq('user_id', collaboratorUserId);
    if (error) throw error;
    return true;
  }

  async getNoteComments(noteId: string) {
    const { data, error } = await this.supabase
      .from('note_comments')
      .select('*, profiles(id, name, avatar_url)')
      .eq('note_id', noteId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      noteId: row.note_id,
      userId: row.user_id,
      comment: row.comment,
      createdAt: row.created_at,
      resolved: row.resolved,
      user: row.profiles ? { id: row.profiles.id, name: row.profiles.name, avatarUrl: row.profiles.avatar_url } : undefined,
    }));
  }

  async addNoteComment(noteId: string, userId: string, comment: string) {
    const { data, error } = await this.supabase
      .from('note_comments')
      .insert({ note_id: noteId, user_id: userId, comment })
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      noteId: data.note_id,
      userId: data.user_id,
      comment: data.comment,
      createdAt: data.created_at,
      resolved: data.resolved,
    };
  }

  async shareNoteWithGroup(noteId: string, userId: string, groupId: string) {
    return this.updateNote(userId, noteId, { groupId, isShared: true });
  }

  private mapNoteQuiz(row: any) {
    return {
      date: String(row.updated_at || row.created_at || '').slice(0, 10),
      noteId: row.note_id,
      questions: Array.isArray(row.questions) ? row.questions : [],
      answers: row.answers && typeof row.answers === 'object' ? row.answers : {},
      completed: Boolean(row.completed),
      studyGoal: row.study_goal || 'retention',
    };
  }

  async getNoteQuiz(userId: string, noteId: string) {
    await this.getNote(noteId, userId);
    const { data, error } = await this.supabase
      .from('note_quizzes')
      .select('*')
      .eq('note_id', noteId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.mapNoteQuiz(data) : null;
  }

  async upsertNoteQuiz(
    userId: string,
    noteId: string,
    payload: {
      studyGoal: string;
      questions: unknown[];
    }
  ) {
    await this.getNote(noteId, userId);
    const { data, error } = await this.supabase
      .from('note_quizzes')
      .upsert(
        {
          note_id: noteId,
          user_id: userId,
          study_goal: payload.studyGoal,
          questions: payload.questions,
          answers: {},
          completed: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'note_id,user_id' }
      )
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteQuiz(data);
  }

  async updateNoteQuiz(
    userId: string,
    noteId: string,
    updates: { answers?: Record<string, string>; completed?: boolean }
  ) {
    await this.getNote(noteId, userId);
    const dbUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.answers !== undefined) dbUpdates.answers = updates.answers;
    if (updates.completed !== undefined) dbUpdates.completed = updates.completed;

    const { data, error } = await this.supabase
      .from('note_quizzes')
      .update(dbUpdates)
      .eq('note_id', noteId)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return this.mapNoteQuiz(data);
  }
}

// Configuration - do NOT create singleton at module level
// The server.ts initializes the service with proper config
// export const supabaseService = new SupabaseService(dbConfig);
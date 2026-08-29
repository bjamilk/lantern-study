import type { ApiClient } from "./client";
import { createIdempotencyKey } from "./idempotency";
import {
  listingsCacheKey,
  marketplaceCategoryAnalyticsCache,
  marketplaceListingsCache,
  parseRetryAfterMs,
  RateLimitError,
} from "./marketplaceCache";
import { retryUncertainDelivery } from "../utils/deliveryIntegrity";
import type {
  StudyPackContentInput,
  StudyPackCounts,
  StudyPackDraft,
  StudyPackDraftSummary,
  SemesterPackProposalResponse,
} from "../marketplace/studyPacks";
import type {
  Community,
  CommunityDetail,
  DiscoverGroup,
  DiscoverPerson,
  ExamReadiness,
  FeedPage,
  LearningConnectionSummary,
  MasteryGraph,
  MyCommunity,
  PresenceSnapshot,
  ReferralSummary,
  TopicMastery,
} from "../network";
import type {
  Concept,
  ConceptLink,
  ContentReport,
  ContentReportReason,
  ContentReportStatus,
  ContentReportTargetType,
  Course,
  LibraryOverview,
  LibrarySearchResult,
  LibrarySearchType,
  ListingAppealStatus,
  ListingRightsStatus,
  ModerationFlag,
  ModerationState,
  ModerationStrike,
  UserCourse,
} from "../types";

type ChatMessageMutationPayload = {
  id: string;
  groupId?: string;
  threadId?: string;
  senderId: string;
  timestamp: string;
  type: "TEXT";
  text?: string;
  editedAt?: string;
  removedAt?: string;
  isRemoved?: boolean;
};

export function createApiEndpoints(client: ApiClient) {
  const apiRequest = <T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs?: number,
  ) => client.request<T>(endpoint, options, timeoutMs);

  const apiRequestRaw = <T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs?: number,
  ) => client.requestRaw<T>(endpoint, options, timeoutMs);

  return {
    // ========== DECK API ==========

    fetchDecks: (
      userId: string,
      options?: {
        includeShared?: boolean;
        /** Course filter; pass the literal 'null' for unfiled decks. */
        courseId?: string | null;
        /** Topic filter within the course; the literal 'null' is "under no topic". */
        topicId?: string | null;
      },
    ) => {
      const params = new URLSearchParams({ userId });
      if (options?.includeShared) params.set("includeShared", "true");
      if (options?.courseId != null) params.set("courseId", String(options.courseId));
      if (options?.topicId != null) params.set("topicId", String(options.topicId));
      params.set("limit", "50");
      return apiRequest<
        Array<{
          id: string;
          name: string;
          description?: string;
          user_id: string;
          is_shared?: boolean;
          course_id?: string | null;
          topic_id?: string | null;
          created_at: string;
          updated_at: string;
          card_count?: number;
        }>
      >(`/decks?${params.toString()}`);
    },

    createDeck: (
      userId: string,
      data: {
        name: string;
        description?: string;
        courseId?: string | null;
        topicId?: string | null;
      },
    ) =>
      apiRequest<{
        id: string;
        name: string;
        description?: string;
        user_id: string;
        course_id?: string | null;
        topic_id?: string | null;
        created_at: string;
        updated_at: string;
        card_count?: number;
      }>("/decks", {
        method: "POST",
        body: JSON.stringify({ ...data, userId }),
      }),

    updateDeck: (
      deckId: string,
      updates: {
        name?: string;
        description?: string;
        courseId?: string | null;
        topicId?: string | null;
      },
    ) =>
      apiRequest<{
        id: string;
        name: string;
        description?: string;
        user_id: string;
        created_at: string;
        updated_at: string;
        card_count?: number;
      }>(`/decks/${deckId}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      }),

    deleteDeck: (deckId: string) =>
      apiRequest<void>(`/decks/${deckId}`, { method: "DELETE" }),

    resetDeckStatistics: (deckId: string, userId: string) =>
      apiRequest<void>(`/decks/${deckId}/reset`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),

    exportDeck: (deckId: string) =>
      apiRequest<unknown>(`/decks/${deckId}/export`),

    exportDeckCsv: (deckId: string) =>
      client.requestText(`/decks/${deckId}/export/csv`),

    importDeckCsv: (csv: string, userId: string, deckName?: string) =>
      apiRequest<{ deck: unknown; flashcards: unknown[] }>(
        "/decks/import/csv",
        {
          method: "POST",
          body: JSON.stringify({ csv, deckName, userId }),
        },
      ),

    importDeckApkg: (apkgBase64: string, userId: string) =>
      apiRequest<{ deck: unknown; flashcards: unknown[] }>(
        "/decks/import/apkg",
        {
          method: "POST",
          body: JSON.stringify({ apkgBase64, userId }),
        },
      ),

    importDeck: (importData: unknown, userId: string) =>
      apiRequest<{
        deck: {
          id: string;
          name: string;
          description?: string;
          user_id: string;
          created_at: string;
          updated_at: string;
        };
        flashcards: Array<{
          id: string;
          deck_id: string;
          type: "BASIC" | "CLOZE";
          front?: string;
          back?: string;
          cloze_text?: string;
          tags?: string[];
          created_at: string;
          updated_at: string;
        }>;
      }>("/decks/import", {
        method: "POST",
        body: JSON.stringify({ importData, userId }),
      }),

    fetchDeckCollaborators: (deckId: string) =>
      apiRequest<
        Array<{
          deck_id: string;
          user_id: string;
          role: string;
          added_at: string;
        }>
      >(`/decks/${deckId}/collaborators`),

    addDeckCollaborator: (deckId: string, userId: string, role: string) =>
      apiRequest<{
        deck_id: string;
        user_id: string;
        role: string;
        added_at: string;
      }>(`/decks/${deckId}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ userId, role }),
      }),

    removeDeckCollaborator: (deckId: string, userId: string) =>
      apiRequest<void>(`/decks/${deckId}/collaborators/${userId}`, {
        method: "DELETE",
      }),

    // ========== FLASHCARD API ==========

    fetchFlashcards: async (
      deckId?: string,
      options?: { page?: number; limit?: number },
    ) => {
      const params = new URLSearchParams();
      if (deckId) params.append("deckId", deckId);
      if (options?.page) params.append("page", options.page.toString());
      if (options?.limit) {
        params.append("limit", options.limit.toString());
      } else if (deckId) {
        params.append("limit", "500");
      }
      const query = params.toString();
      const endpoint = query ? `/flashcards?${query}` : "/flashcards";

      if (options?.page || options?.limit) {
        return apiRequestRaw<{
          success: boolean;
          data: Array<{
            id: string;
            deck_id: string;
            type: "BASIC" | "CLOZE";
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
          }>;
          pagination?: { page: number; limit: number; total: number };
        }>(endpoint);
      }

      return apiRequest<
        Array<{
          id: string;
          deck_id: string;
          type: "BASIC" | "CLOZE";
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
        }>
      >(endpoint);
    },

    createFlashcard: (
      userId: string,
      deckId: string,
      data: {
        type: "BASIC" | "CLOZE" | "IMAGE_OCCLUSION";
        front?: string | null;
        back?: string | null;
        clozeText?: string | null;
        tags?: string[];
        // Occlusion cards carry the picture plus its masks; a basic card may
        // carry just the picture. The server has always accepted both — only
        // this client type was too narrow to send them.
        imageUrl?: string | null;
        occlusionData?: unknown;
      },
    ) =>
      apiRequest<{
        id: string;
        deck_id: string;
        type: "BASIC" | "CLOZE" | "IMAGE_OCCLUSION";
        front?: string;
        back?: string;
        cloze_text?: string;
        tags?: string[];
        created_at: string;
        updated_at: string;
      }>("/flashcards", {
        method: "POST",
        body: JSON.stringify({ ...data, deckId, userId }),
      }),

    updateFlashcard: (
      flashcardId: string,
      updates: {
        front?: string;
        back?: string;
        clozeText?: string;
        srsData?: unknown;
        tags?: string[];
        expectedVersion?: number;
      },
    ) =>
      apiRequest<{
        id: string;
        deck_id: string;
        type: "BASIC" | "CLOZE";
        front?: string;
        back?: string;
        cloze_text?: string;
        tags?: string[];
        version?: number;
        created_at: string;
        updated_at: string;
      }>(`/flashcards/${flashcardId}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      }),

    reviewFlashcard: (
      flashcardId: string,
      rating: "again" | "hard" | "good" | "easy",
      expectedVersion?: number,
      /**
       * Offline replay: the ISO time the grade was actually given, so the
       * server's learning_events row carries occurred_at = reviewedAt rather
       * than the sync time. Omit for live reviews.
       */
      options?: { reviewedAt?: string },
    ) =>
      apiRequest<{
        id: string;
        deck_id: string;
        srs_data: unknown;
        version?: number;
        updated_at: string;
      }>(`/flashcards/${flashcardId}/review`, {
        method: "POST",
        body: JSON.stringify({
          rating,
          ...(expectedVersion != null ? { expectedVersion } : {}),
          ...(options?.reviewedAt ? { reviewedAt: options.reviewedAt } : {}),
        }),
      }),

    deleteFlashcard: (flashcardId: string) =>
      apiRequest<void>(`/flashcards/${flashcardId}`, { method: "DELETE" }),

    fetchFlashcardComments: (flashcardId: string) =>
      apiRequest<
        Array<{
          id: string;
          flashcard_id: string;
          user_id: string;
          comment: string;
          created_at: string;
          resolved?: boolean;
        }>
      >(`/flashcards/${flashcardId}/comments`),

    addFlashcardComment: (
      flashcardId: string,
      userId: string,
      comment: string,
    ) =>
      apiRequest<{
        id: string;
        flashcard_id: string;
        user_id: string;
        comment: string;
        created_at: string;
        resolved?: boolean;
      }>(`/flashcards/${flashcardId}/comments`, {
        method: "POST",
        body: JSON.stringify({ userId, comment }),
      }),

    resolveFlashcardComment: (commentId: string) =>
      apiRequest<{
        id: string;
        flashcard_id: string;
        user_id: string;
        comment: string;
        created_at: string;
        resolved: boolean;
      }>(`/flashcards/comments/${commentId}/resolve`, { method: "PUT" }),

    /**
     * Upload a flashcard image.
     *
     * POST /flashcards/upload-image expects JSON { fileName, base64Data,
     * contentType } — not multipart. The FormData variant below predates this
     * and does not match the route, which fails as a 500 rather than a helpful
     * validation error.
     */
    uploadFlashcardImageBase64: (payload: {
      fileName: string;
      base64Data: string;
      contentType: string;
      folder?: string;
    }) =>
      apiRequest<{ url: string; path: string }>("/flashcards/upload-image", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    uploadFlashcardImage: async (
      userId: string,
      file: Blob | { uri: string; name: string; type: string },
      deckId?: string,
    ) => {
      const formData = new FormData();
      if ("uri" in file) {
        formData.append("file", file as unknown as Blob);
      } else {
        formData.append("file", file);
      }
      formData.append("userId", userId);
      if (deckId) formData.append("deckId", deckId);

      return apiRequest<{ url: string; path: string }>(
        "/flashcards/upload-image",
        {
          method: "POST",
          body: formData,
        },
      );
    },

    // ========== USER PROFILE API ==========

    fetchUserProfile: (userId: string) =>
      apiRequest<{
        id: string;
        name: string;
        // Server returns both camelCase and snake_case aliases for these.
        firstName?: string;
        first_name?: string;
        lastName?: string;
        last_name?: string;
        username?: string;
        avatar_url?: string;
        phone?: string;
        points: number;
        stats?: unknown;
        badges?: unknown[];
        settings?: unknown;
        // Academic identity (docs/phase1-academic-identity-contract.md §2).
        institutionId?: string | null;
        institution?: { id: string; name: string; slug: string } | null;
        faculty?: string | null;
        programme?: string | null;
        studyLevel?: number | null;
        entryYear?: number | null;
        expectedGraduationYear?: number | null;
        created_at: string;
        updated_at: string;
      }>(`/users/${userId}`),

    createUserProfile: (data: {
      id: string;
      name: string;
      avatar_url?: string;
    }) =>
      apiRequest<{
        id: string;
        name: string;
        avatar_url?: string;
        points: number;
        created_at: string;
        updated_at: string;
      }>("/users", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    updateUserProfile: (
      userId: string,
      updates: Partial<{
        name: string;
        avatar_url?: string | null;
        phone?: string;
        points: number;
        stats?: unknown;
        badges?: unknown[];
        settings?: unknown;
        // Academic identity (PUT /users/:id; 400 for "other-*" sentinel campuses).
        institutionId?: string | null;
        faculty?: string | null;
        programme?: string | null;
        studyLevel?: number | null;
        entryYear?: number | null;
        expectedGraduationYear?: number | null;
      }>,
    ) =>
      apiRequest<{
        id: string;
        name: string;
        avatar_url?: string;
        phone?: string;
        points: number;
        institutionId?: string | null;
        institution?: { id: string; name: string; slug: string } | null;
        faculty?: string | null;
        programme?: string | null;
        studyLevel?: number | null;
        entryYear?: number | null;
        expectedGraduationYear?: number | null;
        created_at: string;
        updated_at: string;
      }>(`/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      }),

    uploadProfileAvatar: (
      userId: string,
      payload: { fileName: string; base64Data: string; contentType: string },
    ) =>
      apiRequest<{
        url: string;
        path: string;
        avatarUrl: string;
        user?: {
          id: string;
          name: string;
          avatarUrl?: string;
          avatar_url?: string;
        };
      }>(`/users/${userId}/avatar`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    deleteUserAccount: (userId: string) =>
      apiRequest<{ success: boolean; message?: string }>(`/users/${userId}`, {
        method: "DELETE",
      }),

    exportUserData: (userId: string) =>
      apiRequestRaw<{ success: boolean; data: Record<string, unknown> }>(
        `/users/${userId}/export`,
      ),

    fetchUserSettings: (userId: string) =>
      apiRequest<unknown>(`/users/${userId}/settings`),

    listBlockedUsers: (userId: string) =>
      apiRequest<{ blockedUserIds: string[] }>(`/users/${userId}/blocks`),

    getDmBlockStatus: (userId: string, otherUserId: string) =>
      apiRequest<{ blocked: boolean; iBlockedThem: boolean }>(
        `/users/${userId}/blocks/status/${encodeURIComponent(otherUserId)}`,
      ),

    blockUser: (userId: string, blockedUserId: string) =>
      apiRequest<{ blockedUserId: string }>(`/users/${userId}/blocks`, {
        method: "POST",
        body: JSON.stringify({ blockedUserId }),
      }),

    unblockUser: (userId: string, blockedUserId: string) =>
      apiRequest<{ blockedUserId: string }>(
        `/users/${userId}/blocks/${encodeURIComponent(blockedUserId)}`,
        { method: "DELETE" },
      ),

    updateUserSettings: (
      userId: string,
      settings: unknown,
      expectedSettingsVersion?: number,
    ) =>
      apiRequest<{ settings: unknown; settingsVersion?: number }>(
        `/users/${userId}/settings`,
        {
          method: "PUT",
          body: JSON.stringify({
            settings,
            ...(expectedSettingsVersion != null
              ? { expectedSettingsVersion }
              : {}),
          }),
        },
      ),

    searchUsers: (query: string, limit = 20) => {
      // Preserve leading @ so the API can prefer username matches for @queries.
      const searchQuery = query.trim();
      return apiRequest<
        Array<{
          id: string;
          name: string;
          username?: string;
          avatar_url?: string;
          avatarUrl?: string;
        }>
      >(`/users/search?q=${encodeURIComponent(searchQuery)}&limit=${limit}`);
    },

    checkUsername: (username: string) =>
      apiRequestRaw<{
        success: boolean;
        available: boolean;
        username?: string;
        displayUsername?: string;
        error?: string;
      }>(`/users/check-username/${encodeURIComponent(username)}`),

    updateUsername: (
      userId: string,
      username: string,
      extras?: { firstName?: string; lastName?: string },
    ) =>
      apiRequest<{
        id: string;
        username: string;
        displayUsername: string;
        firstName?: string;
        lastName?: string;
        name?: string;
      }>(`/users/${userId}/username`, {
        method: "PUT",
        body: JSON.stringify({
          username,
          ...(extras?.firstName != null ? { firstName: extras.firstName } : {}),
          ...(extras?.lastName != null ? { lastName: extras.lastName } : {}),
        }),
      }),

    // ========== GROUPS API ==========

    fetchGroups: (
      userId: string,
      options?: { limit?: number; page?: number },
    ) => {
      const params = new URLSearchParams({ userId });
      if (options?.limit) params.set("limit", String(options.limit));
      if (options?.page) params.set("page", String(options.page));
      return apiRequest<
        Array<{
          id: string;
          name: string;
          description?: string;
          avatar_url?: string;
          avatarUrl?: string;
          parent_id?: string;
          parentId?: string;
          invite_id: string;
          admin_ids?: string[];
          adminIds?: string[];
          permissions?: unknown;
          is_archived?: boolean;
          isArchived?: boolean;
          created_at: string;
          createdAt?: string;
          updated_at: string;
          updatedAt?: string;
          member_count?: number;
          memberCount?: number;
          last_message?: string;
          lastMessage?: string;
          last_message_time?: string;
          lastMessageTime?: string;
          members?: unknown[];
        }>
      >(`/groups?${params.toString()}`);
    },

    fetchGroup: (groupId: string) =>
      apiRequest<{
        id: string;
        name: string;
        description?: string;
        avatar_url?: string;
        invite_id: string;
        admin_ids?: string[];
        permissions?: unknown;
        is_archived?: boolean;
        created_at: string;
        updated_at: string;
        member_count?: number;
        members?: unknown[];
      }>(`/groups/${groupId}`),

    createGroup: (data: {
      name: string;
      description?: string;
      avatar_url?: string;
      permissions?: unknown;
      invite_id: string;
      parent_id?: string;
      userId: string;
      memberIds: string[];
      /** Academic archive: the course this group studies (null clears). */
      courseId?: string | null;
      visibility?: 'private' | 'community' | 'public';
      communityId?: string | null;
    }) =>
      apiRequest<{
        id: string;
        name: string;
        description?: string;
        avatar_url?: string;
        invite_id: string;
        course_id?: string | null;
        courseId?: string | null;
        created_at: string;
        updated_at: string;
      }>("/groups", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    updateGroup: (
      groupId: string,
      updates: {
        name?: string;
        description?: string;
        avatarUrl?: string;
        isArchived?: boolean;
        courseId?: string | null;
        visibility?: 'private' | 'community' | 'public';
        communityId?: string | null;
      },
    ) =>
      apiRequest<{
        id: string;
        name: string;
        description?: string;
        avatar_url?: string;
        is_archived?: boolean;
        course_id?: string | null;
        courseId?: string | null;
        created_at: string;
        updated_at: string;
      }>(`/groups/${groupId}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      }),

    deleteGroup: (groupId: string) =>
      apiRequest<void>(`/groups/${groupId}`, { method: "DELETE" }),

    fetchGroupMembers: (groupId: string) =>
      apiRequest<unknown[]>(`/groups/${groupId}/members`),

    addGroupMember: (groupId: string, userId: string) =>
      apiRequest<{ invited?: boolean; groupId?: string; userId?: string }>(
        `/groups/${groupId}/members`,
        {
          method: "POST",
          body: JSON.stringify({ userId }),
        },
      ),

    addGroupMembersBatch: (groupId: string, userIds: string[]) =>
      apiRequest<{
        invited: string[];
        added: string[];
        alreadyMembers: string[];
        alreadyPending: string[];
        failed: string[];
      }>(`/groups/${groupId}/members/batch`, {
        method: "POST",
        body: JSON.stringify({ userIds }),
      }),

    fetchPendingGroupInvites: () =>
      apiRequest<
        Array<{
          groupId: string;
          groupName: string;
          avatarUrl?: string;
          invitedAt?: string;
        }>
      >("/groups/invites/pending"),

    acceptGroupInvite: (groupId: string) =>
      apiRequest<unknown>(`/groups/${groupId}/invites/accept`, {
        method: "POST",
      }),

    declineGroupInvite: (groupId: string) =>
      apiRequest<void>(`/groups/${groupId}/invites/decline`, {
        method: "POST",
      }),

    uploadGroupAvatar: (
      groupId: string,
      data: { fileName: string; base64Data: string; contentType: string },
    ) =>
      apiRequest<{ url: string; path: string; avatarUrl: string }>(
        `/groups/${groupId}/avatar`,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),

    removeGroupMember: (groupId: string, userId: string) =>
      apiRequest<void>(`/groups/${groupId}/members/${userId}`, {
        method: "DELETE",
      }),

    joinGroupByInvite: (inviteId: string, userId: string) =>
      apiRequest<{
        id: string;
        name: string;
        invite_id: string;
        created_at: string;
        updated_at: string;
      }>("/groups/join", {
        method: "POST",
        body: JSON.stringify({ inviteId, userId }),
      }),

    leaveGroup: (groupId: string, userId: string) =>
      apiRequest<void>(`/groups/${groupId}/leave`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),

    promoteGroupAdmin: (groupId: string, memberId: string) =>
      apiRequest<unknown>(`/groups/${groupId}/admins/${memberId}`, {
        method: "POST",
      }),

    demoteGroupAdmin: (groupId: string, memberId: string) =>
      apiRequest<unknown>(`/groups/${groupId}/admins/${memberId}`, {
        method: "DELETE",
      }),

    fetchGroupUnreadCounts: (_userId: string) =>
      apiRequest<Record<string, number>>("/groups/unread/all"),

    markGroupAsRead: (groupId: string, userId: string) =>
      apiRequestRaw<{
        success: boolean;
        previousLastReadAt: string | null;
        data?: { previousLastReadAt: string | null };
        message?: string;
      }>(`/groups/${groupId}/read`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),

    // ========== MESSAGES API ==========

    fetchMessages: async (
      groupId: string,
      options?: { page?: number; limit?: number },
    ) => {
      const params = new URLSearchParams();
      if (options?.page) params.append("page", options.page.toString());
      if (options?.limit) params.append("limit", options.limit.toString());
      const query = params.toString() ? `?${params.toString()}` : "";
      const endpoint = `/messages/group/${groupId}${query}`;

      if (options?.page || options?.limit) {
        return apiRequestRaw<{
          success: boolean;
          data: Array<{
            id: string;
            group_id: string;
            sender_id: string;
            content?: string;
            text?: string;
            type: "TEXT" | "QUESTION";
            upvotes: number;
            downvotes: number;
            created_at: string;
            updated_at: string;
          }>;
          pagination?: { page: number; limit: number; total: number };
        }>(endpoint);
      }

      return apiRequest<
        Array<{
          id: string;
          group_id: string;
          sender_id: string;
          content?: string;
          text?: string;
          type: "TEXT" | "QUESTION";
          upvotes: number;
          downvotes: number;
          created_at: string;
          updated_at: string;
        }>
      >(endpoint);
    },

    sendMessage: async (
      groupId: string,
      userId: string,
      data: {
        content: string;
        clientMessageId?: string;
        replyToMessageId?: string;
        mentionedUserIds?: string[];
        type?: "TEXT" | "QUESTION";
        questionType?: string;
        questionStem?: string;
        options?: unknown[];
        correctAnswerIds?: string[];
        explanation?: string;
        tags?: string[];
        imageUrl?: string;
      },
    ) => {
      const request = () =>
        apiRequest<{
          id: string;
          group_id: string;
          sender_id: string;
          content?: string;
          type: "TEXT" | "QUESTION";
          created_at: string;
          updated_at: string;
        }>(`/messages/group/${groupId}`, {
          method: "POST",
          body: JSON.stringify({ ...data, userId }),
        });
      return retryUncertainDelivery(request);
    },

    fetchGroupThread: (groupId: string, rootId: string) =>
      apiRequest<
        Array<{
          id: string;
          group_id?: string;
          groupId?: string;
          sender_id?: string;
          senderId?: string;
          text?: string;
          type?: "TEXT" | "QUESTION";
          timestamp?: string;
          thread_root_id?: string;
          threadRootId?: string;
          replyCount?: number;
          receiptStatus?: "sent" | "read";
          seenByCount?: number;
          seenByTotal?: number;
        }>
      >(
        `/messages/group/${encodeURIComponent(groupId)}/thread/${encodeURIComponent(rootId)}`,
      ),

    updateMessage: (
      messageId: string,
      updates: {
        flagged_as_similar_user_ids?: string[];
        flaggedUserIds?: string[];
      },
    ) =>
      apiRequest<{
        id: string;
        group_id: string;
        sender_id: string;
        created_at: string;
        updated_at: string;
      }>(`/messages/${messageId}/update`, {
        method: "PUT",
        body: JSON.stringify({
          flagged_as_similar_user_ids:
            updates.flagged_as_similar_user_ids ?? updates.flaggedUserIds,
        }),
      }),

    editGroupMessage: (messageId: string, content: string) =>
      apiRequest<ChatMessageMutationPayload>(`/messages/${messageId}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),

    removeGroupMessage: (messageId: string) =>
      apiRequest<ChatMessageMutationPayload>(`/messages/${messageId}`, {
        method: "DELETE",
      }),

    updateQuestionStatus: (messageId: string, questionStatus: string) =>
      apiRequest<{
        id: string;
        group_id: string;
        question_status?: string;
        created_at: string;
        updated_at: string;
      }>(`/messages/${messageId}/status`, {
        method: "PUT",
        body: JSON.stringify({ questionStatus }),
      }),

    voteOnMessage: (
      messageId: string,
      userId: string,
      voteType: "up" | "down",
    ) =>
      apiRequest<unknown>(`/messages/${messageId}/vote`, {
        method: "POST",
        body: JSON.stringify({ userId, voteType }),
      }),

    removeVote: (messageId: string, userId: string) =>
      apiRequest<void>(
        `/messages/${messageId}/vote?userId=${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
        },
      ),

    fetchUserVotesForGroup: (groupId: string, userId: string) =>
      apiRequest<Record<string, "up" | "down">>(
        `/messages/group/${groupId}/user-votes?userId=${encodeURIComponent(userId)}`,
      ),

    // ========== DIRECT MESSAGES API ==========

    fetchDMThreads: (userId: string) =>
      apiRequest<
        Array<{
          id: string;
          participant_ids: string[];
          participants: Record<string, { name: string; avatar_url?: string }>;
          last_message?: string;
          last_message_timestamp?: string;
          unread_count?: number;
        }>
      >(`/messages/dm/threads?userId=${encodeURIComponent(userId)}`),

    fetchDirectMessages: async (
      userId: string,
      otherUserId: string,
      options?: { page?: number; limit?: number },
    ) => {
      const params = new URLSearchParams({ otherUserId });
      if (options?.page) params.append("page", options.page.toString());
      if (options?.limit) params.append("limit", options.limit.toString());
      const endpoint = `/messages/user/${userId}?${params.toString()}`;

      if (options?.page || options?.limit) {
        return apiRequestRaw<{
          success: boolean;
          data: Array<{
            id: string;
            thread_id: string;
            sender_id: string;
            content: string;
            created_at: string;
          }>;
          pagination?: { page: number; limit: number; total: number };
        }>(endpoint);
      }

      return apiRequest<
        Array<{
          id: string;
          thread_id: string;
          sender_id: string;
          content: string;
          created_at: string;
        }>
      >(endpoint);
    },

    sendDirectMessage: async (
      senderId: string,
      recipientId: string,
      content: string,
      clientMessageId?: string,
      options?: { replyToMessageId?: string },
    ) => {
      const request = () =>
        apiRequest<{
          id: string;
          thread_id: string;
          sender_id: string;
          content: string;
          created_at: string;
        }>(`/messages/user/${senderId}`, {
          method: "POST",
          body: JSON.stringify({
            content,
            recipientId,
            clientMessageId,
            replyToMessageId: options?.replyToMessageId,
          }),
        });
      return retryUncertainDelivery(request);
    },

    editDirectMessage: (messageId: string, content: string) =>
      apiRequest<ChatMessageMutationPayload>(
        `/messages/dm-message/${messageId}`,
        {
          method: "PUT",
          body: JSON.stringify({ content }),
        },
      ),

    removeDirectMessage: (messageId: string) =>
      apiRequest<ChatMessageMutationPayload>(
        `/messages/dm-message/${messageId}`,
        {
          method: "DELETE",
        },
      ),

    markDMAsRead: (threadId: string, userId: string) =>
      apiRequestRaw<{
        success: boolean;
        previousLastReadAt?: string | null;
        data?: { previousLastReadAt?: string | null };
      }>(`/messages/dm/${threadId}/read`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }).then((body) => ({
        success: body.success !== false,
        previousLastReadAt:
          body.previousLastReadAt ?? body.data?.previousLastReadAt ?? null,
      })),

    fetchDmThread: (threadId: string, rootId: string) =>
      apiRequest<
        Array<{
          id: string;
          thread_id?: string;
          threadId?: string;
          sender_id?: string;
          senderId?: string;
          text?: string;
          timestamp?: string;
          thread_root_id?: string;
          threadRootId?: string;
          replyCount?: number;
          receiptStatus?: "sent" | "read";
        }>
      >(
        `/messages/dm/${encodeURIComponent(threadId)}/thread/${encodeURIComponent(rootId)}`,
      ),

    fetchDMUnreadCounts: (_userId: string) =>
      apiRequest<Record<string, number>>("/messages/dm/unread/all"),

    archiveDmThread: (threadId: string, _userId: string) =>
      apiRequest<void>(
        `/messages/dm/${encodeURIComponent(threadId)}/archive`,
        { method: "PUT" },
      ),

    unarchiveDmThread: (threadId: string, _userId: string) =>
      apiRequest<void>(
        `/messages/dm/${encodeURIComponent(threadId)}/unarchive`,
        { method: "PUT" },
      ),

    searchMessages: (query: string, limit = 20, scope?: { groupId?: string; threadId?: string }) => {
      const params = new URLSearchParams({ q: query, limit: String(limit) });
      if (scope?.groupId) params.set("groupId", scope.groupId);
      if (scope?.threadId) params.set("threadId", scope.threadId);
      return apiRequest<{
        results: Array<{
          id: string;
          chatType: "group" | "dm";
          chatId: string;
          chatName: string;
          chatAvatarUrl: string | null;
          otherUserId: string | null;
          text: string;
          senderId: string;
          timestamp: string;
        }>;
      }>(`/messages/search?${params.toString()}`);
    },

    getDmMuteStatus: (threadId: string) =>
      apiRequest<{ muted: boolean; mutedUntil: string | null }>(
        `/messages/dm/${encodeURIComponent(threadId)}/mute`,
      ),

    muteDmThread: (threadId: string, duration: "1h" | "8h" | "24h" | "7d") =>
      apiRequest<{ muted: boolean; mutedUntil: string | null }>(
        `/messages/dm/${encodeURIComponent(threadId)}/mute`,
        { method: "PUT", body: JSON.stringify({ duration }) },
      ),

    unmuteDmThread: (threadId: string) =>
      apiRequest<{ muted: boolean; mutedUntil: string | null }>(
        `/messages/dm/${encodeURIComponent(threadId)}/mute`,
        { method: "DELETE" },
      ),

    getGroupMuteStatus: (groupId: string) =>
      apiRequest<{ muted: boolean; mutedUntil: string | null }>(
        `/groups/${encodeURIComponent(groupId)}/mute`,
      ),

    muteGroupChat: (groupId: string, duration: "1h" | "8h" | "24h" | "7d") =>
      apiRequest<{ muted: boolean; mutedUntil: string | null }>(
        `/groups/${encodeURIComponent(groupId)}/mute`,
        { method: "PUT", body: JSON.stringify({ duration }) },
      ),

    unmuteGroupChat: (groupId: string) =>
      apiRequest<{ muted: boolean; mutedUntil: string | null }>(
        `/groups/${encodeURIComponent(groupId)}/mute`,
        { method: "DELETE" },
      ),

    acceptDmMessageRequest: (threadId: string) =>
      apiRequest<{ id: string; status: "open"; requestedBy: null }>(
        `/messages/dm/${encodeURIComponent(threadId)}/accept`,
        { method: "POST" },
      ),

    declineDmMessageRequest: (threadId: string) =>
      apiRequest<{
        id: string;
        status: "declined";
        requestedBy: string | null;
      }>(`/messages/dm/${encodeURIComponent(threadId)}/decline`, {
        method: "POST",
      }),

    deleteDmThread: (threadId: string, _userId: string) =>
      apiRequest<void>(`/messages/dm/${encodeURIComponent(threadId)}`, {
        method: "DELETE",
      }),

    // ========== TESTS API ==========

    fetchTests: (
      userId: string,
      options?: { status?: string; groupId?: string },
    ) => {
      const params = new URLSearchParams({ userId });
      if (options?.status) params.append("status", options.status);
      if (options?.groupId) params.append("groupId", options.groupId);
      return apiRequest<
        Array<{
          id: string;
          user_id: string;
          group_id: string;
          config: unknown;
          questions: unknown[];
          user_answers: Record<string, unknown>;
          status: "in_progress" | "completed" | "abandoned";
          start_time: string;
          end_time?: string;
          score?: number;
          created_at: string;
        }>
      >(`/tests?${params.toString()}`);
    },

    createTestSession: (data: {
      userId: string;
      groupId: string;
      config: unknown;
      questions: unknown[];
      isOffline?: boolean;
    }) =>
      apiRequest<{
        id: string;
        user_id: string;
        group_id: string;
        config: unknown;
        questions: unknown[];
        status: string;
        start_time: string;
        created_at: string;
      }>("/tests", {
        method: "POST",
        body: JSON.stringify({
          config: data.config,
          questions: data.questions,
          user_answers: {},
          start_time: new Date().toISOString(),
          is_offline: data.isOffline || false,
          userId: data.userId,
        }),
      }),

    updateTestSession: (
      sessionId: string,
      updates: {
        userAnswers?: Record<string, unknown>;
        endTime?: string;
        status?: string;
      },
      userId: string,
    ) =>
      apiRequest<{
        id: string;
        user_id: string;
        status: string;
        user_answers: Record<string, unknown>;
        end_time?: string;
      }>(`/tests/${sessionId}/submit`, {
        method: "PUT",
        body: JSON.stringify({
          answers: updates.userAnswers
            ? Object.values(updates.userAnswers)
            : [],
          userId,
        }),
      }),

    submitTestResult: (
      sessionId: string,
      result: {
        score: number;
        correctAnswersCount: number;
        totalQuestions: number;
      },
    ) =>
      apiRequest<{
        session_id: string;
        score: number;
        correct_answers_count: number;
        total_questions: number;
      }>(`/tests/${sessionId}/results`, {
        method: "POST",
        body: JSON.stringify(result),
      }),

    fetchTestResults: async (
      userId: string,
      options?: {
        limit?: number;
        page?: number;
        lean?: boolean;
        sort?: "newest" | "oldest" | "highestScore";
        from?: string;
        to?: string;
      },
    ) => {
      type TestResultRow = {
        id?: string;
        session: {
          id?: string;
          config?: {
            groupId?: string;
            groupName?: string;
            name?: string;
            passingScore?: number;
          };
          questions?: unknown[];
          userAnswers?: Record<string, unknown>;
          startTime?: string;
          endTime?: string;
        };
        score: number;
        totalQuestions: number;
        correctAnswersCount: number;
        // Lean responses omit userAnswers, so the server sends question timing
        // pre-aggregated instead. Rows pass through untouched; normalizeTestResults
        // reads these to compute "Avg / question" and total study time.
        timeSpentSeconds?: number;
        questionsWithTime?: number;
      };

      const pageSize = options?.limit ?? 500;
      const buildParams = (page: number) => {
        const params = new URLSearchParams({
          userId,
          status: "completed",
          limit: String(pageSize),
          page: String(page),
          sort: options?.sort ?? "newest",
        });
        if (options?.lean !== false) params.set("lean", "1");
        if (options?.from) params.set("from", options.from);
        if (options?.to) params.set("to", options.to);
        return params;
      };

      // Explicit page => single page; otherwise walk all pages for full history.
      if (options?.page != null) {
        return apiRequest<TestResultRow[]>(
          `/tests?${buildParams(options.page).toString()}`,
        );
      }

      const all: TestResultRow[] = [];
      let page = 1;
      let hasMore = true;
      const maxPages = 100;
      while (hasMore && page <= maxPages) {
        const result = await apiRequestRaw<{
          success: boolean;
          data: TestResultRow[];
          pagination?: {
            page: number;
            limit: number;
            total: number;
            hasMore: boolean;
          };
        }>(`/tests?${buildParams(page).toString()}`);
        const chunk = Array.isArray(result?.data) ? result.data : [];
        all.push(...chunk);
        hasMore = Boolean(result?.pagination?.hasMore) && chunk.length > 0;
        page += 1;
      }
      return all;
    },

    fetchTestResultsPage: (
      userId: string,
      options?: {
        limit?: number;
        page?: number;
        lean?: boolean;
        sort?: "newest" | "oldest" | "highestScore";
        from?: string;
        to?: string;
      },
    ) => {
      const params = new URLSearchParams({
        userId,
        status: "completed",
        limit: String(options?.limit ?? 10),
        page: String(options?.page ?? 1),
        sort: options?.sort ?? "newest",
      });
      if (options?.lean !== false) params.set("lean", "1");
      if (options?.from) params.set("from", options.from);
      if (options?.to) params.set("to", options.to);
      return apiRequestRaw<{
        success: boolean;
        data: Array<{
          id?: string;
          session: {
            id?: string;
            config?: {
              groupId?: string;
              groupName?: string;
              name?: string;
              passingScore?: number;
            };
            questions?: unknown[];
            userAnswers?: Record<string, unknown>;
            startTime?: string;
            endTime?: string;
          };
          score: number;
          totalQuestions: number;
          correctAnswersCount: number;
        }>;
        pagination?: {
          page: number;
          limit: number;
          total: number;
          hasMore: boolean;
        };
      }>(`/tests?${params.toString()}`);
    },

    saveTestResult: (
      userId: string,
      data: {
        sessionId?: string;
        groupId?: string;
        config?: unknown;
        questions?: unknown[];
        userAnswers?: Record<string, unknown>;
        score: number;
        correctAnswersCount: number;
        totalQuestions: number;
        startTime?: string;
        endTime?: string;
      },
    ) => {
      if (data.sessionId) {
        return apiRequest<{
          id: string;
          user_id: string;
          status: string;
          score?: number;
        }>(`/tests/${data.sessionId}/submit`, {
          method: "PUT",
          body: JSON.stringify({
            answers: data.userAnswers ? Object.values(data.userAnswers) : [],
            userId,
            score: data.score,
          }),
        });
      }

      return apiRequest<{
        id: string;
        user_id: string;
        status: string;
        score?: number;
      }>("/tests", {
        method: "POST",
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
    },

    /** One session with questions and user_answers — the list is served lean. */
    fetchTestSessionDetail: (sessionId: string) =>
      apiRequest<{
        id: string;
        questions?: unknown[];
        user_answers?: Record<string, unknown>;
        userAnswers?: Record<string, unknown>;
        start_time?: string;
        end_time?: string;
        config?: Record<string, unknown>;
        score?: number;
      }>(`/tests/sessions/${sessionId}`),

    /**
     * Same payload web uses for Analyze/Review hydrate (`GET /tests/:id`).
     * Prefer `fetchTestSessionDetail` first; use this as a fallback when the
     * sessions route is unavailable or returns an empty body.
     */
    fetchTestById: (testId: string) =>
      apiRequest<{
        id: string;
        questions?: unknown[];
        user_answers?: Record<string, unknown>;
        userAnswers?: Record<string, unknown>;
        start_time?: string;
        startTime?: string;
        end_time?: string;
        endTime?: string;
        config?: Record<string, unknown>;
        score?: number;
      }>(`/tests/${testId}`),

    deleteTestSession: (sessionId: string) =>
      apiRequest<{ deleted: boolean; message?: string }>(
        `/tests/sessions/${sessionId}`,
        {
          method: "DELETE",
        },
      ),

    clearTestHistory: () =>
      apiRequest<{ deletedCount: number; message?: string }>("/tests/history", {
        method: "DELETE",
      }),

    // ========== USER QUESTION STATS API ==========

    fetchUserQuestionStats: (userId: string) =>
      apiRequest<
        Array<{
          question_id: string;
          correct_count: number;
          incorrect_count: number;
          last_reviewed_at: string;
        }>
      >(`/user-stats/${encodeURIComponent(userId)}`),

    // ========== DASHBOARD AGGREGATE API ==========

    /** One round trip for everything the dashboard needs (self only). */
    fetchDashboardSummary: (options?: {
      days?: number;
      activityDate?: string;
    }) => {
      const params = new URLSearchParams();
      if (options?.days) params.set("days", String(options.days));
      if (options?.activityDate)
        params.set("activityDate", options.activityDate);
      const query = params.toString();
      return apiRequest<{
        testResults: unknown[];
        /** null means the server failed to load stats — clients should fall back. */
        userQuestionStats: unknown[] | null;
        profile: { points: number; badges: unknown[]; stats: unknown } | null;
        streak: {
          current_streak?: number;
          longest_streak?: number;
          currentStreak?: number;
          longestStreak?: number;
        } | null;
        activityDays: Array<Record<string, unknown>>;
      }>(`/dashboard/summary${query ? `?${query}` : ""}`);
    },

    upsertUserQuestionStat: (
      userId: string,
      questionId: string,
      stat: {
        correctAttempts: number;
        incorrectAttempts: number;
        lastAttempted: string;
      },
    ) =>
      apiRequest<void>("/user-stats", {
        method: "POST",
        body: JSON.stringify({
          userId,
          questionId,
          correctAttempts: stat.correctAttempts,
          incorrectAttempts: stat.incorrectAttempts,
          lastAttempted: stat.lastAttempted,
        }),
      }),

    // ========== NOTIFICATIONS API ==========

    fetchNotifications: (userId: string) =>
      apiRequest<
        Array<{
          id: string;
          user_id: string;
          message: string;
          type: string;
          link?: string;
          read: boolean;
          date: string;
          created_at: string;
        }>
      >(`/notifications?userId=${encodeURIComponent(userId)}`),

    createNotification: (data: {
      userId: string;
      message: string;
      type?: string;
      link?: string;
    }) =>
      apiRequest<{
        id: string;
        user_id: string;
        message: string;
        type: string;
        read: boolean;
        created_at: string;
      }>("/notifications", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    markNotificationAsRead: (notificationId: string) =>
      apiRequest<void>(`/notifications/${notificationId}/read`, {
        method: "PUT",
      }),

    markAllNotificationsAsRead: async (userId: string) => {
      const result = await apiRequest<{ updatedCount: number }>(
        `/notifications/read-all?userId=${encodeURIComponent(userId)}`,
        { method: "PUT" },
      );
      return result.updatedCount;
    },

    deleteNotification: (notificationId: string, userId: string) =>
      apiRequest<void>(
        `/notifications/${notificationId}?userId=${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
        },
      ),

    deleteAllNotifications: async (userId: string) => {
      const result = await apiRequest<{ deletedCount: number }>(
        `/notifications?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      return result.deletedCount;
    },

    // ========== GAMIFICATION API ==========

    fetchGamificationStats: (userId: string) =>
      apiRequest<{
        cards_reviewed: number;
        streak_days: number;
        total_points: number;
        level: number;
        xp: number;
        xp_to_next_level: number;
      }>(`/gamification/stats?userId=${encodeURIComponent(userId)}`),

    fetchGamificationLeaderboard: (params: {
      page?: number;
      limit?: number;
      ambassador?: boolean;
      institutionId?: string;
    } = {}) => {
      const qs = new URLSearchParams();
      if (params.page) qs.set("page", String(params.page));
      if (params.limit) qs.set("limit", String(params.limit));
      if (params.ambassador) qs.set("ambassador", "1");
      if (params.institutionId) qs.set("institutionId", params.institutionId);
      const suffix = qs.toString() ? `?${qs}` : "";
      return apiRequest<
        Array<{
          rank: number;
          user: { id: string; name: string; avatarUrl?: string; points: number };
        }>
      >(`/gamification/leaderboard${suffix}`, {}, 10000);
    },

    awardPoints: (userId: string, points: number, reason: string) =>
      apiRequest<void>(`/gamification/user/${userId}/points`, {
        method: "POST",
        body: JSON.stringify({ points, reason }),
      }),

    checkBadges: (userId: string) =>
      apiRequest<unknown[]>(`/gamification/user/${userId}/badges`),

    /**
     * Recount badge stats from source data and award anything newly earned.
     *
     * This is the only path that should award badges. Clients used to run the
     * award logic locally and write the result back to the profile, which meant
     * the same account earned badges at different moments depending on which app
     * was opened. The server is the single source of truth.
     */
    syncGamificationProgress: () =>
      apiRequest<{
        points: number;
        badges: Array<{ id: string; level: number; name: string }>;
        stats: Record<string, number>;
        awardedBadges?: Array<{ id: string; level: number; name: string }>;
      }>(`/gamification/me/sync-progress`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    // ========== MARKETPLACE API ==========

    fetchMarketplaceListings: async (
      filters: {
        page?: number;
        limit?: number;
        category?: string;
        /** Filter to a set of categories (server-side tab filter). Serialized comma-separated. */
        categories?: string[];
        /** Also include seller-defined `custom:` categories alongside `categories`. */
        includeCustom?: boolean;
        search?: string;
        minPrice?: number;
        maxPrice?: number;
        location?: string;
        campus_id?: string;
        country_code?: string;
        sortBy?: string;
        sortOrder?: "asc" | "desc";
        condition?: string;
        taxonomyNodeId?: string;
        includeUnclassified?: boolean;
        /** `compact` returns card-shaped rows (first image only) for grids. */
        responseProfile?: "compact" | "full";
      } = {},
    ) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, value.toString());
        }
      });
      const endpoint = `/marketplace/listings?${params.toString()}`;
      const cacheKey = listingsCacheKey(filters as Record<string, unknown>);

      const fetchListings = async () => {
        if (filters.page || filters.limit) {
          return apiRequestRaw<{
            success: boolean;
            data: Array<{
              id: string;
              user_id: string;
              category: string;
              title: string;
              description?: string;
              price?: number;
              location?: string;
              campus_id?: string | null;
              country_code?: string;
              currency?: string;
              campus?: {
                id: string;
                name: string;
                city: string;
                state: string;
                slug?: string;
                country_code?: string;
                geopolitical_zone?: string | null;
              };
              images?: string[];
              status: "active" | "sold" | "inactive" | "reserved";
              created_at: string;
              updated_at: string;
              seller?: { id: string; name: string; avatar_url?: string };
              profiles?: { id: string; name: string; avatar_url?: string };
            }>;
            pagination?: { page: number; limit: number; total: number };
          }>(endpoint, {}, 5000);
        }

        return apiRequest<
          Array<{
            id: string;
            user_id: string;
            category: string;
            title: string;
            description?: string;
            price?: number;
            location?: string;
            campus_id?: string | null;
            country_code?: string;
            currency?: string;
            campus?: {
              id: string;
              name: string;
              city: string;
              state: string;
              slug?: string;
              country_code?: string;
              geopolitical_zone?: string | null;
            };
            images?: string[];
            status: "active" | "sold" | "inactive" | "reserved";
            created_at: string;
            updated_at: string;
            seller?: { id: string; name: string; avatar_url?: string };
            profiles?: { id: string; name: string; avatar_url?: string };
          }>
        >(endpoint, {}, 5000);
      };

      try {
        return await marketplaceListingsCache.get(cacheKey, fetchListings);
      } catch (err) {
        if (err instanceof RateLimitError) throw err;
        if (
          err instanceof Error &&
          err.message.toLowerCase().includes("rate limit")
        ) {
          throw new RateLimitError(err.message);
        }
        throw err;
      }
    },

    fetchMarketplaceCategoryAnalytics: () =>
      marketplaceCategoryAnalyticsCache.get("categories", () =>
        apiRequest<
          Array<{
            category: string;
            total: number;
            active: number;
            sold: number;
          }>
        >("/marketplace/analytics/categories", {}, 5000),
      ),

    fetchMarketplaceListing: (listingId: string) =>
      apiRequest<{
        id: string;
        user_id: string;
        category: string;
        title: string;
        description?: string;
        price?: number;
        location?: string;
        campus_id?: string | null;
        country_code?: string;
        currency?: string;
        campus?: {
          id: string;
          name: string;
          city: string;
          state: string;
          slug?: string;
          country_code?: string;
          geopolitical_zone?: string | null;
        };
        images?: string[];
        status: "active" | "sold" | "inactive" | "reserved";
        category_specific_fields?: unknown;
        views_count?: number;
        favorites_count?: number;
        inquiries_count?: number;
        created_at: string;
        updated_at: string;
        seller?: { id: string; name: string; avatar_url?: string };
        profiles?: { id: string; name: string; avatar_url?: string };
        // Rights / takedown / appeal state — present for the owner and
        // platform admins only; stripped for every other viewer.
        rights_status?: ListingRightsStatus;
        rights_attested_at?: string | null;
        rights_attestation_version?: string | null;
        moderation_flags?: ModerationFlag[];
        takedown_reason?: string | null;
        takedown_at?: string | null;
        appeal_status?: ListingAppealStatus;
        appeal_note?: string | null;
        appealed_at?: string | null;
        appeal_decided_at?: string | null;
      }>(`/marketplace/listings/${listingId}`),

    /**
     * Lightweight review-eligibility check. The /full endpoint derives
     * `canReview` from the session (verified purchase); mobile uses it to gate
     * the "Write review" button so only real buyers see it.
     */
    fetchMarketplaceListingReviewEligibility: (listingId: string) =>
      apiRequest<{ canReview?: boolean }>(
        `/marketplace/listings/${listingId}/full`,
        {},
        8000,
      ),

    /** Batch fetch of active listings by id (single request for the recently-viewed rail). */
    fetchMarketplaceListingsByIds: (ids: string[]) =>
      apiRequest<
        Array<{
          id: string;
          user_id: string;
          category: string;
          title: string;
          description?: string;
          price?: number;
          location?: string;
          campus_id?: string | null;
          country_code?: string;
          currency?: string;
          campus?: {
            id: string;
            name: string;
            city: string;
            state: string;
            slug?: string;
            country_code?: string;
            geopolitical_zone?: string | null;
          };
          images?: string[];
          status: "active" | "sold" | "inactive" | "reserved";
          created_at: string;
          seller?: { id: string; name: string; avatar_url?: string };
        }>
      >(
        `/marketplace/listings/batch?ids=${ids.map(encodeURIComponent).join(",")}`,
        {},
        5000,
      ),

    createMarketplaceListing: (
      data: {
        category: string;
        title: string;
        description?: string;
        price?: number;
        sale_price?: number;
        sale_ends_at?: string;
        promo_label?: string;
        quantity?: number;
        location?: string;
        campus_id: string;
        images?: string[];
        categorySpecificFields?: unknown;
        /** Academic archive: course this listing is for (marketplace_listings.course_id). */
        courseId?: string | null;
        /** Topic within `courseId` (marketplace_listings.topic_id). */
        topicId?: string | null;
        /**
         * Rights attestation (RIGHTS_ATTESTATION_TEXT). Required (400 otherwise)
         * when isAcademicListing({ listingKind, category }) — i.e. pq_bank,
         * lecture_notes, project_thesis, textbook_exchange — harmless elsewhere.
         */
        attestation?: boolean;
      },
      idempotencyKey?: string,
    ) =>
      apiRequest<{
        id: string;
        user_id: string;
        category: string;
        title: string;
        campus_id: string;
        country_code?: string;
        currency?: string;
        price?: number;
        status: string;
        course_id?: string | null;
        created_at: string;
        updated_at: string;
      }>("/marketplace/listings", {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Idempotency-Key":
            idempotencyKey || createIdempotencyKey("create-listing"),
        },
      }),

    updateMarketplaceListing: (
      listingId: string,
      updates: Partial<{
        category: string;
        title: string;
        description?: string;
        price?: number;
        // Nullable so sellers can clear a discount: the server treats an
        // explicit null as "remove", while undefined leaves the field as-is.
        sale_price?: number | null;
        sale_ends_at?: string | null;
        promo_label?: string | null;
        quantity?: number | null;
        location?: string;
        campus_id: string;
        images?: string[];
        status: "active" | "sold" | "inactive" | "reserved";
        /** Merged server-side with the existing JSONB (server-owned keys preserved). */
        categorySpecificFields?: unknown;
        /** Academic archive: course this listing is for (null clears). */
        courseId?: string | null;
        /** Topic within `courseId` (null clears). */
        topicId?: string | null;
        /**
         * Rights attestation. Required (400) when the edit moves an
         * unattested listing into an academic category; re-sending it on an
         * already-attested listing just refreshes rights_attested_at.
         */
        attestation?: boolean;
      }>,
    ) =>
      apiRequest<{
        id: string;
        user_id: string;
        category: string;
        title: string;
        campus_id: string;
        country_code?: string;
        currency?: string;
        status: string;
        created_at: string;
        updated_at: string;
      }>(`/marketplace/listings/${listingId}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      }),

    deleteMarketplaceListing: (listingId: string) =>
      apiRequest<void>(`/marketplace/listings/${listingId}`, {
        method: "DELETE",
      }),

    updateListingStatus: (
      listingId: string,
      status: "active" | "inactive" | "sold" | "reserved",
    ) =>
      apiRequest<{
        id: string;
        status: string;
        updated_at: string;
      }>(`/marketplace/listings/${listingId}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      }),

    fetchMyListings: (status?: string) => {
      const params = status ? `?status=${status}` : "";
      return apiRequest<
        Array<{
          id: string;
          user_id: string;
          category: string;
          title: string;
          status: string;
          created_at: string;
          updated_at: string;
          // Owner-visible rights / takedown / appeal state (Phase 1 · E).
          rights_status?: ListingRightsStatus;
          takedown_reason?: string | null;
          takedown_at?: string | null;
          appeal_status?: ListingAppealStatus;
          appeal_note?: string | null;
          appealed_at?: string | null;
          appeal_decided_at?: string | null;
        }>
      >(`/marketplace/my-listings${params}`, {}, 5000);
    },

    fetchSellerStats: async () => {
      try {
        return await apiRequest<{
          totalListings: number;
          activeListings: number;
          soldListings: number;
          completedOrders: number;
          totalViews: number;
          totalInquiries: number;
          totalFavorites: number;
        }>("/marketplace/stats", {}, 5000);
      } catch {
        return null;
      }
    },

    fetchMyFavorites: () =>
      apiRequest<
        Array<{
          id: string;
          user_id: string;
          listing_id: string;
          created_at: string;
        }>
      >("/marketplace/favorites", {}, 5000),

    addToFavorites: (listingId: string) =>
      apiRequest<{
        id: string;
        user_id: string;
        listing_id: string;
        created_at: string;
      }>("/marketplace/favorites", {
        method: "POST",
        body: JSON.stringify({ listingId }),
      }),

    removeFromFavorites: (listingId: string) =>
      apiRequest<void>(`/marketplace/favorites/${listingId}`, {
        method: "DELETE",
      }),

    checkIfFavorited: async (listingId: string) => {
      try {
        const result = await apiRequest<{ isFavorited: boolean }>(
          `/marketplace/favorites/${listingId}/check`,
        );
        return result.isFavorited;
      } catch {
        return false;
      }
    },

    fetchMyInquiries: (
      role: "seller" | "buyer" = "seller",
      status?: string,
    ) => {
      const params = new URLSearchParams({ role });
      if (status) params.append("status", status);
      return apiRequest<
        Array<{
          id: string;
          listing_id: string;
          dm_thread_id: string;
          buyer_id: string;
          seller_id: string;
          status: "open" | "negotiating" | "closed" | "purchased";
          initial_message: string;
          created_at: string;
          updated_at: string;
        }>
      >(`/marketplace/inquiries?${params.toString()}`);
    },

    /** Marketplace inquiry attached to a DM thread (null when the thread is a plain DM). */
    fetchInquiryByThread: (threadId: string) =>
      apiRequest<{
        id: string;
        listing_id: string;
        dm_thread_id: string;
        buyer_id: string;
        seller_id: string;
        status: "open" | "negotiating" | "closed" | "purchased";
        initial_message?: string;
        created_at: string;
        updated_at?: string;
        listing?: {
          id: string;
          title: string;
          price?: number;
          images?: string[];
          category?: string;
          user_id?: string;
        } | null;
      } | null>(
        `/marketplace/inquiries/thread/${encodeURIComponent(threadId)}`,
      ),

    createInquiry: (listingId: string, message: string) =>
      apiRequest<{
        id: string;
        listing_id: string;
        dm_thread_id: string;
        buyer_id: string;
        seller_id: string;
        status: string;
        created_at: string;
      }>("/marketplace/inquiries", {
        method: "POST",
        body: JSON.stringify({ listingId, message }),
      }),

    updateInquiryStatus: (
      inquiryId: string,
      status: "open" | "negotiating" | "closed" | "purchased",
    ) =>
      apiRequest<{
        id: string;
        status: string;
        updated_at: string;
      }>(`/marketplace/inquiries/${inquiryId}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      }),

    addMarketplaceReview: (
      listingId: string,
      review: { rating: number; comment?: string },
    ) =>
      apiRequest<{
        id: string;
        listing_id: string;
        reviewer_id: string;
        rating: number;
        comment?: string;
        created_at: string;
      }>(`/marketplace/listings/${listingId}/reviews`, {
        method: "POST",
        body: JSON.stringify(review),
      }),

    fetchListingReviews: (listingId: string) =>
      apiRequest<
        Array<{
          id: string;
          listing_id: string;
          reviewer_id: string;
          rating: number;
          comment?: string;
          created_at: string;
          reviewer?: { id: string; name: string; avatar_url?: string };
        }>
      >(`/marketplace/listings/${listingId}/reviews`, {}, 5000),

    fetchSimilarListings: (listingId: string) =>
      apiRequest<
        Array<{
          id: string;
          title: string;
          price?: number;
          images?: string[];
          category: string;
          location?: string;
          created_at: string;
          status: string;
        }>
      >(`/marketplace/listings/${listingId}/similar`, {}, 5000),

    reportMarketplaceListing: (
      listingId: string,
      report: { reason: string; details?: string },
    ) =>
      apiRequest<void>(`/marketplace/listings/${listingId}/reports`, {
        method: "POST",
        body: JSON.stringify(report),
      }),

    // ─── Moderation (Phase 1 · E) ───────────────────────────────────────────

    /**
     * Generic content report — any listing / question bank / note / deck /
     * user / group / message / DM / job posting. `reason` must be one of
     * reasonsForTarget(targetType); the API answers 409 when the caller has
     * already reported this target.
     */
    reportContent: (input: {
      targetType: ContentReportTargetType;
      targetId: string;
      reason: ContentReportReason;
      details?: string;
    }) =>
      apiRequest<{ id: string; status: ContentReportStatus }>("/reports", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    /** Seller appeal of a moderation takedown (one shot; 409 if already appealed). */
    appealListingTakedown: (listingId: string, note: string) =>
      apiRequest<{
        id: string;
        status: string;
        appeal_status: ListingAppealStatus;
        appealed_at: string;
      }>(`/marketplace/listings/${encodeURIComponent(listingId)}/appeal`, {
        method: "POST",
        body: JSON.stringify({ note }),
      }),

    /** Caller's own strike count + suspension state. */
    fetchMyModerationState: () =>
      apiRequest<ModerationState>("/users/me/moderation", {}, 8000),

    // Admin console (routes mounted under /admin; requirePlatformAdmin)
    fetchAdminReports: (params?: {
      status?: ContentReportStatus | "open";
      targetType?: ContentReportTargetType;
      page?: number;
      limit?: number;
    }) => {
      const query = new URLSearchParams();
      if (params?.status) query.set("status", params.status);
      if (params?.targetType) query.set("targetType", params.targetType);
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      return apiRequestRaw<{
        success: boolean;
        data: ContentReport[];
        pagination: { page: number; limit: number; total: number; pages: number };
      }>(`/admin/reports${qs ? `?${qs}` : ""}`);
    },

    resolveAdminReport: (
      id: string,
      body: {
        action: "dismiss" | "under_review" | "warn" | "remove_content" | "strike";
        note?: string;
        severity?: 1 | 2 | 3;
      },
    ) =>
      apiRequestRaw<{
        success: boolean;
        data: {
          action: string;
          status: ContentReportStatus;
          strike?: ModerationStrike | null;
          suspendedUntil?: string | null;
        };
      }>(`/admin/reports/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),

    fetchAdminAppeals: () =>
      apiRequestRaw<{
        success: boolean;
        data: Array<{
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
        }>;
      }>("/admin/appeals"),

    decideListingAppeal: (
      listingId: string,
      body: { decision: "upheld" | "reversed"; note?: string },
    ) =>
      apiRequestRaw<{
        success: boolean;
        data: { id: string; status: string; appeal_status: ListingAppealStatus };
      }>(`/admin/marketplace/listings/${encodeURIComponent(listingId)}/appeal`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),

    addStrike: (
      userId: string,
      body: { reason: string; severity?: 1 | 2 | 3; reportId?: string },
    ) =>
      apiRequestRaw<{
        success: boolean;
        data: { strike: ModerationStrike; activeStrikes: number; suspendedUntil: string | null };
      }>(`/admin/users/${encodeURIComponent(userId)}/strikes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),

    createMarketplaceOffer: (
      listingId: string,
      amount: number,
      message?: string,
      idempotencyKey?: string,
    ) =>
      apiRequest<{
        id: string;
        listing_id: string;
        buyer_id: string;
        seller_id: string;
        amount: number;
        message?: string;
        status: string;
        created_at: string;
      }>("/marketplace/offers", {
        method: "POST",
        body: JSON.stringify({ listingId, amount, message }),
        headers: {
          "Idempotency-Key":
            idempotencyKey || createIdempotencyKey(`create-offer-${listingId}`),
        },
      }),

    respondToOffer: (
      offerId: string,
      action: "accept" | "decline" | "counter" | "withdraw",
      counterAmount?: number,
      message?: string,
      idempotencyKey?: string,
    ) =>
      apiRequest<{
        id: string;
        listing_id: string;
        status: string;
        amount: number;
        updated_at: string;
        orderId?: string;
        authorizationUrl?: string;
        accessCode?: string;
        publicKey?: string;
        payment?: {
          id: string;
          reference: string;
          status: string;
          itemAmountKobo: number;
          serviceFeeKobo: number;
          totalChargeKobo: number;
          currency: string;
        };
        checkout?: {
          authorizationUrl?: string;
          accessCode?: string;
          publicKey?: string;
          payment?: Record<string, unknown>;
          order?: import("../types").MarketplaceOrder;
          error?: string;
        } | null;
      }>(`/marketplace/offers/${offerId}`, {
        method: "PUT",
        body: JSON.stringify({ action, counterAmount, message }),
        headers:
          action === "accept"
            ? {
                "Idempotency-Key":
                  idempotencyKey ||
                  createIdempotencyKey(`offer-accept-${offerId}`),
              }
            : undefined,
      }),

    fetchListingOffers: (listingId: string) =>
      apiRequest<
        Array<{
          id: string;
          listing_id: string;
          buyer_id: string;
          amount: number;
          status: string;
          created_at: string;
        }>
      >(`/marketplace/listings/${listingId}/offers`),

    fetchMarketplaceOffers: (role: "buyer" | "seller" = "buyer") =>
      apiRequest<
        Array<{
          id: string;
          listing_id: string;
          buyer_id: string;
          seller_id: string;
          amount: number;
          message?: string;
          status: string;
          // Server selects * from marketplace_offers; these drive offer threading.
          proposed_by?: string | null;
          parent_offer_id?: string | null;
          created_at: string;
          updated_at?: string;
          // Drives client-side expiry gating so an expired offer's Accept/
          // Decline/Counter buttons are hidden instead of hitting the 409.
          expires_at?: string;
        }>
      >(`/marketplace/offers?role=${role}`, {}, 5000),

    buyNowListing: (
      listingId: string,
      couponCode?: string,
      idempotencyKey?: string,
      quantity?: number,
    ) =>
      apiRequest<{
        order: import("../types").MarketplaceOrder;
        authorizationUrl?: string;
        accessCode?: string;
        publicKey?: string;
        payment?: {
          id: string;
          reference: string;
          status: string;
          itemAmountKobo: number;
          serviceFeeKobo: number;
          totalChargeKobo: number;
          currency: string;
        };
      }>(
        `/marketplace/listings/${listingId}/buy-now`,
        {
          method: "POST",
          headers: {
            "Idempotency-Key":
              idempotencyKey || createIdempotencyKey("buy-now"),
          },
          body: JSON.stringify({
            ...(couponCode ? { couponCode } : {}),
            ...(quantity != null && quantity > 0 ? { quantity } : {}),
          }),
        },
      ),

    /** Free banks and owner re-downloads; delivers into offline_bundles. */
    downloadQuestionBank: (listingId: string) =>
      apiRequest<{ bundleId: string; questionCount: number }>(
        `/marketplace/listings/${listingId}/question-bank/download`,
        { method: "POST" },
        15000,
      ),

    /** Public sample — answers are stripped server-side. */
    fetchQuestionBankPreview: (listingId: string) =>
      apiRequest<{
        questionCount: number;
        version: number;
        owned: boolean;
        isSeller: boolean;
        previewCount: number;
        questions: Array<{
          id?: string;
          questionStem?: string;
          text?: string;
          questionType?: string;
          options?: Array<{ id: string; text: string }>;
          imageUrl?: string;
          tags?: string[];
        }>;
      }>(`/marketplace/listings/${listingId}/question-bank/preview`, {}, 10000),

    /** Publish an offline bundle as a digital question-bank listing. */
    publishQuestionBank: (input: {
      title: string;
      description?: string;
      price?: number | null;
      campusId: string;
      location?: string;
      groupId?: string | null;
      /** Academic archive: written on both the listing and the bank. */
      courseId?: string | null;
      /** Topic within `courseId`; only the listing carries it, not the bank. */
      topicId?: string | null;
      content: { config?: Record<string, unknown>; questions: unknown[] };
      /** Rights attestation (RIGHTS_ATTESTATION_TEXT) — required; 400 without it. */
      attestation: true;
      /** "This pack was AI-assisted" toggle. */
      aiAssisted?: boolean;
      /** Up to 20 short references (≤ 200 chars each). */
      sourcesCited?: string[];
    }) =>
      apiRequest<{
        listing: { id: string; title: string };
        bank: { listing_id: string; version: number; question_count: number };
      }>(
        `/marketplace/question-banks/publish`,
        { method: "POST", body: JSON.stringify(input) },
        20000,
      ),

    /**
     * Seller republish: replace the snapshot, bumping the version. Re-requires
     * the rights attestation (400 without it); aiAssisted / sourcesCited
     * refresh the bank's provenance when sent.
     */
    updateQuestionBankContent: (
      listingId: string,
      content: { config?: Record<string, unknown>; questions: unknown[] },
      provenance?: { attestation: boolean; aiAssisted?: boolean; sourcesCited?: string[] },
    ) =>
      apiRequest<{ version: number; questionCount: number }>(
        `/marketplace/question-banks/${listingId}/update-content`,
        { method: "POST", body: JSON.stringify({ content, ...(provenance ?? {}) }) },
        20000,
      ),

    /** Question banks the caller has published. */
    fetchMyQuestionBanks: () =>
      apiRequest<
        Array<{
          listingId: string;
          sourceGroupId: string | null;
          version: number;
          questionCount: number;
          title: string;
          price: number | null;
          status: string;
        }>
      >(`/marketplace/question-banks/mine`, {}, 10000),

    /** Record an attempt on an owned bank (best score is kept server-side). */
    recordQuestionBankScore: (
      listingId: string,
      correct: number,
      total: number,
    ) =>
      apiRequest<{
        bestScorePct: number;
        bestCorrect: number;
        bestTotal: number;
        attempts: number;
        improved: boolean;
      }>(
        `/marketplace/listings/${listingId}/question-bank/scores`,
        { method: "POST", body: JSON.stringify({ correct, total }) },
        10000,
      ),

    /** Top scores for a bank, plus the caller's standing. */
    fetchQuestionBankLeaderboard: (listingId: string, limit?: number) =>
      apiRequest<{
        entries: Array<{
          rank: number;
          userId: string;
          name: string;
          avatarUrl: string | null;
          scorePct: number;
          correct: number;
          total: number;
          attempts: number;
          isViewer: boolean;
        }>;
        viewerEntry: {
          rank: number;
          name: string;
          scorePct: number;
          correct: number;
          total: number;
          attempts: number;
        } | null;
      }>(
        `/marketplace/listings/${listingId}/question-bank/leaderboard${limit ? `?limit=${limit}` : ""}`,
        {},
        10000,
      ),

    /** Re-materialize owned banks onto this device. */
    restoreQuestionBanks: () =>
      apiRequest<{ restored: number }>(
        `/marketplace/question-banks/restore`,
        { method: "POST" },
        20000,
      ),

    /** Owned banks whose published version is newer than the local copy. */
    fetchQuestionBankUpdates: () =>
      apiRequest<
        Array<{
          listingId: string;
          bundleId: string;
          version: number;
          questionCount: number;
        }>
      >(`/marketplace/question-banks/updates`, {}, 10000),

    // ── Study packs (digital study products: guide + summaries + flashcards + questions) ──

    /** Free packs and owner re-downloads; delivers into offline_bundles + a deck + a note. */
    downloadStudyPack: (listingId: string) =>
      apiRequest<{
        bundleId: string | null;
        deckId: string | null;
        noteId: string | null;
        version: number;
      }>(
        `/marketplace/listings/${listingId}/study-pack/download`,
        { method: "POST" },
        15000,
      ),

    /** Public sample — question answers are stripped server-side. */
    fetchStudyPackPreview: (listingId: string) =>
      apiRequest<{
        title: string;
        counts: StudyPackCounts;
        toc: Array<{ title: string; anchor: string }>;
        summaryPreview: string | null;
        flashcardFronts: string[];
        questions: Array<{
          id?: string;
          questionStem?: string;
          text?: string;
          questionType?: string;
          options?: Array<{ id: string; text: string }>;
          imageUrl?: string;
          tags?: string[];
        }>;
        owned: boolean;
        isSeller: boolean;
        version: number;
      }>(`/marketplace/listings/${listingId}/study-pack/preview`, {}, 10000),

    /** Publish a study pack as a digital listing (from inline content or an AI draft). */
    publishStudyPack: (input: {
      title: string;
      description?: string;
      price?: number | null;
      campusId: string;
      location?: string;
      courseId?: string | null;
      /** Topic within `courseId`; only the listing carries it, not the pack. */
      topicId?: string | null;
      content?: StudyPackContentInput;
      /** Consume a ready AI draft instead of inline content (Phase 2 · H). */
      draftId?: string | null;
      /** Rights attestation (RIGHTS_ATTESTATION_TEXT) — required; 400 without it. */
      attestation: true;
      aiAssisted?: boolean;
      sourcesCited?: string[];
    }) =>
      apiRequest<{
        listing: { id: string; title: string };
        pack: { listingId: string; packId: string; version: number };
      }>(
        `/marketplace/study-packs/publish`,
        { method: "POST", body: JSON.stringify(input) },
        20000,
      ),

    /** Seller republish: replace the snapshot, bumping the version. Re-requires attestation. */
    updateStudyPackContent: (
      listingId: string,
      content: StudyPackContentInput,
      provenance?: { attestation: boolean; aiAssisted?: boolean; sourcesCited?: string[] },
    ) =>
      apiRequest<{ version: number; counts: StudyPackCounts }>(
        `/marketplace/study-packs/${listingId}/update-content`,
        { method: "POST", body: JSON.stringify({ content, ...(provenance ?? {}) }) },
        20000,
      ),

    /** Study packs the caller has published. */
    fetchMyStudyPacks: () =>
      apiRequest<
        Array<{
          listingId: string;
          version: number;
          counts: StudyPackCounts;
          courseId: string | null;
          title: string;
          price: number | null;
          status: string;
        }>
      >(`/marketplace/study-packs/mine`, {}, 10000),

    /** Re-materialize owned packs onto this device (deck/note/bundle). */
    restoreStudyPacks: () =>
      apiRequest<{ restored: number }>(
        `/marketplace/study-packs/restore`,
        { method: "POST" },
        20000,
      ),

    /** Owned packs whose published version is newer than the local copy. */
    fetchStudyPackUpdates: () =>
      apiRequest<
        Array<{
          listingId: string;
          bundleId: string;
          version: number;
          counts: StudyPackCounts;
        }>
      >(`/marketplace/study-packs/updates`, {}, 10000),

    /** Unified buyer library across question banks + study packs. */
    fetchMarketplacePurchases: () =>
      apiRequest<
        Array<{
          listingId: string;
          kind: "question_bank" | "study_pack";
          title: string;
          sellerId: string;
          sellerName: string;
          version: number;
          versionAtDownload: number;
          updateAvailable: boolean;
          deliveredRefs: { bundleId?: string; deckId?: string; noteId?: string; version?: number };
          courseId: string | null;
          purchasedAt: string;
        }>
      >(`/marketplace/purchases`, {}, 10000),

    // ── AI Study Product Factory (Phase 2 · H) ──

    /** Charge 5 AI credits and start generating a study-pack draft (async). */
    // Uses the raw response: the route replies with a flat 202/201 (draftId at
    // the top level), not a { data } envelope.
    createStudyPackDraft: (input: {
      noteIds?: string[];
      folderId?: string | null;
      courseId?: string | null;
      title?: string;
    }) =>
      apiRequestRaw<{
        success: true;
        draftId: string;
        jobId?: string;
        status?: string;
        draft?: StudyPackDraft;
      }>(
        `/ai/study-pack/draft`,
        { method: "POST", body: JSON.stringify(input) },
        30000,
      ),

    /** The caller's drafts (excludes already-published ones). */
    fetchStudyPackDrafts: () =>
      apiRequest<StudyPackDraftSummary[]>(`/ai/study-pack/drafts`, {}, 10000),

    /** One draft with its full generated content. */
    fetchStudyPackDraft: (draftId: string) =>
      apiRequest<StudyPackDraft>(`/ai/study-pack/drafts/${draftId}`, {}, 10000),

    deleteStudyPackDraft: (draftId: string) =>
      apiRequestRaw<{ success: true }>(
        `/ai/study-pack/drafts/${draftId}`,
        { method: "DELETE" },
        10000,
      ),

    /** Phase 4 · S — proposed packs + remaining credit budget. Does not charge. */
    fetchSemesterPackProposals: (academicYear?: string) => {
      const qs = academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : "";
      return apiRequest<SemesterPackProposalResponse>(
        `/ai/study-pack/semester-proposals${qs}`,
        {},
        15000,
      );
    },

    /** Auth'd AI health — includes handwritingOcr on/off for the photo-notes banner. */
    fetchAiHealth: () =>
      apiRequestRaw<{
        handwritingOcr?: "on" | "off";
        gemini?: "on" | "off";
      }>(`/ai/health`, {}, 8000),

    // ── Creators (Phase 2 · J) ──

    /** Public creator profile: academic line, bio, stats, packs. Never earnings. */
    fetchCreatorProfile: (userId: string) =>
      apiRequest<{
        id: string;
        username: string | null;
        name: string;
        avatarUrl: string | null;
        bio: string | null;
        institution: string | null;
        programme: string | null;
        studyLevel: number | null;
        stats: {
          activePacks: number;
          learnersHelped: number;
          avgRating: number;
          reviewCount: number;
          followerCount: number;
          followingCount?: number;
        };
        isFollowing: boolean;
        isVerified: boolean;
        trustLevel: string;
        packs: Array<{
          id: string;
          title: string;
          price: number | null;
          images: string[];
          listingKind: string;
          courseId: string | null;
        }>;
      }>(`/creators/${userId}`, {}, 10000),

    fetchCreatorDiscovery: (params: { institutionId?: string; courseId?: string; limit?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.institutionId) q.set('institutionId', params.institutionId);
      if (params.courseId) q.set('courseId', params.courseId);
      if (params.limit) q.set('limit', String(params.limit));
      return apiRequest<
        Array<{
          id: string;
          name: string;
          username: string | null;
          avatarUrl: string | null;
          programme: string | null;
          activePacks: number;
          learnersHelped: number;
          avgRating: number;
          followerCount: number;
          trustLevel: string;
          isVerified: boolean;
        }>
      >(`/creators/discover${q.toString() ? `?${q}` : ''}`, {}, 10000);
    },

    // -----------------------------------------------------------------
    // Phase 3 — Network (communities, discovery, feed, presence, mastery)
    // -----------------------------------------------------------------

    /** The caller's own communities (auto-derived + joined). */
    fetchMyCommunities: () => apiRequest<MyCommunity[]>('/communities', {}, 10000),

    fetchCommunity: (slug: string) =>
      apiRequest<CommunityDetail>(`/communities/${encodeURIComponent(slug)}`, {}, 10000),

    fetchCommunityMembers: (communityId: string, limit?: number) =>
      apiRequest<Array<{ id: string; name: string; avatarUrl: string | null; programme: string | null }>>(
        `/communities/${communityId}/members${limit ? `?limit=${limit}` : ''}`,
        {},
        10000
      ),

    joinCommunity: (communityId: string) =>
      apiRequest<{ joined: true }>(`/communities/${communityId}/join`, { method: 'POST' }, 10000),

    leaveCommunity: (communityId: string) =>
      apiRequest<{ left: true }>(`/communities/${communityId}/join`, { method: 'DELETE' }, 10000),

    /** Horizontal (topic) communities — the only kind a person can create. */
    createCommunity: (body: { name: string; description?: string; tags?: string[] }) =>
      apiRequest<Community>('/communities', {
        method: 'POST',
        body: JSON.stringify(body),
      }, 10000),

    /**
     * Join a group that is already on Discover (public, or community-visible
     * to a room the viewer belongs to). Private groups stay invite-link only.
     */
    joinDiscoverableGroup: (groupId: string) =>
      apiRequest<{ joined: true }>(
        `/discover/groups/${encodeURIComponent(groupId)}/join`,
        { method: 'POST' },
        10000
      ),

    discoverCommunities: (
      params: { q?: string; kind?: string; institutionId?: string; courseId?: string; limit?: number } = {}
    ) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.kind) qs.set('kind', params.kind);
      if (params.institutionId) qs.set('institutionId', params.institutionId);
      if (params.courseId) qs.set('courseId', params.courseId);
      if (params.limit) qs.set('limit', String(params.limit));
      return apiRequest<Community[]>(
        `/discover/communities${qs.toString() ? `?${qs}` : ''}`,
        {},
        10000
      );
    },

    /**
     * Discoverable groups. NOT `/groups`, which is memberships-only and cached
     * per user — mixing the two would put non-member groups in the sidebar.
     */
    discoverGroups: (
      params: { q?: string; communityId?: string; courseId?: string; limit?: number } = {}
    ) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.communityId) qs.set('communityId', params.communityId);
      if (params.courseId) qs.set('courseId', params.courseId);
      if (params.limit) qs.set('limit', String(params.limit));
      return apiRequest<DiscoverGroup[]>(`/discover/groups${qs.toString() ? `?${qs}` : ''}`, {}, 10000);
    },

    discoverPeople: (params: { q?: string; institutionId?: string; courseId?: string; limit?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.institutionId) qs.set('institutionId', params.institutionId);
      if (params.courseId) qs.set('courseId', params.courseId);
      if (params.limit) qs.set('limit', String(params.limit));
      return apiRequest<DiscoverPerson[]>(`/discover/people${qs.toString() ? `?${qs}` : ''}`, {}, 10000);
    },

    /** "23 people studying cardiology right now" — counts only, never names. */
    fetchStudyPresence: (params: { courseId?: string; institutionId?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.courseId) qs.set('courseId', params.courseId);
      if (params.institutionId) qs.set('institutionId', params.institutionId);
      return apiRequest<PresenceSnapshot>(`/discover/presence${qs.toString() ? `?${qs}` : ''}`, {}, 10000);
    },

    /**
     * Study intent rides the EXISTING presence heartbeat rather than a second
     * timer. A body-less heartbeat keeps the old online-status behaviour.
     */
    sendStudyHeartbeat: (body: { context?: string; courseId?: string; topic?: string }) =>
      apiRequest<{ success: true; studySharing?: boolean }>(
        '/users/presence/heartbeat',
        { method: 'POST', body: JSON.stringify(body) },
        10000
      ),

    clearStudyPresence: () =>
      apiRequest<{ success: true }>('/users/presence/study', { method: 'DELETE' }, 10000),

    /** The academic feed. Pull-based and cursor-paged; never a realtime channel. */
    fetchFeed: (params: { limit?: number; before?: string } = {}) => {
      const qs = new URLSearchParams();
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.before) qs.set('before', params.before);
      return apiRequest<FeedPage>(`/feed${qs.toString() ? `?${qs}` : ''}`, {}, 10000);
    },

    fetchLearningConnections: () =>
      apiRequest<LearningConnectionSummary>('/feed/connections', {}, 10000),

    fetchMasteryGraph: (params: { courseId?: string; limit?: number } = {}) => {
      const qs = new URLSearchParams();
      if (params.courseId) qs.set('courseId', params.courseId);
      if (params.limit) qs.set('limit', String(params.limit));
      return apiRequest<MasteryGraph>(`/mastery${qs.toString() ? `?${qs}` : ''}`, {}, 15000);
    },

    refreshMasteryGraph: () =>
      apiRequest<{ topics: TopicMastery[] }>('/mastery/refresh', { method: 'POST' }, 20000),

    fetchExamReadiness: () => apiRequest<ExamReadiness[]>('/mastery/exam-readiness', {}, 10000),

    /** Phase 4 Q — the caller's referral code, stats and referred users. */
    fetchReferralSummary: () => apiRequest<ReferralSummary>('/referrals', {}, 10000),

    fetchAmbassadors: (institutionId: string, limit?: number) => {
      const qs = new URLSearchParams({ institutionId });
      if (limit) qs.set('limit', String(limit));
      return apiRequest<
        Array<{ id: string; name: string; avatarUrl: string | null; programme: string | null }>
      >(`/referrals/ambassadors?${qs}`, {}, 10000);
    },

    joinOrCreateStudyRoom: (input: {
      courseId?: string | null;
      communityId?: string | null;
      topicId?: string | null;
      topic?: string | null;
      title?: string | null;
    }) =>
      apiRequest<import('../network').StudyRoomDetail>(
        '/study-rooms/join-or-create',
        { method: 'POST', body: JSON.stringify(input) },
        15000,
      ),

    fetchStudyRoom: (roomId: string) =>
      apiRequest<import('../network').StudyRoomDetail>(
        `/study-rooms/${encodeURIComponent(roomId)}`,
        {},
        10000,
      ),

    joinStudyRoom: (roomId: string) =>
      apiRequest<import('../network').StudyRoomDetail>(
        `/study-rooms/${encodeURIComponent(roomId)}/join`,
        { method: 'POST', body: '{}' },
        10000,
      ),

    leaveStudyRoom: (roomId: string) =>
      apiRequest<{ left: true }>(
        `/study-rooms/${encodeURIComponent(roomId)}/leave`,
        { method: 'POST', body: '{}' },
        10000,
      ),

    /** Population aggregate; the server refuses below a 20-student cohort. */
    fetchCourseMastery: (courseId: string) =>
      apiRequest<Record<string, unknown>>(`/mastery/course/${courseId}`, {}, 10000),

    followCreator: (userId: string) =>
      apiRequest<{ following: true }>(`/users/${userId}/follow`, { method: 'POST' }, 10000),

    unfollowCreator: (userId: string) =>
      apiRequest<{ following: false }>(`/users/${userId}/follow`, { method: 'DELETE' }, 10000),

    /** The seller's earnings ledger (Phase 2 · I). Owner-only server-side. */
    fetchSellerPayments: (page = 1) =>
      apiRequest<
        Array<{
          orderId: string;
          listingId: string | null;
          title: string;
          itemAmountKobo: number;
          platformFeeKobo: number;
          sellerPayoutKobo: number;
          status: string;
          paidAt: string | null;
          payoutAt: string | null;
        }>
      >(`/marketplace/seller/payments?page=${page}`, {}, 10000),

    fetchMarketplacePaymentsConfig: () =>
      apiRequest<{
        paystackEnabled: boolean;
        publicKey: string | null;
        serviceFeeBps: number;
      }>("/marketplace/payments/config", {}, 5000),

    verifyMarketplacePayment: (reference: string) =>
      apiRequest<{
        payment: Record<string, unknown>;
        order: import("../types").MarketplaceOrder | null;
        alreadySettled?: boolean;
      }>(`/marketplace/payments/${encodeURIComponent(reference)}/verify`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    fetchSellerPayoutProfile: () =>
      apiRequest<{
        user_id: string;
        bank_code: string | null;
        account_number_last4: string | null;
        account_name: string | null;
        status: string;
        verified_at: string | null;
      } | null>("/marketplace/seller/payout-profile", {}, 5000),

    upsertSellerPayoutProfile: (data: {
      accountNumber: string;
      bankCode: string;
    }) =>
      apiRequest<{
        user_id: string;
        bank_code: string | null;
        account_number_last4: string | null;
        account_name: string | null;
        status: string;
        verified_at: string | null;
      }>("/marketplace/seller/payout-profile", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    fetchPaystackBanks: () =>
      apiRequest<Array<{ name: string; code: string }>>(
        "/marketplace/seller/banks",
        {},
        10000,
      ),

    fetchMarketplaceCart: () =>
      apiRequest<import("../types").MarketplaceCartItem[]>(
        "/marketplace/cart",
        {},
        5000,
      ),

    addToMarketplaceCart: (listingId: string, quantity?: number) =>
      apiRequest<import("../types").MarketplaceCartItem>("/marketplace/cart", {
        method: "POST",
        body: JSON.stringify({
          listingId,
          ...(quantity != null && quantity > 0 ? { quantity } : {}),
        }),
      }),

    updateMarketplaceCartItem: (listingId: string, quantity: number) =>
      apiRequest<import("../types").MarketplaceCartItem | null>(
        `/marketplace/cart/${listingId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ quantity }),
        },
      ),

    removeMarketplaceCartItem: (listingId: string) =>
      apiRequest<{ removed: boolean }>(`/marketplace/cart/${listingId}`, {
        method: "DELETE",
      }),

    clearMarketplaceCart: () =>
      apiRequest<{ cleared: boolean }>("/marketplace/cart", {
        method: "DELETE",
      }),

    checkoutMarketplaceCart: (idempotencyKey?: string) =>
      apiRequest<{
        orders: import("../types").MarketplaceOrder[];
        failures: Array<{ listingId: string; error: string }>;
        sessions?: Array<{
          order?: import("../types").MarketplaceOrder;
          authorizationUrl?: string;
          payment?: {
            itemAmountKobo: number;
            serviceFeeKobo: number;
            totalChargeKobo: number;
          };
        }>;
        authorizationUrl?: string;
      }>("/marketplace/cart/checkout", {
        method: "POST",
        headers: {
          "Idempotency-Key":
            idempotencyKey || createIdempotencyKey("cart-checkout"),
        },
        body: JSON.stringify({}),
      }),

    resumeMarketplaceOrderCheckout: (orderId: string) =>
      apiRequest<{
        order: import("../types").MarketplaceOrder;
        authorizationUrl?: string;
        accessCode?: string;
        publicKey?: string;
        payment?: {
          id: string;
          reference: string;
          status: string;
          itemAmountKobo: number;
          serviceFeeKobo: number;
          totalChargeKobo: number;
          currency: string;
        };
      }>(`/marketplace/orders/${orderId}/checkout`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    fetchMarketplaceOrders: (role: "buyer" | "seller" = "buyer") =>
      apiRequest<import("../types").MarketplaceOrder[]>(
        `/marketplace/orders?role=${role}`,
        {},
        5000,
      ),

    fetchMarketplaceOrder: (orderId: string) =>
      apiRequest<import("../types").MarketplaceOrder>(
        `/marketplace/orders/${orderId}`,
        {},
        5000,
      ),

    fetchOrderForInquiry: (inquiryId: string) =>
      apiRequest<import("../types").MarketplaceOrder | null>(
        `/marketplace/orders/inquiry/${inquiryId}`,
        {},
        5000,
      ),

    updateMarketplaceOrder: (
      orderId: string,
      payload: {
        action: string;
        meetingLocation?: string;
        sellerNote?: string;
        fulfillmentMode?: string;
        /** Phase 3 N — carried by `open_dispute` only; ignored otherwise. */
        disputeReason?: string;
        disputeCategory?: string;
      },
    ) =>
      apiRequest<import("../types").MarketplaceOrder>(
        `/marketplace/orders/${orderId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      ),

    requestOrderPayment: (orderId: string) =>
      apiRequest<{ orderId: string; amount: number; deepLink: string }>(
        `/marketplace/orders/${orderId}/payment-link`,
        { method: "POST" },
      ),

    fetchSellerAnalytics: () =>
      apiRequest<import("../types").SellerAnalytics>(
        "/marketplace/analytics/seller",
        {},
        5000,
      ),

    fetchSellerBuyers: (segment?: string) =>
      apiRequest<import("../types").SellerBuyerContact[]>(
        `/marketplace/seller/buyers${segment ? `?segment=${encodeURIComponent(segment)}` : ""}`,
        {},
        5000,
      ),

    fetchSellerCoupons: () =>
      apiRequest<import("../types").MarketplaceCoupon[]>(
        "/marketplace/coupons",
        {},
        5000,
      ),

    createSellerCoupon: (data: {
      code: string;
      discountType: "percent" | "fixed";
      discountValue: number;
      listingId?: string;
      maxUses?: number;
      endsAt?: string;
    }) =>
      apiRequest<import("../types").MarketplaceCoupon>("/marketplace/coupons", {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Idempotency-Key": createIdempotencyKey(`create-coupon-${data.code}`),
        },
      }),

    validateMarketplaceCoupon: (code: string, listingId: string) =>
      apiRequest<import("../types").CouponValidationResult>(
        "/marketplace/coupons/validate",
        {
          method: "POST",
          body: JSON.stringify({ code, listingId }),
        },
      ),

    fetchSellerPreferences: () =>
      apiRequest<import("../types").MarketplaceSellerPreferences>(
        "/marketplace/seller/preferences",
        {},
        5000,
      ),

    updateSellerPreferences: (data: {
      hallDropoffEnabled?: boolean;
      hallDropoffMinAmount?: number | null;
      requirePaymentConfirmation?: boolean;
      favoriteAlertThreshold?: number;
    }) =>
      apiRequest<import("../types").MarketplaceSellerPreferences>(
        "/marketplace/seller/preferences",
        { method: "PUT", body: JSON.stringify(data) },
      ),

    fetchPickupNudge: (sellerId: string) =>
      apiRequest<import("../types").MarketplacePickupNudge>(
        `/marketplace/sellers/${sellerId}/pickup-nudge`,
        {},
        5000,
      ),

    sendSellerCampaign: (data: {
      message: string;
      segment?: string;
      buyerIds?: string[];
    }) =>
      apiRequest<{ sent: number; skipped: number }>(
        "/marketplace/seller/campaigns",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),

    createMarketplaceBundle: (data: {
      title: string;
      description?: string;
      price: number;
      listingIds: string[];
      // The API requires a campus; without it every create 400s. The server
      // accepts campus_id or campusId. `location` carries the free-text city
      // for an "Other — city" campus.
      campusId: string;
      country_code?: string;
      location?: string;
    }) =>
      apiRequest<import("../types").MarketplaceListing>(
        "/marketplace/bundles",
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),

    fetchSellerOnboarding: () =>
      apiRequest<import("../types").SellerOnboardingStatus>(
        "/marketplace/seller/onboarding",
        {},
        5000,
      ),

    completeSellerOnboarding: () =>
      apiRequest<import("../types").MarketplaceSellerPreferences>(
        "/marketplace/seller/onboarding/complete",
        { method: "POST" },
      ),

    submitOrderPaymentProof: (orderId: string, proofUrl: string) =>
      apiRequest<import("../types").MarketplaceOrder>(
        `/marketplace/orders/${orderId}/payment-proof`,
        { method: "POST", body: JSON.stringify({ proofUrl }) },
      ),

    fetchListingOffersHistory: (listingId: string) =>
      apiRequest<import("../types").MarketplaceOffer[]>(
        `/marketplace/listings/${listingId}/offers-history`,
      ),

    checkSavedSearchMatches: (searchId: string) =>
      apiRequest<{
        count: number;
        listings: import("../types").MarketplaceListing[];
      }>(`/marketplace/saved-searches/${searchId}/matches`, {}, 5000),

    updateSavedSearch: (
      id: string,
      updates: { notify?: boolean; name?: string },
    ) =>
      apiRequest<{ id: string; notify: boolean; name: string }>(
        `/marketplace/saved-searches/${id}`,
        { method: "PATCH", body: JSON.stringify(updates) },
      ),

    boostListing: (listingId: string, idempotencyKey?: string) =>
      apiRequest<{
        id: string;
        category_specific_fields?: {
          boosted_until?: string;
          boost_level?: string;
        };
        updated_at: string;
      }>(`/marketplace/listings/${listingId}/boost`, {
        method: "POST",
        body: JSON.stringify({ durationHours: 72 }),
        headers: {
          "Idempotency-Key":
            idempotencyKey || createIdempotencyKey(`boost-${listingId}`),
        },
      }),

    uploadMarketplaceImage: (payload: {
      fileName: string;
      base64Data: string;
      contentType?: string;
      listingId?: string;
    }) =>
      apiRequest<{ url: string; path: string; storageUrl?: string }>(
        "/marketplace/upload-image",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),

    uploadChatImage: (payload: {
      fileName: string;
      base64Data: string;
      contentType: string;
      groupId?: string;
    }) =>
      apiRequest<{ url: string; path: string }>("/messages/upload-image", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    uploadChatAudio: (payload: {
      fileName: string;
      base64Data: string;
      contentType: string;
      groupId?: string;
      threadId?: string;
    }) =>
      apiRequest<{ url: string; path: string }>("/messages/upload-audio", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    uploadQuestionImage: (payload: {
      fileName: string;
      base64Data: string;
      contentType: string;
    }) =>
      apiRequest<{ url: string; path: string }>(
        "/messages/upload-question-image",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),

    fetchSavedSearches: () =>
      apiRequest<
        Array<{
          id: string;
          user_id: string;
          name: string;
          filters: Record<string, unknown>;
          created_at: string;
        }>
      >("/marketplace/saved-searches", {}, 5000),

    createSavedSearch: (data: {
      filters: Record<string, unknown>;
      name?: string;
    }) =>
      apiRequest<{
        id: string;
        user_id: string;
        name: string;
        filters: Record<string, unknown>;
        created_at: string;
      }>("/marketplace/saved-searches", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    deleteSavedSearch: (id: string) =>
      apiRequest<void>(`/marketplace/saved-searches/${id}`, {
        method: "DELETE",
      }),

    fetchSellerProfile: (sellerId: string) =>
      apiRequest<import("../types").SellerProfile>(
        `/marketplace/sellers/${sellerId}/profile`,
        {},
        5000,
      ),

    updateMyShop: (data: {
      shopName?: string;
      bio?: string | null;
      coverImageUrl?: string | null;
    }) =>
      apiRequest<import("../types").SellerShop>("/marketplace/sellers/me/shop", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    fetchMarketplaceShops: (params?: {
      campus?: string;
      q?: string;
      page?: number;
      limit?: number;
    }) => {
      const search = new URLSearchParams();
      if (params?.campus) search.set("campus", params.campus);
      if (params?.q) search.set("q", params.q);
      if (params?.page) search.set("page", String(params.page));
      if (params?.limit) search.set("limit", String(params.limit));
      const qs = search.toString();
      return apiRequest<import("../types").MarketplaceShopCard[]>(
        `/marketplace/shops${qs ? `?${qs}` : ""}`,
        {},
        8000,
      );
    },

    // ========== BUDGET API ==========

    /**
     * The server answers 200 with a null payload for a month that was never
     * budgeted, so a thrown error here means the request genuinely failed.
     * This used to swallow every error and return null, which made "no budget
     * for July" indistinguishable from "could not reach the server" — the
     * screen then asserted a fact about the user's finances it had not checked.
     * Callers must handle the throw.
     */
    fetchUserBudget: (userId: string, monthYear?: string) => {
      const params = monthYear ? `?monthYear=${monthYear}` : "";
      return apiRequest<{
        monthly_limit: number;
        month_year: string;
      } | null>(`/users/${userId}/budget${params}`);
    },

    saveUserBudget: (
      userId: string,
      budget: { monthlyLimit: number; monthYear: string },
    ) =>
      apiRequest<void>(`/users/${userId}/budget`, {
        method: "PUT",
        body: JSON.stringify(budget),
      }),

    fetchBudgetTransactions: (userId: string) =>
      apiRequest<
        Array<{
          id: string;
          user_id: string;
          type: "income" | "expense" | "investment";
          amount: number;
          category?: string;
          description?: string;
          date: string;
        }>
      >(`/users/${userId}/transactions`),

    saveBudgetTransaction: (
      _userId: string,
      transaction: {
        id: string;
        type: string;
        amount: number;
        category?: string;
        description?: string;
        date: string;
      },
      idempotencyKey?: string,
    ) =>
      apiRequest<{
        transaction: unknown;
        warning: unknown;
      }>("/budget/transactions", {
        method: "POST",
        body: JSON.stringify({
          id: transaction.id,
          type: transaction.type.toLowerCase(),
          amount: transaction.amount,
          category: transaction.category,
          description: transaction.description,
          date: transaction.date,
        }),
        headers: {
          "Idempotency-Key":
            idempotencyKey ||
            createIdempotencyKey(`budget-tx-${transaction.id}`),
        },
      }),

    deleteBudgetTransaction: (_userId: string, transactionId: string) =>
      apiRequest<void>(`/budget/transactions/${transactionId}`, {
        method: "DELETE",
      }),

    fetchBudgetWallet: () =>
      apiRequest<{
        walletBalance: number;
        savingsGoals: any[];
        expenseSplits: any[];
        categoryBudgets?: Record<string, number>;
      }>("/budget/wallet"),

    createSavingsGoal: (goal: {
      name: string;
      targetAmount: number;
      icon?: string;
      deadline?: string;
    }) =>
      apiRequest<{ goal: any; walletBalance: number }>("/budget/goals", {
        method: "POST",
        body: JSON.stringify(goal),
      }),

    deleteSavingsGoal: (goalId: string) =>
      apiRequest<{ walletBalance: number }>(`/budget/goals/${goalId}`, {
        method: "DELETE",
      }),

    // Recurring budget rules (allowance, hostel, data). See routes/budget.ts.
    listRecurring: () =>
      apiRequest<{ rules: any[] }>("/budget/recurring"),

    createRecurring: (rule: {
      type: "income" | "expense";
      amount: number;
      category?: string | null;
      description?: string | null;
      frequency: "weekly" | "monthly";
      dayOfMonth?: number | null;
      nextDate: string;
    }) =>
      apiRequest<{ rule: any }>("/budget/recurring", {
        method: "POST",
        body: JSON.stringify(rule),
      }),

    deleteRecurring: (id: string) =>
      apiRequest<Record<string, unknown>>(`/budget/recurring/${id}`, {
        method: "DELETE",
      }),

    runRecurring: () =>
      apiRequest<{ posted: number }>("/budget/recurring/run", {
        method: "POST",
        body: "{}",
      }),

    contributeToSavingsGoal: (
      goalId: string,
      amount: number,
      idempotencyKey?: string,
    ) =>
      apiRequest<{
        goal: any;
        transaction: any;
        walletBalance: number;
        awarded: number;
      }>(`/budget/goals/${goalId}/contribute`, {
        method: "POST",
        body: JSON.stringify({ amount }),
        headers: {
          "Idempotency-Key":
            idempotencyKey ||
            createIdempotencyKey(`budget-contribute-${goalId}`),
        },
      }),

    claimUnderBudgetAward: () =>
      apiRequest<{
        awarded: number;
        walletBalance: number;
        alreadyAwarded?: boolean;
        reason?: string;
      }>("/budget/awards/under-budget", { method: "POST", body: "{}" }),

    // ========== OFFLINE BUNDLES API ==========

    fetchOfflineBundles: (userId: string) =>
      apiRequest<
        Array<{
          bundle_id: string;
          config: unknown;
          questions: unknown[];
          group_name: string;
          display_name?: string;
          downloaded_at: string;
        }>
      >("/offline-bundles"),

    saveOfflineBundle: (
      userId: string,
      bundle: {
        bundleId: string;
        config: unknown;
        questions: unknown[];
        groupName: string;
        displayName?: string;
        downloadedAt: Date | string;
      },
    ) =>
      apiRequest<void>("/offline-bundles", {
        method: "POST",
        body: JSON.stringify({
          userId,
          bundle: {
            ...bundle,
            downloadedAt:
              bundle.downloadedAt instanceof Date
                ? bundle.downloadedAt.toISOString()
                : bundle.downloadedAt,
          },
        }),
      }),

    deleteOfflineBundle: (userId: string, bundleId: string) =>
      apiRequest<void>(
        `/offline-bundles?bundleId=${encodeURIComponent(bundleId)}`,
        {
          method: "DELETE",
        },
      ),

    // ========== CHALLENGES API ==========

    createChallenge: (payload: {
      groupId: string;
      opponentId: string;
      config: {
        numberOfQuestions: number;
        allowedQuestionTypes?: string[];
        selectedTags?: string[];
      };
    }) =>
      // challengeService serializes rows to the camelCase GroupChallenge shape.
      apiRequest<import("../types").GroupChallenge>("/challenges", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    fetchChallenges: (status?: string) => {
      const q = status ? `?status=${encodeURIComponent(status)}` : "";
      return apiRequest<Array<import("../types").GroupChallenge>>(
        `/challenges${q}`,
      );
    },

    fetchChallenge: (challengeId: string) =>
      apiRequest<import("../types").GroupChallenge>(
        `/challenges/${encodeURIComponent(challengeId)}`,
      ),

    acceptChallenge: (challengeId: string) =>
      apiRequest<import("../types").GroupChallenge>(
        `/challenges/${encodeURIComponent(challengeId)}/accept`,
        {
          method: "POST",
        },
      ),

    declineChallenge: (challengeId: string) =>
      apiRequest<import("../types").GroupChallenge>(
        `/challenges/${encodeURIComponent(challengeId)}/decline`,
        {
          method: "POST",
        },
      ),

    submitChallenge: (
      challengeId: string,
      answers: Record<string, import("../types").UserAnswerRecord>,
    ) =>
      apiRequest<import("../types").GroupChallenge>(
        `/challenges/${encodeURIComponent(challengeId)}/submit`,
        {
          method: "POST",
          body: JSON.stringify({ answers }),
        },
      ),

    forfeitChallenge: (challengeId: string) =>
      apiRequest<import("../types").GroupChallenge>(
        `/challenges/${encodeURIComponent(challengeId)}/forfeit`,
        {
          method: "POST",
        },
      ),

    // ========== PREFERENCES API ==========

    fetchUserPreferences: (userId: string) =>
      apiRequest<{
        theme: string;
        lowDataMode: boolean;
        preferences?: Record<string, unknown>;
      } | null>(`/preferences/${encodeURIComponent(userId)}`),

    saveUserPreferences: (
      userId: string,
      prefs: {
        theme: string;
        lowDataMode: boolean;
        /** Canonical appearance theme including `system` (stored in preferences JSONB). */
        themePreference?: "light" | "dark" | "system";
      },
    ) =>
      apiRequest<void>("/preferences", {
        method: "POST",
        body: JSON.stringify({
          userId,
          theme: prefs.theme === "dark" ? "dark" : "light",
          preferences: {
            lowDataMode: prefs.lowDataMode,
            themePreference: prefs.themePreference ?? prefs.theme,
          },
        }),
      }),

    fetchMarketplaceCampuses: (country = "NG") =>
      apiRequest<
        Array<{
          id: string;
          name: string;
          city: string;
          state: string;
          country_code: string;
          slug: string;
        }>
      >(`/marketplace/campuses?country=${encodeURIComponent(country)}`),

    fetchMarketplaceTaxonomy: () =>
      apiRequest<{
        leaves: Array<{
          id: string;
          listingCategory?: string;
          label: string;
          pathLabel: string;
          department: string;
          publishFlow: string;
        }>;
        browse: {
          academic: Array<{ id: string; name: string }>;
          "student-life": Array<{ id: string; name: string }>;
        };
      }>("/marketplace/taxonomy"),

    classifyMarketplaceListing: (input: {
      title: string;
      description?: string;
      department?: "academic" | "student-life";
    }) =>
      apiRequest<{
        suggestions: Array<{
          nodeId: string;
          listingCategory?: string;
          publishFlow: string;
          label: string;
          summary: string;
          pathLabel?: string;
          confidence: number;
          reasons: Array<{ kind: string; text: string }>;
        }>;
      }>("/marketplace/classify", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    // ========== ACADEMIC: COURSES + MY COURSES (/api/v1/courses, /api/v1/users/me/courses) ==========
    // Shapes pinned by docs/phase1-academic-identity-contract.md §2/§3.

    /** Search the shared course catalogue (canonical first, then by code). */
    fetchCourses: (
      filters: { institutionId?: string | null; q?: string; limit?: number } = {},
    ) => {
      const params = new URLSearchParams();
      if (filters.institutionId) params.set("institutionId", filters.institutionId);
      if (filters.q && filters.q.trim()) params.set("q", filters.q.trim());
      if (filters.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiRequest<Course[]>(`/courses${qs ? `?${qs}` : ""}`, {}, 10000);
    },

    /** Find-or-create a course by normalised code (201 created / 200 existing — both return the row). */
    createCourse: (input: {
      institutionId?: string | null;
      code: string;
      title: string;
      faculty?: string | null;
      level?: number | null;
      semester?: 1 | 2 | null;
    }) =>
      apiRequest<Course>("/courses", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    /** The caller's enrolments (default: active only). */
    fetchMyCourses: (
      filters: { status?: "active" | "archived" | "all"; academicYear?: string } = {},
    ) => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.academicYear) params.set("academicYear", filters.academicYear);
      const qs = params.toString();
      return apiRequest<UserCourse[]>(`/users/me/courses${qs ? `?${qs}` : ""}`);
    },

    /**
     * Replace the caller's course set for an academic year: listed ids are
     * upserted as active, rows for that year not in the list are deleted.
     */
    setMyCourses: (input: { courseIds: string[]; academicYear?: string }) =>
      apiRequest<UserCourse[]>("/users/me/courses", {
        method: "PUT",
        body: JSON.stringify(input),
      }),

    updateMyCourse: (
      courseId: string,
      patch: {
        examDate?: string | null;
        semester?: 1 | 2 | null;
        status?: "active" | "archived";
        academicYear?: string;
      },
    ) =>
      apiRequest<UserCourse>(`/users/me/courses/${encodeURIComponent(courseId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),

    removeMyCourse: (courseId: string, academicYear?: string) =>
      apiRequest<void>(
        `/users/me/courses/${encodeURIComponent(courseId)}${
          academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : ""
        }`,
        { method: "DELETE" },
      ),

    /** Mark every enrolment of that academic year archived (nothing moves). */
    archiveSemester: (academicYear: string) =>
      apiRequest<{ archived: number }>("/users/me/courses/archive-semester", {
        method: "POST",
        body: JSON.stringify({ academicYear }),
      }),

    // ========== CONCEPTS (/api/v1/concepts) ==========
    // Thin clients for the knowledge-network vocabulary (Phase 1 · C). The
    // concept-tagging UI is Phase 3 P; shapes pinned by
    // docs/phase1-learning-events-contract.md §2.

    /** Search concepts by name (trigram), optionally scoped to a course. */
    fetchConcepts: (
      filters: { q?: string; courseId?: string | null; limit?: number } = {},
    ) => {
      const params = new URLSearchParams();
      if (filters.q && filters.q.trim()) params.set("q", filters.q.trim());
      if (filters.courseId) params.set("courseId", filters.courseId);
      if (filters.limit) params.set("limit", String(filters.limit));
      const qs = params.toString();
      return apiRequest<Concept[]>(`/concepts${qs ? `?${qs}` : ""}`, {}, 10000);
    },

    /** Find-or-create a concept by normalised slug (201 created / 200 existing — both return the row). */
    createConcept: (input: {
      name: string;
      courseId?: string | null;
      parentId?: string | null;
      source?: "ai" | "user" | "import";
    }) =>
      apiRequest<Concept>("/concepts", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    /** Link a concept to a flashcard / question / note / deck (idempotent upsert on the triple). */
    linkConcept: (
      conceptId: string,
      input: {
        targetType: "flashcard" | "question" | "note" | "deck";
        targetId: string;
        confidence?: number;
        source?: "ai" | "user" | "import";
      },
    ) =>
      apiRequest<ConceptLink>(`/concepts/${encodeURIComponent(conceptId)}/links`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    // ========== LIBRARY ARCHIVE (/api/v1/library) ==========
    // Shapes pinned by docs/phase1-library-archive-contract.md §1.

    /** The Library tree: years → courses (with enrolment + counts) + unfiled counts, in one round trip. */
    fetchLibraryOverview: () =>
      apiRequest<LibraryOverview>("/library/overview", {}, 15000),

    /**
     * Cross-artefact search over the caller's notes (incl. attachment text),
     * decks, flashcards (grouped by deck) and offline bundles. `q` must be at
     * least 2 characters; `courseId` may be the literal "null" for unfiled
     * items; `types` defaults to all; `limit` is capped at 50 server-side.
     */
    searchLibrary: (params: {
      q: string;
      courseId?: string | null;
      /** Topic within `courseId`; the literal "null" means "in the course, under no topic". */
      topicId?: string | null;
      types?: LibrarySearchType[];
      limit?: number;
    }) => {
      const search = new URLSearchParams();
      search.set("q", params.q.trim());
      if (params.courseId) search.set("courseId", params.courseId);
      if (params.topicId) search.set("topicId", params.topicId);
      if (params.types && params.types.length > 0) {
        search.set("types", params.types.join(","));
      }
      if (params.limit) search.set("limit", String(params.limit));
      return apiRequest<LibrarySearchResult[]>(
        `/library/search?${search.toString()}`,
        {},
        10000,
      );
    },

    // ========== JOBS BOARD API (/api/v1/jobs-board) ==========

    fetchJobPostings: (
      filters: {
        page?: number;
        limit?: number;
        search?: string;
        employmentType?: string;
        campusId?: string;
        companyOnly?: boolean;
        sponsoredFirst?: boolean;
      } = {},
    ) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null)
          params.append(key, String(value));
      });
      return apiRequestRaw<{
        success: boolean;
        data: unknown[];
        pagination?: { page: number; limit: number; total: number };
      }>(`/jobs-board/postings?${params.toString()}`);
    },

    fetchJobPosting: (id: string) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/postings/${encodeURIComponent(id)}`,
      ),

    createJobPosting: (body: Record<string, unknown>) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        "/jobs-board/postings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),

    updateJobPosting: (id: string, body: Record<string, unknown>) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/postings/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),

    fetchMyJobPostings: () =>
      apiRequestRaw<{ success: boolean; data: unknown[] }>(
        "/jobs-board/my-postings",
      ),

    fetchJobEmployerAnalytics: () =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        "/jobs-board/analytics/employer",
      ),

    fetchJobPostingAnalytics: (postingId: string) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/postings/${encodeURIComponent(postingId)}/analytics`,
      ),

    applyToJob: (
      id: string,
      body: {
        message?: string;
        answers?: Record<string, string>;
        resumeUrl?: string | null;
      },
    ) =>
      apiRequestRaw<{
        success: boolean;
        data: unknown;
        threadId?: string;
        existing?: boolean;
      }>(`/jobs-board/postings/${encodeURIComponent(id)}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),

    trackJobExternalApply: (id: string) =>
      apiRequestRaw<{ success: boolean; data: { url: string } }>(
        `/jobs-board/postings/${encodeURIComponent(id)}/external-apply`,
        { method: "POST" },
      ),

    fetchMyJobApplications: () =>
      apiRequestRaw<{ success: boolean; data: unknown[] }>(
        "/jobs-board/my-applications",
      ),

    fetchJobApplicants: (postingId: string) =>
      apiRequestRaw<{ success: boolean; data: unknown[] }>(
        `/jobs-board/postings/${encodeURIComponent(postingId)}/applications`,
      ),

    exportJobApplicantsCsv: (postingId: string) =>
      apiRequestRaw<{
        success: boolean;
        data: { csv: string; filename: string; rowCount: number };
      }>(
        `/jobs-board/postings/${encodeURIComponent(postingId)}/applications/export`,
      ),

    bulkUpdateJobApplicationStatus: (
      postingId: string,
      body: { applicationIds: string[]; status: string },
    ) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/postings/${encodeURIComponent(postingId)}/applications/bulk-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),

    updateJobApplicationStatus: (
      applicationId: string,
      body: { status: string; asApplicant?: boolean },
    ) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/applications/${encodeURIComponent(applicationId)}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),

    reportJobPosting: (
      id: string,
      body: { reason: string; details?: string },
    ) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/postings/${encodeURIComponent(id)}/reports`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),

    createJobCompany: (body: Record<string, unknown>) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        "/jobs-board/companies",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),

    fetchMyJobCompanies: () =>
      apiRequestRaw<{ success: boolean; data: unknown[] }>(
        "/jobs-board/companies/mine",
      ),

    fetchJobCompanyProfile: (id: string) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/companies/${encodeURIComponent(id)}/profile`,
      ),

    updateJobCompany: (id: string, body: Record<string, unknown>) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/companies/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),

    uploadJobCompanyLogo: (
      id: string,
      body: { base64Data: string; fileName?: string },
    ) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/companies/${encodeURIComponent(id)}/logo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),

    fetchJobCompanyMembers: (id: string) =>
      apiRequestRaw<{ success: boolean; data: unknown[] }>(
        `/jobs-board/companies/${encodeURIComponent(id)}/members`,
      ),

    inviteJobCompanyMember: (
      id: string,
      body: { username: string; role?: string },
    ) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/companies/${encodeURIComponent(id)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),

    removeJobCompanyMember: (id: string, userId: string) =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        `/jobs-board/companies/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      ),

    fetchJobTemplates: () =>
      apiRequestRaw<{ success: boolean; data: unknown }>(
        "/jobs-board/templates",
      ),
  };
}

export type LanternApiEndpoints = ReturnType<typeof createApiEndpoints>;

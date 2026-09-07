/**
 * Mobile API Service — thin wrapper around @lantern/shared/api
 */
import { createApiClient, createApiEndpoints, type ApiClient } from '@lantern/shared/api';
import { getAuthHeaders, API_BASE_URL, supabase, resetAuthRefreshBackoff } from './supabase';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import {
  classifyRefreshError,
  decideOn401,
  isOfflineAuthError,
  type RefreshOutcome,
} from './authFailure';
import {
  configureSuspensionProbe,
  isForbiddenError,
  probeAccountSuspension,
} from './accountSuspension';

const setAuthOffline = (offline: boolean) => useUIStore.getState().setAuthOffline(offline);

/**
 * One refresh at a time.
 *
 * Coming back to the foreground fans out (RootNavigator's refreshUserData
 * fetches notifications, decks, stats, unread counts … at once). Each 401 used
 * to fire its own refreshSession and its own onUnauthorized, so ONE expired
 * token produced N sign-out calls. Sharing a single in-flight promise means
 * the fan-out asks once and every caller reads the same verdict.
 */
let refreshInFlight: Promise<boolean | 'transient'> | null = null;

/**
 * What the most recent refresh concluded, and when. Read by onUnauthorized as
 * a last check before the one call in the app that can end a session.
 */
let lastRefresh: { outcome: RefreshOutcome; at: number } = { outcome: 'invalid', at: 0 };
/** How recent a transient verdict has to be to still describe THIS 401. */
const REFRESH_VERDICT_TTL_MS = 2_000;

const recordOutcome = <T,>(outcome: RefreshOutcome, value: T): T => {
  lastRefresh = { outcome, at: Date.now() };
  return value;
};

const refreshAuthOnce = (): Promise<boolean | 'transient'> => {
  if (refreshInFlight) return refreshInFlight;

  const attempt = (async (): Promise<boolean | 'transient'> => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session?.access_token) {
        resetAuthRefreshBackoff();
        setAuthOffline(false);
        return recordOutcome('refreshed', true);
      }
      // No session and no error is not proof of anything either — classify it
      // the same way, which defaults to transient.
      const kind = classifyRefreshError(error ?? new Error('refreshSession returned no session'));
      if (kind === 'transient') {
        setAuthOffline(true);
        return recordOutcome('transient', 'transient');
      }
      return recordOutcome('invalid', false);
    } catch (error) {
      if (classifyRefreshError(error) === 'transient') {
        setAuthOffline(true);
        return recordOutcome('transient', 'transient');
      }
      return recordOutcome('invalid', false);
    }
  })();

  refreshInFlight = attempt;
  void attempt.finally(() => {
    refreshInFlight = null;
  });
  return attempt;
};

/**
 * Clear the backoff and try once more, now. Wired to "Retry now" on the
 * offline chip so a student who has just walked back into signal does not wait
 * out the exponential window.
 */
export const retryAuthRefresh = async (): Promise<boolean> => {
  resetAuthRefreshBackoff();
  const outcome = await refreshAuthOnce();
  return outcome === true;
};

const rawClient = createApiClient({
  getBaseUrl: () => API_BASE_URL,
  getAuthHeaders: async () => {
    try {
      return await getAuthHeaders();
    } catch (error) {
      // getAuthHeaders refuses to send a header-less request while the auth
      // server is unreachable; surface that as offline rather than as a 401.
      if (isOfflineAuthError(error)) setAuthOffline(true);
      throw error;
    }
  },
  refreshAuth: refreshAuthOnce,
  onOffline: () => setAuthOffline(true),
  onUnauthorized: () => {
    // The shared client invokes this ONLY for a definitive auth code or a
    // refresh that proved the token is dead — never for a network failure.
    // This is nonetheless the one call in the app that can end a session
    // without the student asking, so it re-applies the rule itself: if the
    // most recent refresh (recent enough to be describing THIS 401) could not
    // reach the auth server, stay offline instead. The verdict expires, so a
    // genuine revoke is never blocked for more than a couple of seconds.
    const unreachable =
      lastRefresh.outcome === 'transient' &&
      Date.now() - lastRefresh.at < REFRESH_VERDICT_TTL_MS;
    if (decideOn401({ refresh: unreachable ? 'transient' : 'invalid' }) === 'stay-offline') {
      setAuthOffline(true);
      return;
    }
    void useAuthStore.getState().signOut({ reason: 'revoked' });
  },
});

configureSuspensionProbe({ getBaseUrl: () => API_BASE_URL, getAuthHeaders });

/**
 * ACCOUNT_SUSPENDED (Phase 1 · E): the shared client reduces the suspension
 * 403 to a bare "Forbidden", so every 403 triggers one throttled probe of
 * GET /users/me/moderation that reads the code + date into moderationStore
 * (see services/accountSuspension.ts). The original error still propagates —
 * callers keep their own handling; the blocking banner is rendered by
 * RootNavigator from the store. No sign-out: the account returns by itself.
 */
const rethrowAfterSuspensionCheck = (error: unknown): never => {
  if (isForbiddenError(error)) void probeAccountSuspension();
  throw error;
};

/**
 * Any completed round-trip is proof the API is reachable and this session is
 * accepted, so it retires the offline banner — the flag is never left stuck on
 * after connectivity comes back.
 */
const noteRequestSucceeded = <T,>(value: T): T => {
  if (useUIStore.getState().authOffline) setAuthOffline(false);
  return value;
};

const client: ApiClient = {
  ...rawClient,
  request: <T,>(endpoint: string, options?: RequestInit, timeoutMs?: number) =>
    rawClient
      .request<T>(endpoint, options, timeoutMs)
      .then(noteRequestSucceeded, rethrowAfterSuspensionCheck),
  requestRaw: <T,>(endpoint: string, options?: RequestInit, timeoutMs?: number) =>
    rawClient
      .requestRaw<T>(endpoint, options, timeoutMs)
      .then(noteRequestSucceeded, rethrowAfterSuspensionCheck),
};

/**
 * The configured transport, for the few mobile-only endpoints that are not in
 * the shared endpoint set. Going through this — rather than a bare `fetch` —
 * keeps the 401 refresh, the sign-out on a dead session and the
 * ACCOUNT_SUSPENDED probe above, all of which a hand-rolled call would lose.
 */
export const apiClient: ApiClient = client;

// ─────────────────────────────────────────────────────────────
// Whole-artefact writes (generated material)
//
// A generation is one thing the student asked for, so it is saved in one
// request. The old path created a deck and then added cards one at a time:
// every step was a chance to half-succeed, and on a phone that lost signal
// mid-run it reliably did — an empty "From: <note>" deck in the library and
// the cards nowhere. These endpoints take the whole artefact and either
// commit all of it or none of it, which is the only shape a save that can be
// interrupted may have.
//
// `clientKey` is the job id: sending the same generation twice (a retry, a
// resumed run) returns the artefact the first call created instead of a
// second copy of it.
// ─────────────────────────────────────────────────────────────

/**
 * Read a response that may or may not be wrapped in the API's `{ data }`
 * envelope, so the client is not brittle about which of the two the endpoint
 * settles on.
 */
const unwrapEnvelope = <T,>(payload: unknown): T => {
  const body = payload as { data?: T } | T;
  return (body && typeof body === 'object' && 'data' in (body as object)
    ? ((body as { data?: T }).data ?? (body as unknown as T))
    : (body as T));
};

export interface DeckWithCardsRequest {
  /** The job that generated these cards. The server's idempotency key. */
  clientKey: string;
  /** Save into a deck the student already has, instead of making one. */
  deckId?: string;
  name: string;
  description?: string;
  /**
   * The route normalises every field below
   * (apps/api-server/src/services/deckWithCards.ts `validateDeckCards`), so a
   * cloze card imported from Anki keeps its type and its `{{c1::…}}` text
   * instead of arriving as a BASIC card with the syntax showing on its face.
   * This used to read `{ front: string; back: string }`, which is narrower
   * than the endpoint and silently dropped the rest.
   */
  cards: Array<{
    type?: 'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION';
    front?: string;
    back?: string;
    clozeText?: string;
    imageUrl?: string;
    tags?: string[];
  }>;
}

export interface DeckWithCardsResponse {
  deck: { id: string; name: string; description?: string } & Record<string, unknown>;
  /** The saved card rows, as the route names them. */
  flashcards?: Array<Record<string, unknown>>;
  /** Accepted as an alias of `flashcards`. */
  cards?: Array<Record<string, unknown>>;
  cardCount?: number;
  /** False when the server used the compensating (non-RPC) path. */
  atomic?: boolean;
}

/** `POST /decks/with-cards` — a deck and its cards, committed together. */
export const createDeckWithCards = async (
  body: DeckWithCardsRequest
): Promise<DeckWithCardsResponse> => {
  const payload = await client.requestRaw<unknown>('/decks/with-cards', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return unwrapEnvelope<DeckWithCardsResponse>(payload);
};

export interface PersonalTestRequest {
  /** The job that generated these questions. The server's idempotency key. */
  clientKey?: string;
  title: string;
  /** The note this was generated from. */
  sourceNoteId?: string;
  /** The deck this was generated from, when the source was a deck. */
  sourceDeckId?: string;
  /**
   * The SERVER job that generated these questions. The route stamps the saved
   * test onto that job record (`attachJobResultRef`), which is what turns the
   * completion push's `lanternstudy://jobs/<id>` into `lanternstudy://test/<id>`
   * and lets a resumed app settle the job from the record alone.
   */
  sourceJobId?: string;
  /**
   * Config the route folds into the session. `sourceNoteTitle` is the
   * server's documented FALLBACK for the note's title (its own read of the
   * note row always wins) — sent so a freshly saved note test names its note
   * even when that read comes back empty.
   */
  config?: { sourceNoteTitle?: string };
  questions: unknown[];
}

/**
 * The route answers with the mapped session itself (`{ id, title, questions,
 * status, … }`). `test` is accepted as an alias so a later envelope change
 * cannot make a saved test read as unsaved.
 */
export type PersonalTestResponse = ({ id?: string; title?: string; questions?: unknown[] } & Record<
  string,
  unknown
>) & { test?: { id: string } & Record<string, unknown> };

/** `POST /tests/personal` — a test of one's own, from a note. */
export const createPersonalTest = async (
  body: PersonalTestRequest
): Promise<PersonalTestResponse> => {
  const payload = await client.requestRaw<unknown>('/tests/personal', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return unwrapEnvelope<PersonalTestResponse>(payload);
};

const lanternApi = createApiEndpoints(client);

/** Shared API instance for stores using `import * as api` */
export const api = lanternApi;

// Re-export all endpoint methods as named exports (backward compatible)
export const {
  fetchDecks,
  createDeck,
  updateDeck,
  deleteDeck,
  resetDeckStatistics,
  exportDeck,
  importDeck,
  exportDeckCsv,
  importDeckCsv,
  importDeckApkg,
  fetchDeckCollaborators,
  addDeckCollaborator,
  removeDeckCollaborator,
  fetchFlashcards,
  createFlashcard,
  updateFlashcard,
  reviewFlashcard,
  deleteFlashcard,
  fetchFlashcardComments,
  addFlashcardComment,
  resolveFlashcardComment,
  uploadFlashcardImage,
  uploadFlashcardImageBase64,
  fetchUserProfile,
  createUserProfile,
  updateUserProfile,
  uploadProfileAvatar,
  deleteUserAccount,
  exportUserData,
  fetchUserSettings,
  updateUserSettings,
  searchUsers,
  checkUsername,
  updateUsername,
  fetchGroups,
  fetchGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  fetchGroupMembers,
  addGroupMember,
  addGroupMembersBatch,
  fetchPendingGroupInvites,
  acceptGroupInvite,
  declineGroupInvite,
  uploadGroupAvatar,
  removeGroupMember,
  joinGroupByInvite,
  leaveGroup,
  promoteGroupAdmin,
  demoteGroupAdmin,
  fetchGroupUnreadCounts,
  markGroupAsRead,
  fetchMessages,
  fetchGroupThread,
  // Community boards (Phase 1): roots-only paging, the one server pin.
  fetchBoardPosts,
  fetchPinnedMessage,
  setMessagePin,
  fetchDmThread,
  sendMessage,
  updateMessage,
  editGroupMessage,
  removeGroupMessage,
  updateQuestionStatus,
  voteOnMessage,
  addMessageReaction,
  removeMessageReaction,
  fetchUserReactionsForGroup,
  fetchUserReactionsForThread,
  removeVote,
  fetchUserVotesForGroup,
  fetchDMThreads,
  fetchDirectMessages,
  sendDirectMessage,
  editDirectMessage,
  removeDirectMessage,
  markDMAsRead,
  fetchDMUnreadCounts,
  archiveDmThread,
  unarchiveDmThread,
  getDmMuteStatus,
  searchMessages,
  muteDmThread,
  unmuteDmThread,
  getGroupMuteStatus,
  muteGroupChat,
  unmuteGroupChat,
  acceptDmMessageRequest,
  declineDmMessageRequest,
  listBlockedUsers,
  getDmBlockStatus,
  blockUser,
  unblockUser,
  deleteDmThread,
  fetchTests,
  createTestSession,
  updateTestSession,
  submitTestResult,
  fetchTestResults,
  fetchTestResultsPage,
  saveTestResult,
  deleteTestSession,
  fetchTestSessionDetail,
  fetchTestById,
  clearTestHistory,
  fetchUserQuestionStats,
  upsertUserQuestionStat,
  fetchDashboardSummary,
  fetchNotifications,
  createNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  deleteAllNotifications,
  fetchGamificationStats,
  awardPoints,
  checkBadges,
  syncGamificationProgress,
  fetchMarketplaceListings,
  // "Browse by course" (Gap 3): the course index and one course's listings.
  fetchMarketplaceCourses,
  fetchMarketplaceCourseListings,
  fetchMarketplaceListing,
  fetchMarketplaceListingReviewEligibility,
  createMarketplaceListing,
  updateMarketplaceListing,
  deleteMarketplaceListing,
  updateListingStatus,
  fetchMyListings,
  fetchSellerStats,
  fetchMyFavorites,
  addToFavorites,
  removeFromFavorites,
  checkIfFavorited,
  fetchMyInquiries,
  fetchInquiryByThread,
  createInquiry,
  updateInquiryStatus,
  addMarketplaceReview,
  fetchListingReviews,
  setMarketplaceReviewHelpful,
  fetchMarketplaceAccess,
  fetchShopSummary,
  fetchSimilarListings,
  reportMarketplaceListing,
  createMarketplaceOffer,
  respondToOffer,
  fetchListingOffers,
  fetchMarketplaceOffers,
  buyNowListing,
  downloadQuestionBank,
  fetchQuestionBankPreview,
  restoreQuestionBanks,
  fetchQuestionBankUpdates,
  publishQuestionBank,
  updateQuestionBankContent,
  fetchMyQuestionBanks,
  recordQuestionBankScore,
  fetchQuestionBankLeaderboard,
  downloadStudyPack,
  fetchStudyPackPreview,
  publishStudyPack,
  updateStudyPackContent,
  fetchMyStudyPacks,
  restoreStudyPacks,
  fetchStudyPackUpdates,
  fetchMarketplacePurchases,
  createStudyPackDraft,
  fetchStudyPackDrafts,
  fetchStudyPackDraft,
  deleteStudyPackDraft,
  fetchSemesterPackProposals,
  fetchAiHealth,
  fetchCreatorProfile,
  fetchCreatorDiscovery,
  followCreator,
  unfollowCreator,
  fetchSellerPayments,
  // Phase 3 — Network (communities, discovery, feed, presence, mastery)
  fetchMyCommunities,
  fetchCommunity,
  fetchCommunityChannels,
  fetchCommunityMembers,
  joinCommunity,
  leaveCommunity,
  createCommunity,
  joinDiscoverableGroup,
  discoverCommunities,
  discoverGroups,
  discoverPeople,
  fetchStudyPresence,
  sendStudyHeartbeat,
  clearStudyPresence,
  fetchFeed,
  fetchLearningConnections,
  fetchMasteryGraph,
  refreshMasteryGraph,
  fetchExamReadiness,
  fetchCourseReadiness,
  fetchUnmatchedTags,
  openCommunityLounge,
  fetchReferralSummary,
  fetchAmbassadors,
  fetchGamificationLeaderboard,
  joinOrCreateStudyRoom,
  listStudyRooms,
  fetchStudyRoom,
  joinStudyRoom,
  leaveStudyRoom,
  verifyMarketplacePayment,
  resumeMarketplaceOrderCheckout,
  fetchSellerPayoutProfile,
  upsertSellerPayoutProfile,
  fetchPaystackBanks,
  fetchMarketplaceCart,
  addToMarketplaceCart,
  updateMarketplaceCartItem,
  removeMarketplaceCartItem,
  clearMarketplaceCart,
  checkoutMarketplaceCart,
  boostListing,
  uploadMarketplaceImage,
  uploadChatImage,
  uploadChatAudio,
  uploadQuestionImage,
  fetchMarketplaceOrders,
  fetchMarketplaceOrder,
  fetchOrderForInquiry,
  updateMarketplaceOrder,
  requestOrderPayment,
  fetchSellerAnalytics,
  fetchSellerBuyers,
  checkSavedSearchMatches,
  fetchSellerOnboarding,
  completeSellerOnboarding,
  submitOrderPaymentProof,
  validateMarketplaceCoupon,
  fetchPickupNudge,
  fetchSellerPreferences,
  updateSellerPreferences,
  fetchSellerCoupons,
  createSellerCoupon,
  createMarketplaceBundle,
  sendSellerCampaign,
  fetchListingOffersHistory,
  updateSavedSearch,
  fetchSavedSearches,
  createSavedSearch,
  deleteSavedSearch,
  fetchSellerProfile,
  updateMyShop,
  fetchMarketplaceShops,
  fetchUserBudget,
  saveUserBudget,
  fetchBudgetTransactions,
  saveBudgetTransaction,
  deleteBudgetTransaction,
  fetchBudgetWallet,
  createSavingsGoal,
  deleteSavingsGoal,
  contributeToSavingsGoal,
  listRecurring,
  createRecurring,
  deleteRecurring,
  runRecurring,
  claimUnderBudgetAward,
  fetchOfflineBundles,
  saveOfflineBundle,
  deleteOfflineBundle,
  fetchUserPreferences,
  saveUserPreferences,
  fetchMarketplaceCampuses,
  createChallenge,
  fetchChallenges,
  fetchChallenge,
  acceptChallenge,
  declineChallenge,
  submitChallenge,
  // Academic identity: course catalogue + my enrolments (contract §3)
  fetchCourses,
  createCourse,
  fetchMyCourses,
  setMyCourses,
  updateMyCourse,
  removeMyCourse,
  archiveSemester,
  // Classes: join-by-code, assigned work, official lecturer materials
  joinClassByCode,
  previewClassByCode,
  fetchMyClassWork,
  completeClassAssignment,
  fetchOfficialClassMaterials,
  // Library archive: course tree + cross-artefact search (contract §1 / §3)
  fetchLibraryOverview,
  searchLibrary,
  // Moderation (Phase 1 · E): reports, takedown appeals, own strike state
  reportContent,
  appealListingTakedown,
  fetchMyModerationState,
} = lanternApi;

// Legacy type exports used by stores
type ArrayElement<T> =
  T extends readonly (infer U)[]
    ? U
    : T extends { data: readonly (infer U)[] }
      ? U
      : never;

export type Deck = ArrayElement<Awaited<ReturnType<typeof fetchDecks>>>;
export type Flashcard = ArrayElement<Awaited<ReturnType<typeof fetchFlashcards>>>;
export type UserProfile = Awaited<ReturnType<typeof fetchUserProfile>>;
export type Group = ArrayElement<Awaited<ReturnType<typeof fetchGroups>>>;
export type Message = ArrayElement<Awaited<ReturnType<typeof fetchMessages>>>;
export type DirectMessage = ArrayElement<Awaited<ReturnType<typeof fetchDirectMessages>>>;
export type DMThread = ArrayElement<Awaited<ReturnType<typeof fetchDMThreads>>>;
export type TestSession = Awaited<ReturnType<typeof createTestSession>>;
export type TestResult = Awaited<ReturnType<typeof submitTestResult>>;
export type UserQuestionStat = Awaited<ReturnType<typeof fetchUserQuestionStats>>[number];
export type Notification = Awaited<ReturnType<typeof fetchNotifications>>[number];
export type GamificationStats = Awaited<ReturnType<typeof fetchGamificationStats>>;
export type MarketplaceListing = Awaited<ReturnType<typeof fetchMarketplaceListing>>;
export type MarketplaceFilters = Parameters<typeof fetchMarketplaceListings>[0];
export type SellerStats = NonNullable<Awaited<ReturnType<typeof fetchSellerStats>>>;
export type MarketplaceFavorite = Awaited<ReturnType<typeof fetchMyFavorites>>[number];
export type MarketplaceInquiry = Awaited<ReturnType<typeof fetchMyInquiries>>[number];
export type MarketplaceReview = Awaited<ReturnType<typeof addMarketplaceReview>>;
export type BudgetData = NonNullable<Awaited<ReturnType<typeof fetchUserBudget>>>;
export type BudgetTransaction = Awaited<ReturnType<typeof fetchBudgetTransactions>>[number];

export default lanternApi;

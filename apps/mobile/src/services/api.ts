/**
 * Mobile API Service — thin wrapper around @lantern/shared/api
 */
import { createApiClient, createApiEndpoints, type ApiClient } from '@lantern/shared/api';
import { getAuthHeaders, API_BASE_URL, supabase } from './supabase';
import { useAuthStore } from '../stores/authStore';
import {
  configureSuspensionProbe,
  isForbiddenError,
  probeAccountSuspension,
} from './accountSuspension';

const rawClient = createApiClient({
  getBaseUrl: () => API_BASE_URL,
  getAuthHeaders,
  refreshAuth: async () => {
    const { data, error } = await supabase.auth.refreshSession();
    return !error && !!data.session?.access_token;
  },
  onUnauthorized: () => {
    // Shared client only invokes this for definitive auth codes or failed refresh.
    void useAuthStore.getState().signOut();
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

const client: ApiClient = {
  ...rawClient,
  request: <T,>(endpoint: string, options?: RequestInit, timeoutMs?: number) =>
    rawClient.request<T>(endpoint, options, timeoutMs).catch(rethrowAfterSuspensionCheck),
  requestRaw: <T,>(endpoint: string, options?: RequestInit, timeoutMs?: number) =>
    rawClient.requestRaw<T>(endpoint, options, timeoutMs).catch(rethrowAfterSuspensionCheck),
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
  fetchDmThread,
  sendMessage,
  updateMessage,
  editGroupMessage,
  removeGroupMessage,
  updateQuestionStatus,
  voteOnMessage,
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
  fetchCreatorProfile,
  fetchCreatorDiscovery,
  followCreator,
  unfollowCreator,
  fetchSellerPayments,
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

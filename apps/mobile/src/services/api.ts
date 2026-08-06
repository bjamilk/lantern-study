/**
 * Mobile API Service — thin wrapper around @lantern/shared/api
 */
import { createLanternApi } from '@lantern/shared/api';
import { getAuthHeaders, API_BASE_URL, supabase } from './supabase';
import { useAuthStore } from '../stores/authStore';

const { api: lanternApi } = createLanternApi({
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

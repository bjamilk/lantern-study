/**
 * The safety net for splitting `services/supabase.ts` (8,019 lines, 639
 * importers) into per-domain modules behind a barrel.
 *
 * It freezes two things about the module, and NOTHING about how it is spelled:
 *
 *  1. EXPORTS — every name the module publishes. 639 files import from here;
 *     a name that disappears or is renamed during a split is a build break in
 *     a file nobody touched, and TypeScript only catches it if that importer
 *     is still compiled by the same run.
 *  2. REQUEST PATHS — every `/api/v1/...` path literal the module calls on the
 *     Express BFF. The exports can survive a split intact while a path is
 *     mistyped in the move, and that failure is invisible until a student hits
 *     the screen: the wrong path 404s, and most callers report a 404 as an
 *     empty list rather than an error.
 *
 * How it reads the module matters for the split that comes next: the scan
 * FOLLOWS `export * from './x'` and `export { … } from './x'` into sibling
 * files. Today supabase.ts is one flat file and the scan reads one file; after
 * the split it becomes a barrel and the scan reads the whole tree behind it,
 * so BOTH lists must come out identical. A snapshot that only read
 * supabase.ts would go green on a barrel that re-exported nothing.
 *
 * It is a source scan, not an import: importing this module constructs the
 * supabase client, installs the cookie-mode fetch interceptor and reaches for
 * localStorage. A snapshot of a data layer must not be able to make a request.
 *
 * When a split lands, neither list should change. When a NEW endpoint or export
 * is added on purpose, add its line here in the same commit — that edit is the
 * review signal, which is why these are plain arrays and not `toMatchSnapshot`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'supabase.ts');

/**
 * `/api/v1/decks/${id}/cards` and `/api/v1/decks/:p/cards` are the same route:
 * every `${…}` span collapses to `:p` so the frozen list compares shapes, not
 * the identifier a variable happened to have. Query strings are excluded — a
 * `?` ends a path — because they are built conditionally all over the file.
 */
const API_PATH = /\/api\/v1(?::p|(?:\/(?::p|[A-Za-z0-9_.-]+))*)*/g;

interface Surface {
  exports: string[];
  apiPaths: string[];
}

function readSurface(entry: string): Surface {
  const seen = new Set<string>();
  const exports = new Set<string>();
  const apiPaths = new Set<string>();

  const resolveLocal = (from: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null;
    const base = path.resolve(path.dirname(from), spec);
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (fs.existsSync(base + ext)) return base + ext;
    }
    return null;
  };

  const harvest = (text: string): void => {
    API_PATH.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = API_PATH.exec(text)) !== null) apiPaths.add(match[0]);
  };

  const walk = (file: string, collectExports: boolean): void => {
    const abs = path.resolve(file);
    if (seen.has(abs)) return;
    seen.add(abs);
    const source = ts.createSourceFile(
      abs,
      fs.readFileSync(abs, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );

    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement)) {
        const from = statement.moduleSpecifier as ts.StringLiteral | undefined;
        const target = from ? resolveLocal(abs, from.text) : null;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          // `export { a, b } from './x'` publishes exactly a and b; the file
          // behind it is still walked, for its request paths.
          if (collectExports) {
            for (const element of statement.exportClause.elements) {
              exports.add(element.name.text);
            }
          }
          if (target) walk(target, false);
        } else if (from) {
          // `export * from './x'` publishes whatever x publishes.
          if (target) walk(target, collectExports);
          else if (collectExports) exports.add(`* from ${from.text}`);
        }
        continue;
      }

      if (!collectExports) continue;
      const modifiers = ts.getModifiers(statement as ts.HasModifiers) ?? [];
      if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) exports.add(decl.name.text);
        }
      } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name as ts.Node)) {
        exports.add((statement.name as ts.Identifier).text);
      }
    }

    // Strings and templates only, so a path written in a comment is not
    // mistaken for a call.
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        harvest(node.text);
      } else if (ts.isTemplateExpression(node)) {
        let rebuilt = node.head.text;
        for (const span of node.templateSpans) rebuilt += `:p${span.literal.text}`;
        harvest(rebuilt);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  };

  walk(entry, true);
  return { exports: [...exports].sort(), apiPaths: [...apiPaths].sort() };
}

/** Frozen 2026-09-15 against the untouched 8,019-line services/supabase.ts. */
const EXPORTS: readonly string[] = [
  'BoardBookmarkWriteResult',
  'BudgetData',
  'CampusSummary',
  'ChatMessageMutationPayload',
  'ChatMuteStatus',
  'CreatorProfile',
  'DECK_API_PAGE_SIZE',
  'FLASHCARD_API_PAGE_SIZE',
  'FetchTestResultsOptions',
  'MarketplacePurchase',
  'MarketplaceQuestionBankMeta',
  'MarketplaceStudyPackMeta',
  'MyQuestionBank',
  'MyStudyPack',
  'OfflineBundleData',
  'PendingSyncResult',
  'QuestionBankLeaderboardEntry',
  'QuestionBankPreview',
  'QuestionBankUpdate',
  'SaveUserSettingsResult',
  'SellerPaymentRow',
  'SessionResolveFailure',
  'SessionResolveResult',
  'StudyPackDraft',
  'StudyPackDraftSummary',
  'StudyPackPreview',
  'TestResultsSort',
  'TransactionData',
  'UserPreferences',
  'acceptDmMessageRequest',
  'acceptGroupInvite',
  'addDeckCollaborator',
  'addFlashcardComment',
  'addGroupMember',
  'addGroupMembersBatch',
  'addMarketplaceReview',
  'addMessageReaction',
  'addRecentlyViewed',
  'addToFavorites',
  'addToMarketplaceCart',
  'apiLogoutSession',
  'archiveDmThread',
  'blockUser',
  'boostMarketplaceListing',
  'bootstrapAuthFromStorage',
  'buyMarketplaceListingNow',
  'checkIfFavorited',
  'checkSavedSearchMatches',
  'checkUsernameAvailability',
  'checkoutMarketplaceCart',
  'classifyMarketplaceListing',
  'clearAllClientAuthStorage',
  'clearClientAuthSession',
  'clearLastKnownSettingsVersion',
  'clearMarketplaceCart',
  'clearRecentlyViewed',
  'clearStudyPresence',
  'completeSellerOnboarding',
  'createBoardRepost',
  'createCommunity',
  'createCustomCategory',
  'createDeck',
  'createFlashcard',
  'createGroup',
  'createInquiry',
  'createMarketplaceAddress',
  'createMarketplaceBundle',
  'createMarketplaceListing',
  'createNotification',
  'createOffer',
  'createSellerCoupon',
  'createStudyPackDraft',
  'createTestResult',
  'createTestSession',
  'createUserProfile',
  'deactivateUserAccount',
  'declineDmMessageRequest',
  'declineGroupInvite',
  'deleteAllNotifications',
  'deleteBudgetTransaction',
  'deleteDeck',
  'deleteDmThread',
  'deleteFlashcard',
  'deleteGroup',
  'deleteMarketplaceAddress',
  'deleteMarketplaceImage',
  'deleteMarketplaceListing',
  'deleteNotification',
  'deleteOfflineBundle',
  'deletePendingSyncResult',
  'deleteSavedSearch',
  'deleteStudyPackDraft',
  'deleteUserAccount',
  'deleteUserAccountImmediate',
  'demoteGroupAdmin',
  'discoverCommunities',
  'discoverGroups',
  'discoverPeople',
  'downloadQuestionBank',
  'downloadStudyPack',
  'editDirectMessage',
  'editGroupMessage',
  'ensureAuthTokenReady',
  'ensureNotesUploadSession',
  'exportDeck',
  'exportDeckCsv',
  'exportUserAccountData',
  'fetchAccountLifecycle',
  'fetchAiHealth',
  'fetchAllFlashcards',
  'fetchAmbassadors',
  'fetchBoardPosts',
  'fetchBookmarkedPosts',
  'fetchBudgetTransactions',
  'fetchCampusSummary',
  'fetchCommunity',
  'fetchCommunityChannels',
  'fetchCommunityMembers',
  'fetchCourseReadiness',
  'fetchCreatorProfile',
  'fetchCustomCategories',
  'fetchDMUnreadCounts',
  'fetchDashboardSummary',
  'fetchDeckCollaborators',
  'fetchDecks',
  'fetchDirectMessages',
  'fetchDmThread',
  'fetchDmThreads',
  'fetchExamReadiness',
  'fetchFeed',
  'fetchFlashcardComments',
  'fetchFlashcards',
  'fetchGamificationLeaderboard',
  'fetchGroupBookmarks',
  'fetchGroupInvitePreview',
  'fetchGroupMembers',
  'fetchGroupThread',
  'fetchGroupUnreadCounts',
  'fetchGroups',
  'fetchLearningConnections',
  'fetchMarketplaceAddresses',
  'fetchMarketplaceCampuses',
  'fetchMarketplaceCart',
  'fetchMarketplaceCategoryAnalytics',
  'fetchMarketplaceListing',
  'fetchMarketplaceListingFull',
  'fetchMarketplaceListings',
  'fetchMarketplaceListingsByIds',
  'fetchMarketplaceListingsPage',
  'fetchMarketplaceOrder',
  'fetchMarketplaceOrders',
  'fetchMarketplacePaymentsConfig',
  'fetchMarketplacePurchases',
  'fetchMarketplaceShops',
  'fetchMasteryGraph',
  'fetchMessages',
  'fetchMyCommunities',
  'fetchMyFavorites',
  'fetchMyInquiries',
  'fetchMyListings',
  'fetchMyQuestionBanks',
  'fetchMyStudyPacks',
  'fetchNegotiationHistory',
  'fetchNotifications',
  'fetchOffers',
  'fetchOffersForListing',
  'fetchOfflineBundles',
  'fetchOrderForInquiry',
  'fetchPaystackBanks',
  'fetchPendingGroupInvites',
  'fetchPendingSyncResults',
  'fetchPickupNudge',
  'fetchPinnedMessage',
  'fetchQuestionBankLeaderboard',
  'fetchQuestionBankPreview',
  'fetchQuestionBankUpdates',
  'fetchReferralSummary',
  'fetchSavedSearches',
  'fetchSellerAnalytics',
  'fetchSellerBuyers',
  'fetchSellerCoupons',
  'fetchSellerFulfillment',
  'fetchSellerOnboarding',
  'fetchSellerPayments',
  'fetchSellerPayoutProfile',
  'fetchSellerPreferences',
  'fetchSellerProfile',
  'fetchSellerStats',
  'fetchSemesterPackProposals',
  'fetchSignedStorageUrl',
  'fetchSimilarListings',
  'fetchStudyPackDraft',
  'fetchStudyPackDrafts',
  'fetchStudyPackPreview',
  'fetchStudyPresence',
  'fetchStudyRoom',
  'fetchTestResults',
  'fetchTestResultsPage',
  'fetchTestSessionById',
  'fetchUnmatchedTags',
  'fetchUserBudget',
  'fetchUserPreferences',
  'fetchUserProfile',
  'fetchUserQuestionStats',
  'fetchUserReactionsForGroup',
  'fetchUserReactionsForThread',
  'fetchUserSettings',
  'fetchUserVotesForGroup',
  'fetchUsers',
  'followCreator',
  'getApiRoot',
  'getAuthHeaders',
  'getAuthenticatedUserId',
  'getDmBlockStatus',
  'getDmMuteStatus',
  'getGroupMuteStatus',
  'getInquiryByThread',
  'getRecentlyViewed',
  'getStoredSessionExpiresAt',
  'getTokenFromLocalStorage',
  'getUserIdFromLocalStorage',
  'getWebAuthRedirectOrigin',
  'hasCachedAccessToken',
  'hasValidSession',
  'importDeck',
  'importDeckApkg',
  'importDeckCsv',
  'importMessageBookmarks',
  'importUserAccountBackup',
  'initiateMarketplaceTransaction',
  'joinCommunity',
  'joinDiscoverableGroup',
  'joinGroupByInvite',
  'joinOrCreateStudyRoom',
  'joinStudyRoom',
  'leaveCommunity',
  'leaveGroup',
  'leaveStudyRoom',
  'listBlockedUsers',
  'listStudyRooms',
  'mapDeckFromApi',
  'mapDecksFromApi',
  'mapGroupListFromApi',
  'markAllNotificationsAsRead',
  'markDMAsRead',
  'markGroupAsRead',
  'markNotificationAsRead',
  'markPendingSyncResultAsSynced',
  'muteDmThread',
  'muteGroupChat',
  'openCommunityLounge',
  'promoteGroupAdmin',
  'publishQuestionBank',
  'publishStudyPack',
  'reactivateUserAccount',
  'readPersistedAuthUser',
  'recordQuestionBankScore',
  'refreshMasteryGraph',
  'removeDeckCollaborator',
  'removeDirectMessage',
  'removeFromFavorites',
  'removeGroupMember',
  'removeGroupMessage',
  'removeMarketplaceCartItem',
  'removeMessageReaction',
  'removeRecentlyViewed',
  'removeVote',
  'reportMarketplaceListing',
  'requestOrderPayment',
  'resendSignupConfirmation',
  'resetCookieRestoreState',
  'resetDeckStatistics',
  'resolveClientSession',
  'respondToOffer',
  'restoreQuestionBanks',
  'restoreStudyPacks',
  'resumeMarketplaceOrderCheckout',
  'reviewFlashcard',
  'revokeOtherSessions',
  'saveBudgetTransaction',
  'saveOfflineBundle',
  'savePendingSyncResult',
  'saveSearch',
  'saveUserBudget',
  'saveUserPreferences',
  'saveUserSettings',
  'saveUserSettingsDetailed',
  'searchUsers',
  'sendDirectMessage',
  'sendMessage',
  'sendPasswordResetEmail',
  'sendSellerCampaign',
  'sendStudyHeartbeat',
  'setCachedAuthToken',
  'setMarketplaceReviewHelpful',
  'setMessageBookmark',
  'setMessagePin',
  'shouldRefreshStoredSession',
  'submitOrderPaymentProof',
  'supabase',
  'syncBudgetTransactionsToCloud',
  'syncOfflineBundles',
  'syncPendingResultsToCloud',
  'threadMayHaveMarketplaceInquiry',
  'unarchiveDmThread',
  'unblockUser',
  'undoBoardRepost',
  'unfollowCreator',
  'unmuteDmThread',
  'unmuteGroupChat',
  'updateAuthPassword',
  'updateDeck',
  'updateFlashcard',
  'updateGroup',
  'updateInquiryStatus',
  'updateListingStatus',
  'updateMarketplaceAddress',
  'updateMarketplaceCartItem',
  'updateMarketplaceListing',
  'updateMarketplaceOrder',
  'updateMessage',
  'updateMyShop',
  'updateQuestionBankContent',
  'updateQuestionStatus',
  'updateSellerPreferences',
  'updateStudyPackContent',
  'updateTestSession',
  'updateUserProfile',
  'updateUsername',
  'uploadChatAudio',
  'uploadChatImage',
  'uploadFlashcardImage',
  'uploadGroupAvatar',
  'uploadMarketplaceImage',
  'uploadProfileAvatar',
  'uploadQuestionImage',
  'upsertSellerPayoutProfile',
  'upsertUserQuestionStat',
  'validateMarketplaceCoupon',
  'verifyMarketplacePayment',
  'verifySignupOtp',
  'voteQuestion',
  'withApiCredentials',
];

/**
 * Frozen 2026-09-15. `/api/v1:p` is the generic `apiGet`/`apiSend` helper pair
 * near the bottom of the file, which takes the rest of the path as an argument
 * — it is a real call shape, not a parse artefact.
 */
const API_PATHS: readonly string[] = [
  '/api/v1/ai/health',
  '/api/v1/ai/study-pack/draft',
  '/api/v1/ai/study-pack/drafts',
  '/api/v1/ai/study-pack/drafts/:p',
  '/api/v1/ai/study-pack/semester-proposals:p',
  '/api/v1/auth/logout',
  '/api/v1/auth/revoke-other-sessions',
  '/api/v1/budget/transactions',
  '/api/v1/campuses/:p/summary:p',
  '/api/v1/creators/:p',
  '/api/v1/dashboard/summary',
  '/api/v1/decks',
  '/api/v1/decks/:p',
  '/api/v1/decks/:p/collaborators',
  '/api/v1/decks/:p/collaborators/:p',
  '/api/v1/decks/:p/export',
  '/api/v1/decks/:p/export/csv',
  '/api/v1/decks/:p/reset',
  '/api/v1/decks/import',
  '/api/v1/decks/import/apkg',
  '/api/v1/decks/import/csv',
  '/api/v1/flashcards',
  '/api/v1/flashcards/:p',
  '/api/v1/flashcards/:p/comments',
  '/api/v1/flashcards/:p/review',
  '/api/v1/flashcards/upload-image',
  '/api/v1/groups',
  '/api/v1/groups/:p',
  '/api/v1/groups/:p/admins/:p',
  '/api/v1/groups/:p/avatar',
  '/api/v1/groups/:p/invites/accept',
  '/api/v1/groups/:p/invites/decline',
  '/api/v1/groups/:p/leave',
  '/api/v1/groups/:p/members',
  '/api/v1/groups/:p/members/:p',
  '/api/v1/groups/:p/members/batch',
  '/api/v1/groups/:p/members:p',
  '/api/v1/groups/:p/mute',
  '/api/v1/groups/:p/read',
  '/api/v1/groups/invite/:p',
  '/api/v1/groups/invites/pending',
  '/api/v1/groups/join',
  '/api/v1/groups/unread/all',
  '/api/v1/marketplace/addresses',
  '/api/v1/marketplace/addresses/:p',
  '/api/v1/marketplace/analytics/categories',
  '/api/v1/marketplace/analytics/seller',
  '/api/v1/marketplace/bundles',
  '/api/v1/marketplace/campuses',
  '/api/v1/marketplace/cart',
  '/api/v1/marketplace/cart/:p',
  '/api/v1/marketplace/cart/checkout',
  '/api/v1/marketplace/categories/custom',
  '/api/v1/marketplace/classify',
  '/api/v1/marketplace/coupons',
  '/api/v1/marketplace/coupons/validate',
  '/api/v1/marketplace/favorites',
  '/api/v1/marketplace/favorites/:p',
  '/api/v1/marketplace/favorites/:p/check',
  '/api/v1/marketplace/inquiries',
  '/api/v1/marketplace/inquiries/:p/status',
  '/api/v1/marketplace/inquiries/thread/:p',
  '/api/v1/marketplace/listings',
  '/api/v1/marketplace/listings/:p',
  '/api/v1/marketplace/listings/:p/boost',
  '/api/v1/marketplace/listings/:p/buy-now',
  '/api/v1/marketplace/listings/:p/full',
  '/api/v1/marketplace/listings/:p/offers',
  '/api/v1/marketplace/listings/:p/offers-history',
  '/api/v1/marketplace/listings/:p/question-bank/download',
  '/api/v1/marketplace/listings/:p/question-bank/leaderboard:p',
  '/api/v1/marketplace/listings/:p/question-bank/preview',
  '/api/v1/marketplace/listings/:p/question-bank/scores',
  '/api/v1/marketplace/listings/:p/reports',
  '/api/v1/marketplace/listings/:p/reviews',
  '/api/v1/marketplace/listings/:p/reviews/:p/helpful',
  '/api/v1/marketplace/listings/:p/similar',
  '/api/v1/marketplace/listings/:p/status',
  '/api/v1/marketplace/listings/:p/study-pack/download',
  '/api/v1/marketplace/listings/:p/study-pack/preview',
  '/api/v1/marketplace/listings/batch',
  '/api/v1/marketplace/my-listings',
  '/api/v1/marketplace/offers',
  '/api/v1/marketplace/offers/:p',
  '/api/v1/marketplace/orders',
  '/api/v1/marketplace/orders/:p',
  '/api/v1/marketplace/orders/:p/checkout',
  '/api/v1/marketplace/orders/:p/payment-link',
  '/api/v1/marketplace/orders/:p/payment-proof',
  '/api/v1/marketplace/orders/inquiry/:p',
  '/api/v1/marketplace/payments/:p/verify',
  '/api/v1/marketplace/payments/config',
  '/api/v1/marketplace/purchases',
  '/api/v1/marketplace/question-banks/:p/update-content',
  '/api/v1/marketplace/question-banks/mine',
  '/api/v1/marketplace/question-banks/publish',
  '/api/v1/marketplace/question-banks/restore',
  '/api/v1/marketplace/question-banks/updates',
  '/api/v1/marketplace/saved-searches',
  '/api/v1/marketplace/saved-searches/:p',
  '/api/v1/marketplace/saved-searches/:p/matches:p',
  '/api/v1/marketplace/seller/banks',
  '/api/v1/marketplace/seller/buyers:p',
  '/api/v1/marketplace/seller/campaigns',
  '/api/v1/marketplace/seller/onboarding',
  '/api/v1/marketplace/seller/onboarding/complete',
  '/api/v1/marketplace/seller/payments',
  '/api/v1/marketplace/seller/payout-profile',
  '/api/v1/marketplace/seller/preferences',
  '/api/v1/marketplace/sellers/:p/fulfillment',
  '/api/v1/marketplace/sellers/:p/pickup-nudge',
  '/api/v1/marketplace/sellers/:p/profile',
  '/api/v1/marketplace/sellers/me/shop',
  '/api/v1/marketplace/shops:p',
  '/api/v1/marketplace/stats',
  '/api/v1/marketplace/study-packs/:p/update-content',
  '/api/v1/marketplace/study-packs/mine',
  '/api/v1/marketplace/study-packs/publish',
  '/api/v1/marketplace/study-packs/restore',
  '/api/v1/marketplace/transactions',
  '/api/v1/marketplace/upload-image',
  '/api/v1/messages/:p',
  '/api/v1/messages/:p/bookmark',
  '/api/v1/messages/:p/pin',
  '/api/v1/messages/:p/reactions',
  '/api/v1/messages/:p/repost',
  '/api/v1/messages/:p/status',
  '/api/v1/messages/:p/update',
  '/api/v1/messages/:p/vote',
  '/api/v1/messages/bookmarks/import',
  '/api/v1/messages/bookmarks:p',
  '/api/v1/messages/dm/:p',
  '/api/v1/messages/dm/:p/accept',
  '/api/v1/messages/dm/:p/archive',
  '/api/v1/messages/dm/:p/decline',
  '/api/v1/messages/dm/:p/mute',
  '/api/v1/messages/dm/:p/read',
  '/api/v1/messages/dm/:p/thread/:p',
  '/api/v1/messages/dm/:p/unarchive',
  '/api/v1/messages/dm/:p/user-reactions',
  '/api/v1/messages/dm/threads',
  '/api/v1/messages/dm/unread/all',
  '/api/v1/messages/group/:p',
  '/api/v1/messages/group/:p/bookmarks',
  '/api/v1/messages/group/:p/pinned',
  '/api/v1/messages/group/:p/thread/:p',
  '/api/v1/messages/group/:p/user-reactions',
  '/api/v1/messages/group/:p/user-votes',
  '/api/v1/messages/upload-audio',
  '/api/v1/messages/upload-image',
  '/api/v1/messages/upload-question-image',
  '/api/v1/messages/user/:p',
  '/api/v1/notifications',
  '/api/v1/notifications/:p/read',
  '/api/v1/notifications/:p:p',
  '/api/v1/notifications/read-all',
  '/api/v1/offline-bundles',
  '/api/v1/preferences',
  '/api/v1/preferences/:p',
  '/api/v1/storage/signed-urls',
  '/api/v1/tests',
  '/api/v1/tests/:p',
  '/api/v1/tests/:p/results',
  '/api/v1/tests/:p/submit',
  '/api/v1/user-stats',
  '/api/v1/user-stats/:p',
  '/api/v1/users',
  '/api/v1/users/:p',
  '/api/v1/users/:p/avatar',
  '/api/v1/users/:p/blocks',
  '/api/v1/users/:p/blocks/:p',
  '/api/v1/users/:p/blocks/status/:p',
  '/api/v1/users/:p/budget',
  '/api/v1/users/:p/deactivate',
  '/api/v1/users/:p/delete-immediate',
  '/api/v1/users/:p/export',
  '/api/v1/users/:p/follow',
  '/api/v1/users/:p/import',
  '/api/v1/users/:p/lifecycle',
  '/api/v1/users/:p/reactivate',
  '/api/v1/users/:p/settings',
  '/api/v1/users/:p/username',
  '/api/v1/users/check-username/:p',
  '/api/v1/users/search',
  '/api/v1/users/settings',
  '/api/v1:p',
];

describe('services/supabase.ts public surface', () => {
  const surface = readSurface(ENTRY);

  it('publishes exactly the frozen list of names', () => {
    expect(surface.exports).toEqual([...EXPORTS]);
  });

  it('calls exactly the frozen list of /api/v1 paths', () => {
    expect(surface.apiPaths).toEqual([...API_PATHS]);
  });

  it('lists each name and each path once', () => {
    expect(new Set(EXPORTS).size).toBe(EXPORTS.length);
    expect(new Set(API_PATHS).size).toBe(API_PATHS.length);
  });

  it('follows a barrel, so the snapshot survives the split', () => {
    // Proves the mechanism the next PR depends on, without waiting for it: a
    // two-file fixture whose entry re-exports a second module must surface the
    // second module's export AND its request path.
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'lantern-surface-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'decks.ts'),
        "export const fetchDecks = () => fetch(`${root()}/api/v1/decks/${id}/cards`);\n"
      );
      fs.writeFileSync(path.join(dir, 'barrel.ts'), "export * from './decks';\n");
      const split = readSurface(path.join(dir, 'barrel.ts'));
      expect(split.exports).toEqual(['fetchDecks']);
      expect(split.apiPaths).toEqual(['/api/v1/decks/:p/cards']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

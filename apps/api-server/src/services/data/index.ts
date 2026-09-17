/**
 * data/index.ts — the composition root of the data layer.
 *
 * ## Purpose
 *
 * `services/data/*` modules are plain functions over an injected client:
 * `fn(client, deps, …args)`. Somebody has to hold the client and build the
 * `deps` literal. Today that somebody is `SupabaseService`, which rebuilds the
 * literal INLINE at each of its 382 delegations. This module does it ONCE per
 * domain and hands routes a record of per-domain namespaces of bound
 * functions, so a route calls `data.groups.isGroupMember(groupId, userId)`
 * with no client and no deps in sight.
 *
 * Route families keep the injector they already have — `initializeGroupRoutes`
 * now takes a `DataLayer` instead of a `SupabaseService` — which is why the
 * route suites that inject a bare stand-in keep working with nothing but a
 * regrouping of their `jest.fn()`s. The reasoning, and the option that was
 * rejected, are in `apps/api-server/docs/data-layer-wiring.md`.
 *
 * ## The one rule for `deps` here
 *
 * A cross-function dep reads through `layer` AT CALL TIME
 * (`(id, uid) => layer.groups.isGroupMember(id, uid)`), never a captured
 * reference to the bound function. That is what makes an overridden
 * `layer.groups.isGroupMember` visible to its siblings — the same property the
 * facade gets from arrows over `this`, and what several route suites rely on
 * when they stub one predicate and exercise the code path above it.
 *
 * Every `deps` literal below was taken from the facade's own inline literals,
 * unioned per domain, with `this.<method>` rewritten to the namespace that owns
 * that method. So the two wirings are the same wiring, and both are checked
 * against the same exported `*Deps` types.
 *
 * ## What it touches
 *
 * Nothing directly: it owns no query, no table and no bucket. It holds the one
 * service-role client (which BYPASSES RLS — every predicate in the modules
 * below is the access control) and the `supabaseUrl` the storage ACL needs to
 * sign an object.
 *
 * ## No seam left
 *
 * Every dep is built here, from this layer. The `host` bridge that carried the
 * few the layer could not build — bodies that had never left `SupabaseService`,
 * its per-instance rating circuit breaker, and wrappers over services that took
 * the facade whole — is gone with the facade (monolith lane M3). If something
 * ever cannot be built from the layer again, it is a sign the body is in the
 * wrong place, not that the seam should come back.
 */

import type { DataClient } from "./client";
import * as academicData from "./academic";
import * as adminAnalyticsData from "./adminAnalytics";
import * as boardActionsData from "./boardActions";
import * as categoriesData from "./categories";
import * as chatSendData from "./chatSend";
import * as clientData from "./client";
import * as decksData from "./decks";
import * as directMessagesData from "./directMessages";
import * as gamificationData from "./gamification";
import * as groupMessagesData from "./groupMessages";
import * as groupsData from "./groups";
import * as mappersData from "./mappers";
import * as marketplaceData from "./marketplace";
import * as notesData from "./notes";
import * as notificationsData from "./notifications";
import * as offlineBundlesData from "./offlineBundles";
import * as readStateData from "./readState";
import * as storageAclData from "./storageAcl";
import * as testsData from "./tests";
import * as uploadsData from "./uploads";
import * as usersData from "./users";

/**
 * What a `services/*` module needs when all it wants is the service-role
 * client: `getClient()`, and nothing else.
 *
 * Most of the nineteen services frozen by the facade (`services-flip-plan.md`)
 * took the whole `SupabaseService` and reached exactly one member on it. They
 * take this instead (monolith lane M3, Phase B), so a flipped caller hands
 * over `dataLayer` itself. `SupabaseService` satisfies it structurally too,
 * which is what lets call sites this lane has not reached keep working
 * unchanged — nothing has to move twice, and the alias dies with the class.
 *
 * A service that reaches a DOMAIN method does NOT get this type: it takes the
 * namespaces it uses (`Pick<DataLayer, "getClient" | "notifications">`) or the
 * whole `DataLayer`, so that the compiler still checks the call.
 */
export type DataClientHost = Pick<DataLayer, "getClient">;

export type CreateDataLayerOptions = {
  client: DataClient;
  /** Needed by the storage ACL to sign an object; `DatabaseConfig.url`. */
  supabaseUrl: string;
};

/**
 * Bind a data function's first parameter (the client), leaving its own
 * arguments — and their types, optionality included — as they are.
 */
function bindDb<A extends unknown[], R>(
  client: DataClient,
  fn: (client: DataClient, ...args: A) => R,
): (...args: A) => R {
  return (...args: A) => fn(client, ...args);
}

/** The same, for a function whose second parameter is its `deps` literal. */
function bindDbDeps<D, A extends unknown[], R>(
  client: DataClient,
  deps: D,
  fn: (client: DataClient, deps: D, ...args: A) => R,
): (...args: A) => R {
  return (...args: A) => fn(client, deps, ...args);
}

/** For the functions that need only `deps` — they issue no query themselves. */
function bindDeps<D, A extends unknown[], R>(
  deps: D,
  fn: (deps: D, ...args: A) => R,
): (...args: A) => R {
  return (...args: A) => fn(deps, ...args);
}

/**
 * `data/storageAcl.ts` alone takes the project URL as its second positional
 * argument (it rewrites legacy `localhost:54321` links while signing), so it
 * gets its own binder shape rather than a `deps` object.
 */
function bindDbUrl<A extends unknown[], R>(
  client: DataClient,
  supabaseUrl: string,
  fn: (client: DataClient, supabaseUrl: string, ...args: A) => R,
): (...args: A) => R {
  return (...args: A) => fn(client, supabaseUrl, ...args);
}

/** The pure half of the same module: URL first, no client. */
function bindUrl<A extends unknown[], R>(
  supabaseUrl: string,
  fn: (supabaseUrl: string, ...args: A) => R,
): (...args: A) => R {
  return (...args: A) => fn(supabaseUrl, ...args);
}

/**
 * `SupabaseService.getResponseProfile`, the one private helper several data
 * modules need. Three lines of pure coercion, so it is inlined here rather than
 * routed back through the facade.
 */
const getResponseProfile = (profile?: string): "compact" | "full" =>
  profile === "compact" ? "compact" : "full";

export function createDataLayer(options: CreateDataLayerOptions) {
  const { client, supabaseUrl } = options;

  // Declared first so every `deps` arrow below can read through it at CALL
  // time. Namespaces are assigned immediately after; nothing invokes a dep
  // during construction.
  const layer = {} as DataLayer;

  // The rating-column circuit breaker, ONE per layer — the per-instance
  // property `supabase.reviewSignals.test.ts` asserts, now held here instead
  // of on a `SupabaseService` field. See gotcha 2 in `data/marketplace.ts`.
  const ratingColumns = marketplaceData.createRatingColumnCircuitBreaker();

  // --- deps the layer builds over services that still take the whole facade --
  //
  // Narrowed in monolith lane M3 from `service: layer`, which is
  // what these four data modules used to be handed. The lazy `await import()`
  // is the one the data modules used to do inline: it still runs when the dep
  // is CALLED, never at module load, so the cycle stays out of the boot path.
  // Each arrow loses its `layer` as its service is flipped onto
  // the layer.
  const recordLearningEvent: notesData.NotesDeps["recordLearningEvent"] = async (
    input,
  ) =>
    (await import("../learningEvents")).recordLearningEvent(layer, input);
  const lookupDeckOwnerAndCourse: offlineBundlesData.FlashcardDeps["lookupDeckOwnerAndCourse"] =
    async (deckId) =>
      (await import("../learningEvents")).lookupDeckOwnerAndCourse(
        layer,
        deckId,
      );
  const refreshTopicMastery: offlineBundlesData.FlashcardDeps["refreshTopicMastery"] =
    async (userId) => {
      const { getTopicMasteryService } = await import("../topicMastery");
      getTopicMasteryService(layer).refreshAsync(userId);
    };
  const recordLearningConnection: notesData.NotesDeps["recordLearningConnection"] =
    async (input) => {
      const { getLearningConnectionsService } = await import(
        "../learningConnections"
      );
      await getLearningConnectionsService(layer).record(input);
    };
  // Four deps that used to come off `DataLayerHost` and now do not: their
  // services were flipped onto `DataClientHost` (M3 Phase B), which `layer`
  // satisfies, so the layer builds them for itself and the bridge shrinks.
  const resolveTopicForArtefact: academicData.ResolveTopicForArtefact = async (
    topicId,
    courseId,
  ) => {
    const { getCourseTopicsService } = await import("../courseTopics");
    return getCourseTopicsService(layer).resolveForArtefact(topicId, courseId);
  };
  const deleteUserAccountFully: usersData.DeleteAccountDeps["deleteUserAccountFully"] =
    async (userId) =>
      (await import("../userDataLifecycle")).deleteUserAccountFully(
        layer,
        userId,
      );
  const exportUserDataArchive: usersData.ExportAccountDeps["exportUserDataArchive"] =
    async (userId) =>
      (await import("../userDataLifecycle")).exportUserDataArchive(
        layer,
        userId,
      );
  const createOrderFromBuyNow: marketplaceData.MarketplaceDeps["createOrderFromBuyNow"] =
    async (listingId, buyerId, couponCode, quantity) => {
      const { getMarketplaceOrdersService } = await import("../marketplaceOrders");
      return getMarketplaceOrdersService(layer).createOrderFromBuyNow(
        listingId,
        buyerId,
        couponCode,
        quantity,
      );
    };
  const createOrderFromOfferAccept: marketplaceData.MarketplaceDeps["createOrderFromOfferAccept"] =
    async (offerId, actorId) => {
      const { getMarketplaceOrdersService } = await import("../marketplaceOrders");
      return getMarketplaceOrdersService(layer).createOrderFromOfferAccept(
        offerId,
        actorId,
      );
    };
  const consumeBoostCredit: marketplaceData.MarketplaceDeps["consumeBoostCredit"] =
    async (sellerId) => {
      const { getMarketplaceSellerToolsService } = await import(
        "../marketplaceSellerTools"
      );
      return getMarketplaceSellerToolsService(layer).consumeBoostCredit(sellerId);
    };
  const notifyListingBackAvailable: marketplaceData.MarketplaceDeps["notifyListingBackAvailable"] =
    async (listing, previousStatus) => {
      const { notifyListingBackAvailable: notify } = await import(
        "../marketplaceFavoriteAlerts"
      );
      await notify(layer, listing, previousStatus);
    };
  const recordActivity: notesData.NotesDeps["recordActivity"] = async (input) => {
    const { getActivityFeedService } = await import("../activityFeed");
    await getActivityFeedService(layer).record(input);
  };

  // --- deps literals, one per domain ---------------------------------------

  const boardActionsDeps: boardActionsData.BoardActionDeps = {
    bookmarkedAmong: (ids, uid) => layer.boardActions.bookmarkedAmong(ids, uid),
    bookmarksMissingTable: (error) => layer.boardActions.bookmarksMissingTable(error),
    countRepostsFor: (ids) => layer.boardActions.countRepostsFor(ids),
    favoritedAmong: (ids, uid) => layer.boardActions.favoritedAmong(ids, uid),
    getAuthorizedDmMessage: (id, uid) => layer.groups.getAuthorizedDmMessage(id, uid),
    getAuthorizedGroupMessage: (id, uid) => layer.groups.getAuthorizedGroupMessage(id, uid),
    normalizeStorageUrl: (url) => layer.storageAcl.normalizeStorageUrl(url),
    orphanedRepostEmbed: (row) => layer.boardActions.orphanedRepostEmbed(row),
    reactionsMissingTable: (error) => layer.groupMessages.reactionsMissingTable(error),
    readBoardContextForGroups: (groupIds) => layer.boardActions.readBoardContextForGroups(groupIds),
    readBoardPostRows: (ids) => layer.boardActions.readBoardPostRows(ids),
    repostedByMeAmong: (ids, uid) => layer.boardActions.repostedByMeAmong(ids, uid),
    resolveBoardContext: (id) => layer.chatSend.resolveBoardContext(id),
    reviveRemovedRepost: (gid, uid, clientMessageId, text) => layer.boardActions.reviveRemovedRepost(gid, uid, clientMessageId, text),
    toBoardPostShape: (row, extras) => layer.boardActions.toBoardPostShape(row, extras),
    toQuotedPost: (row) => layer.boardActions.toQuotedPost(row),
  };
  const chatSendDeps: chatSendData.ChatSendDeps = {
    attachReplyPreview: (message, table) => layer.chatSend.attachReplyPreview(message, table),
    attachReplyPreviewsBatch: (rows, table) => layer.chatSend.attachReplyPreviewsBatch(rows, table),
    attachThreadReplyCounts: (rows, table, scopeColumn, scopeId) => layer.chatSend.attachThreadReplyCounts(rows, table, scopeColumn, scopeId),
    buildReplyToFromParent: (parent, t) => layer.chatSend.buildReplyToFromParent(parent, t),
    communityMemberRole: (communityId, uid) => layer.boardActions.communityMemberRole(communityId, uid),
    createNotification: (uid, notification) => layer.notifications.createNotification(uid, notification as any),
    enrichDmMessageReceipts: (messages, tid, viewer, peer) => layer.chatSend.enrichDmMessageReceipts(messages, tid, viewer, peer),
    enrichGroupMessageReceipts: (messages, gid, viewer) => layer.chatSend.enrichGroupMessageReceipts(messages, gid, viewer),
    fetchGroupMembers: (gid) => layer.chatSend.fetchGroupMembers(gid),
    findGroupMessageByClientId: (gid, uid, clientId) => layer.chatSend.findGroupMessageByClientId(gid, uid, clientId),
    getGroupById: (gid, uid) => layer.groups.getGroupById(gid, uid),
    getUserById: (uid) => layer.users.getUserById(uid),
    incrementUserStatsAndAwardBadges: (uid, increments) => layer.gamification.incrementUserStatsAndAwardBadges(uid, increments),
    isGroupAdmin: (gid, uid) => layer.groups.isGroupAdmin(gid, uid),
    normalizeMessageRecord: (row) => layer.mappers.normalizeMessageRecord(row),
    notifyBoardCommentRecipients: (params) => layer.chatSend.notifyBoardCommentRecipients(params),
    notifyGroupMessageRecipients: (params) => layer.chatSend.notifyGroupMessageRecipients(params),
    notifyMentionedUsers: (params) => layer.chatSend.notifyMentionedUsers(params),
    notifyReplyRecipient: (params) => layer.chatSend.notifyReplyRecipient(params),
    resolveBoardContext: (gid) => layer.chatSend.resolveBoardContext(gid),
    resolveCommunityRoleFor: (uid, communityId, createdBy) => layer.chatSend.resolveCommunityRoleFor(uid, communityId, createdBy),
    resolveGroupMentionUserIds: (gid, sid, text, explicitIds) => layer.chatSend.resolveGroupMentionUserIds(gid, sid, text, explicitIds),
    resolveThreadRootForReply: (table, replyToId, scope) => layer.chatSend.resolveThreadRootForReply(table, replyToId, scope),
  };
  const decksDeps: decksData.DeckDeps = {
    getAccessibleDeckIds: (uid) => layer.offlineBundles.getAccessibleDeckIds(uid),
    getDeckForUser: (id, uid) => layer.offlineBundles.getDeckForUser(id, uid),
    getResponseProfile: (profile) => getResponseProfile(profile),
    resolveArtefactTopic: (input) => layer.academic.resolveArtefactTopic(input),
    resolveArtefactTopicPatch: (table, id, updates) => layer.academic.resolveArtefactTopicPatch(table, id, updates),
    verifyDeckAccess: (uid, id, level) => layer.offlineBundles.verifyDeckAccess(uid, id, level),
  };
  const directMessagesDeps: directMessagesData.DirectMessageDeps = {
    attachReplyPreview: (row, table) => layer.chatSend.attachReplyPreview(row, table),
    attachReplyPreviewsBatch: (rows, table) => layer.chatSend.attachReplyPreviewsBatch(rows, table),
    attachThreadReplyCounts: (rows, table, scopeColumn, scopeId) => layer.chatSend.attachThreadReplyCounts(rows, table, scopeColumn, scopeId),
    createNotification: (uid, notification) => layer.notifications.createNotification(uid, notification),
    enrichDmMessageReceipts: (messages, threadId, uid, otherId) => layer.chatSend.enrichDmMessageReceipts(messages, threadId, uid, otherId),
    isDmBlockedBetween: (a, b) => layer.directMessages.isDmBlockedBetween(a, b),
    normalizeMessageRecord: (row) => layer.mappers.normalizeMessageRecord(row),
    recordLearningConnection,
    resolveThreadRootForReply: (table, replyToMessageId, scope) => layer.chatSend.resolveThreadRootForReply(table, replyToMessageId, scope),
  };
  const gamificationDeps: gamificationData.GamificationDeps = {
    awardPoints: (uid, points, reason, source) => layer.gamification.awardPoints(uid, points, reason, source),
    getLevels: () => layer.gamification.getLevels(),
    getStudyActivity: (uid, days) => layer.gamification.getStudyActivity(uid, days),
    getUserById: (uid) => layer.users.getUserById(uid),
    getUserLevel: (uid) => layer.gamification.getUserLevel(uid),
    parseStreakReferenceDate: (referenceDate) => layer.gamification.parseStreakReferenceDate(referenceDate),
    profileToGamificationUser: (profile, statsOverride) => layer.gamification.profileToGamificationUser(profile, statsOverride),
    recomputeDerivedUserStats: (uid) => layer.gamification.recomputeDerivedUserStats(uid),
    recomputeUserStreak: (uid, referenceDate) => layer.gamification.recomputeUserStreak(uid, referenceDate),
    recordStudyActivity: (uid, type, amount, activityDate) => layer.gamification.recordStudyActivity(uid, type, amount, activityDate),
    recordActivity,
    syncGamificationProgressWithStats: (uid, options) => layer.gamification.syncGamificationProgressWithStats(uid, options),
    updateUser: (uid, updates, options) => layer.users.updateUser(uid, updates, options),
  };
  const groupMessagesDeps: groupMessagesData.GroupMessageDeps = {
    attachBoardRepostContext: (rows, gid) => layer.boardActions.attachBoardRepostContext(rows, gid),
    attachPeerUpvotes: (messages) => layer.groupMessages.attachPeerUpvotes(messages),
    attachReplyPreviewsBatch: (rows, table) => layer.chatSend.attachReplyPreviewsBatch(rows, table),
    attachThreadReplyCounts: (rows, table, scopeColumn, scopeId) => layer.chatSend.attachThreadReplyCounts(rows, table, scopeColumn, scopeId),
    clearPinOnRemovedMessage: (message) => layer.groupMessages.clearPinOnRemovedMessage(message),
    countPeerUpvotesForMessage: (id, authorId) => layer.groupMessages.countPeerUpvotesForMessage(id, authorId),
    enrichBoardViewerState: (messages, viewerUserId) => layer.boardActions.enrichBoardViewerState(messages, viewerUserId),
    enrichGroupMessageReceipts: (messages, gid, viewerUserId) => layer.chatSend.enrichGroupMessageReceipts(messages, gid, viewerUserId),
    getResponseProfile: (value) => getResponseProfile(value),
    invalidateChatMessageMutation: (k, row) => layer.groupMessages.invalidateChatMessageMutation(k, row),
    mapChatMutationRow: (k, row) => layer.groupMessages.mapChatMutationRow(k, row),
    normalizeMessageRecord: (row) => layer.mappers.normalizeMessageRecord(row),
    reactionsMissingTable: (error) => layer.groupMessages.reactionsMissingTable(error),
    readMessageReactions: (id, s) => layer.groupMessages.readMessageReactions(id, s),
    refreshChatMessageNotifications: (k, id, action, preview) => layer.groupMessages.refreshChatMessageNotifications(k, id, action, preview),
    refreshChatPreview: (k, row) => layer.groupMessages.refreshChatPreview(k, row),
    syncQuestionStatusAfterVote: (id) => layer.groupMessages.syncQuestionStatusAfterVote(id),
  };
  const groupsDeps: groupsData.GroupDeps = {
    acceptGroupInvite: (id, uid) => layer.groups.acceptGroupInvite(id, uid),
    getGroupById: (id, uid) => layer.groups.getGroupById(id, uid),
    getResponseProfile: (profile) => getResponseProfile(profile),
    incrementUserStatsAndAwardBadges: (uid, increments) => layer.gamification.incrementUserStatsAndAwardBadges(uid, increments),
    isDmThreadParticipant: (tid, uid) => layer.groups.isDmThreadParticipant(tid, uid),
    isGroupMember: (id, uid) => layer.groups.isGroupMember(id, uid),
  };
  const marketplaceDeps: marketplaceData.MarketplaceDeps = {
    attachListingKinds: (rows) => layer.marketplace.attachListingKinds(rows),
    attachMarketplaceReviewSignals: (lid, reviews, viewerId) => layer.marketplace.attachMarketplaceReviewSignals(lid, reviews, viewerId),
    attachSellerTrust: (rows) => layer.marketplace.attachSellerTrust(rows),
    canUserReviewListing: (lid, uid) => layer.marketplace.canUserReviewListing(lid, uid),
    consumeBoostCredit,
    createOrderFromBuyNow,
    createOrderFromOfferAccept,
    deleteMarketplaceListing: (lid) => layer.marketplace.deleteMarketplaceListing(lid),
    fetchSellerTrust: (ids) => layer.marketplace.fetchSellerTrust(ids),
    getClient: () => layer.getClient(),
    getInquiryByListingAndBuyer: (id, buyer) => layer.marketplace.getInquiryByListingAndBuyer(id, buyer),
    getMarketplaceListingById: (lid, options) => layer.marketplace.getMarketplaceListingById(lid, options),
    getRelatedMarketplaceListingsInner: (l, lim) => layer.marketplace.getRelatedMarketplaceListingsInner(l, lim),
    getResponseProfile: (p) => getResponseProfile(p),
    isMissingRatingColumn: (error) => layer.marketplace.isMissingRatingColumn(error),
    isPlatformAdmin: (uid) => layer.client.isPlatformAdmin(uid),
    logMarketplaceBudgetTransactions: (params) => layer.marketplace.logMarketplaceBudgetTransactions(params),
    maybeLogManualSoldBudget: (lid, sid) => layer.marketplace.maybeLogManualSoldBudget(lid, sid),
    normalizeFavoriteRecord: (f) => layer.marketplace.normalizeFavoriteRecord(f),
    normalizeInquiryRecord: (i) => layer.marketplace.normalizeInquiryRecord(i),
    normalizeListingRecord: (l) => layer.marketplace.normalizeListingRecord(l),
    normalizeListingRecordAsync: (l) => layer.marketplace.normalizeListingRecordAsync(l),
    normalizeStorageUrl: (url) => layer.storageAcl.normalizeStorageUrl(url),
    createNotification: (uid, notification) => layer.notifications.createNotification(uid, notification),
    signStorageDisplayUrl: (url, expiresInSeconds, variant) => layer.storageAcl.signStorageDisplayUrl(url, expiresInSeconds, variant),
    noteRatingColumnsMissing: () => layer.marketplace.noteRatingColumnsMissing(),
    notifyListingBackAvailable,
    pickCompactListingFields: (l) => layer.marketplace.pickCompactListingFields(l),
    ratingColumnsAvailable: () => layer.marketplace.ratingColumnsAvailable(),
    recordLearningConnection,
    resolveArtefactTopic: (input) => layer.academic.resolveArtefactTopic(input),
    signSimilarListingCards: (l) => layer.marketplace.signSimilarListingCards(l),
    signStorageDisplayUrls: (refs, options) => layer.storageAcl.signStorageDisplayUrls(refs, options),
    stripInquiryListingModeration: (inquiry) => layer.marketplace.stripInquiryListingModeration(inquiry),
    toListingCardRecords: (l) => layer.marketplace.toListingCardRecords(l),
  };
  const mappersDeps: mappersData.MessageRecordDeps = {
    normalizeStorageUrl: (url) => layer.storageAcl.normalizeStorageUrl(url),
  };
  const notesDeps: notesData.NotesDeps = {
    addNoteAttachment: (nid, payload) => layer.notes.addNoteAttachment(nid, payload),
    attachNoteSearchText: (notes) => layer.notes.attachNoteSearchText(notes),
    createNote: (uid, payload, options) => layer.notes.createNote(uid, payload, options),
    createNotification: (uid, notification) => layer.notifications.createNotification(uid, notification),
    createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) => layer.storageAcl.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
    downloadNoteFile: (storagePath) => layer.notes.downloadNoteFile(storagePath),
    getNote: (nid, uid) => layer.notes.getNote(nid, uid),
    getNoteAttachments: (nid) => layer.notes.getNoteAttachments(nid),
    getNoteOwnerPresentation: (ownerId) => layer.notes.getNoteOwnerPresentation(ownerId),
    getNoteQuiz: (uid, nid) => layer.notes.getNoteQuiz(uid, nid),
    isNoteOwner: (uid, nid) => layer.notes.isNoteOwner(uid, nid),
    isNoteQuizProtected: (...args: any[]) => (layer.notes.isNoteQuizProtected as any)(...args),
    mapNote: (row, extras) => layer.notes.mapNote(row, extras as any),
    mapNoteFolder: (row) => layer.notes.mapNoteFolder(row),
    mapNoteQuiz: (row) => layer.notes.mapNoteQuiz(row),
    normalizeStorageUrl: (url) => layer.storageAcl.normalizeStorageUrl(url),
    resolveArtefactTopic: (input) => layer.academic.resolveArtefactTopic(input),
    resolveArtefactTopicPatch: (table, id, updates) => layer.academic.resolveArtefactTopicPatch(table as any, id, updates),
    resolveCollaboratorUserId: (identifier) => layer.users.resolveCollaboratorUserId(identifier),
    resolveNoteAccess: (nid, uid) => layer.notes.resolveNoteAccess(nid, uid),
    resolveNoteAttachmentStoragePath: (attachment) => layer.notes.resolveNoteAttachmentStoragePath(attachment),
    recordActivity,
    recordLearningConnection,
    recordLearningEvent,
    updateNote: (uid, nid, updates) => layer.notes.updateNote(uid, nid, updates),
    uploadNoteFile: (params) => layer.notes.uploadNoteFile(params),
    canEditNote: (uid, nid) => layer.notes.canEditNote(uid, nid),
  };
  const notificationsDeps: notificationsData.CreateNotificationDeps = {
    isChatMuted: (uid, scopeType, scopeId) => layer.readState.isChatMuted(uid, scopeType, scopeId),
    sendExpoPushForNotification: (uid, notification) => layer.users.sendExpoPushForNotification(uid, notification),
  };
  const offlineBundlesDeps: offlineBundlesData.FlashcardDeps = {
    attachQuestionStatStems: (rows) => layer.offlineBundles.attachQuestionStatStems(rows),
    fetchDeckRecord: (id) => layer.offlineBundles.fetchDeckRecord(id),
    getAccessibleDeckIds: (uid) => layer.offlineBundles.getAccessibleDeckIds(uid),
    getFlashcard: (id) => layer.offlineBundles.getFlashcard(id),
    getFlashcardForUser: (id, uid) => layer.offlineBundles.getFlashcardForUser(id, uid),
    getResponseProfile: (profile) => getResponseProfile(profile),
    getUserPreferences: (uid) => layer.categories.getUserPreferences(uid),
    lookupDeckOwnerAndCourse,
    recordLearningConnection,
    recordLearningEvent,
    refreshTopicMastery,
    updateFlashcard: (id, updates, uid, options) => layer.offlineBundles.updateFlashcard(id, updates, uid, options),
    verifyDeckAccess: (uid, id, level) => layer.offlineBundles.verifyDeckAccess(uid, id, level),
  };
  const readStateDeps: readStateData.ReadStateDeps = {
    assertChatMuteAccess: (uid, type, id) => layer.readState.assertChatMuteAccess(uid, type, id),
    broadcastChatRead: (chatId, payload) => layer.chatSend.broadcastChatRead(chatId, payload),
    getAllDMUnreadCountsFallback: (uid) => layer.readState.getAllDMUnreadCountsFallback(uid),
    getAllGroupUnreadCountsFallback: (uid) => layer.readState.getAllGroupUnreadCountsFallback(uid),
    getDMUnreadCount: (tid, uid) => layer.readState.getDMUnreadCount(tid, uid),
  };
  const storageAclDeps: storageAclData.StorageAclDeps = {
    canViewPeerChatAvatar: (viewerId, peerId) => layer.groups.canViewPeerChatAvatar(viewerId, peerId),
    isDmThreadParticipant: (threadId, uid) => layer.groups.isDmThreadParticipant(threadId, uid),
    isGroupMember: (groupId, uid) => layer.groups.isGroupMember(groupId, uid),
    isProfileVisibleToViewer: (viewerId, targetId) => layer.users.isProfileVisibleToViewer(viewerId, targetId),
    resolveNoteAccess: (noteId, uid) => layer.notes.resolveNoteAccess(noteId, uid),
    verifyDeckAccess: (uid, deckId, level) => layer.offlineBundles.verifyDeckAccess(uid, deckId, level),
  };
  const testsDeps: testsData.TestDeps = {
    applyTestCompletionGamification: (uid, activityDate) => layer.gamification.applyTestCompletionGamification(uid, activityDate),
    // Generic in the data module (`<T extends …>`); binding erases the type
    // parameter, so the cast restores the signature `TestDeps` declares.
    attachSourceNoteTitles: ((rows: any, uid: any) =>
      layer.tests.attachSourceNoteTitles(rows, uid)) as testsData.TestDeps["attachSourceNoteTitles"],
    calculateTestScore: (questions, answers) => layer.tests.calculateTestScore(questions, answers),
    createTestResult: (id, resultData, uid, options) => layer.tests.createTestResult(id, resultData, uid, options),
    deleteTest: (id) => layer.tests.deleteTest(id),
    fetchDeckTitles: (ids, uid) => layer.tests.fetchDeckTitles(ids, uid),
    fetchNoteTitles: (ids, uid) => layer.tests.fetchNoteTitles(ids, uid),
    generateTestQuestions: (config) => layer.tests.generateTestQuestions(config),
    getTestById: (id, uid) => layer.tests.getTestById(id, uid),
    getUserTests: (uid, options) => layer.tests.getUserTests(uid, options),
    isGroupMember: (groupId, uid) => layer.groups.isGroupMember(groupId, uid),
    mapTestSessionRowToClient: (session) => layer.tests.mapTestSessionRowToClient(session),
    resolveArtefactTopic: (input) => layer.academic.resolveArtefactTopic(input),
    recordTestSessionAnswers: async (params) =>
      (await import("../learningEvents")).recordTestSessionAnswers(layer, params),
    updateUserStats: (uid, score) => layer.tests.updateUserStats(uid, score),
  };
  const signUrlDeps: uploadsData.SignUrlDeps = {
    createSignedStorageUrl: (bucket, path, ttl) =>
      layer.storageAcl.createSignedStorageUrl(bucket, path, ttl),
    createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
      layer.storageAcl.createSignedStorageUrlWithVariant(bucket, path, ttl, variant),
  };
  const chatUploadDeps: uploadsData.ChatUploadDeps = {
    ...signUrlDeps,
    isGroupMember: (id, uid) => layer.groups.isGroupMember(id, uid),
    isDmThreadParticipant: (tid, uid) => layer.groups.isDmThreadParticipant(tid, uid),
  };
  const deleteAccountDeps: usersData.DeleteAccountDeps = {
    deleteUserAccountFully: (uid) => deleteUserAccountFully(uid),
  };
  const exportAccountDeps: usersData.ExportAccountDeps = {
    exportUserDataArchive: (uid) => exportUserDataArchive(uid),
  };

  // --- namespaces -----------------------------------------------------------

  layer.getClient = () => client;
  layer.academic = createAcademicApi(client, resolveTopicForArtefact);
  layer.adminAnalytics = createAdminAnalyticsApi(client);
  layer.boardActions = createBoardActionsApi(client, boardActionsDeps);
  layer.categories = createCategoriesApi(client);
  layer.chatSend = createChatSendApi(client, chatSendDeps);
  layer.client = createClientApi(client);
  layer.decks = createDecksApi(client, decksDeps);
  layer.directMessages = createDirectMessagesApi(client, directMessagesDeps);
  layer.gamification = createGamificationApi(client, gamificationDeps);
  layer.groupMessages = createGroupMessagesApi(client, groupMessagesDeps);
  layer.groups = createGroupsApi(client, groupsDeps);
  layer.mappers = createMappersApi(mappersDeps);
  layer.marketplace = createMarketplaceApi(client, marketplaceDeps, ratingColumns);
  layer.notes = createNotesApi(client, notesDeps);
  layer.notifications = createNotificationsApi(client, notificationsDeps);
  layer.offlineBundles = createOfflineBundlesApi(client, offlineBundlesDeps);
  layer.readState = createReadStateApi(client, readStateDeps);
  layer.storageAcl = createStorageAclApi(client, supabaseUrl, storageAclDeps);
  layer.tests = createTestsApi(client, testsDeps);
  layer.uploads = createUploadsApi(client, signUrlDeps, chatUploadDeps);
  layer.users = createUsersApi(client, deleteAccountDeps, exportAccountDeps);

  return layer;
}

function createAcademicApi(
  client: DataClient,
  resolveTopicForArtefact: academicData.ResolveTopicForArtefact,
) {
  return {
    resolveCourseIdFromConfigLike: academicData.resolveCourseIdFromConfigLike,
    resolveStudySetIdFromConfigLike: academicData.resolveStudySetIdFromConfigLike,
    resolveArtefactTopic: bindDeps(resolveTopicForArtefact, academicData.resolveArtefactTopic),
    resolveArtefactTopicPatch: bindDbDeps(client, resolveTopicForArtefact, academicData.resolveArtefactTopicPatch),
    currentArtefactCourseId: bindDb(client, academicData.currentArtefactCourseId),
    writeWithTopicFallback: academicData.writeWithTopicFallback,
  };
}

function createAdminAnalyticsApi(
  client: DataClient,
) {
  return {
    getAdminAnalytics: bindDb(client, adminAnalyticsData.getAdminAnalytics),
  };
}

function createBoardActionsApi(
  client: DataClient,
  boardActionsDeps: boardActionsData.BoardActionDeps,
) {
  return {
    bookmarksMissingTable: boardActionsData.bookmarksMissingTable,
    setMessageBookmark: bindDbDeps(client, boardActionsDeps, boardActionsData.setMessageBookmark),
    getBookmarkedMessageIdsForGroup: bindDbDeps(client, boardActionsDeps, boardActionsData.getBookmarkedMessageIdsForGroup),
    listBookmarkedPosts: bindDbDeps(client, boardActionsDeps, boardActionsData.listBookmarkedPosts),
    importMessageBookmarks: bindDbDeps(client, boardActionsDeps, boardActionsData.importMessageBookmarks),
    createBoardRepost: bindDbDeps(client, boardActionsDeps, boardActionsData.createBoardRepost),
    reviveRemovedRepost: bindDb(client, boardActionsData.reviveRemovedRepost),
    undoBoardRepost: bindDb(client, boardActionsData.undoBoardRepost),
    attachBoardRepostContext: bindDbDeps(client, boardActionsDeps, boardActionsData.attachBoardRepostContext),
    orphanedRepostEmbed: boardActionsData.orphanedRepostEmbed,
    toQuotedPost: boardActionsData.toQuotedPost,
    countRepostsFor: bindDb(client, boardActionsData.countRepostsFor),
    repostedByMeAmong: bindDb(client, boardActionsData.repostedByMeAmong),
    favoritedAmong: bindDbDeps(client, boardActionsDeps, boardActionsData.favoritedAmong),
    enrichBoardViewerState: bindDeps(boardActionsDeps, boardActionsData.enrichBoardViewerState),
    bookmarkedAmong: bindDbDeps(client, boardActionsDeps, boardActionsData.bookmarkedAmong),
    readBoardPostRows: bindDb(client, boardActionsData.readBoardPostRows),
    readBoardContextForGroups: bindDb(client, boardActionsData.readBoardContextForGroups),
    toBoardPostShape: bindDeps(boardActionsDeps, boardActionsData.toBoardPostShape),
    communityMemberRole: bindDb(client, boardActionsData.communityMemberRole),
  };
}

function createCategoriesApi(
  client: DataClient,
) {
  return {
    getCustomCategories: bindDb(client, categoriesData.getCustomCategories),
    createCustomCategory: bindDb(client, categoriesData.createCustomCategory),
    incrementCategoryUsage: bindDb(client, categoriesData.incrementCategoryUsage),
    getUserPreferences: bindDb(client, categoriesData.getUserPreferences),
    upsertUserPreferences: bindDb(client, categoriesData.upsertUserPreferences),
  };
}

function createChatSendApi(
  client: DataClient,
  chatSendDeps: chatSendData.ChatSendDeps,
) {
  return {
    extractMentionUsernames: chatSendData.extractMentionUsernames,
    fetchGroups: bindDb(client, chatSendData.fetchGroups),
    fetchGroupMembers: bindDb(client, chatSendData.fetchGroupMembers),
    findGroupMessageByClientId: bindDb(client, chatSendData.findGroupMessageByClientId),
    resolveGroupMentionUserIds: bindDeps(chatSendDeps, chatSendData.resolveGroupMentionUserIds),
    buildReplyToFromParent: chatSendData.buildReplyToFromParent,
    attachReplyPreview: bindDbDeps(client, chatSendDeps, chatSendData.attachReplyPreview),
    attachReplyPreviewsBatch: bindDbDeps(client, chatSendDeps, chatSendData.attachReplyPreviewsBatch),
    attachThreadReplyCounts: bindDb(client, chatSendData.attachThreadReplyCounts),
    enrichGroupMessageReceipts: bindDb(client, chatSendData.enrichGroupMessageReceipts),
    enrichDmMessageReceipts: bindDb(client, chatSendData.enrichDmMessageReceipts),
    resolveThreadRootForReply: bindDb(client, chatSendData.resolveThreadRootForReply),
    broadcastChatRead: bindDb(client, chatSendData.broadcastChatRead),
    getGroupThread: bindDbDeps(client, chatSendDeps, chatSendData.getGroupThread),
    getDmThread: bindDbDeps(client, chatSendDeps, chatSendData.getDmThread),
    notifyGroupMessageRecipients: bindDbDeps(client, chatSendDeps, chatSendData.notifyGroupMessageRecipients),
    notifyMentionedUsers: bindDeps(chatSendDeps, chatSendData.notifyMentionedUsers),
    notifyReplyRecipient: bindDbDeps(client, chatSendDeps, chatSendData.notifyReplyRecipient),
    resolveCommunityRoleFor: bindDb(client, chatSendData.resolveCommunityRoleFor),
    resolveBoardContext: bindDbDeps(client, chatSendDeps, chatSendData.resolveBoardContext),
    notifyBoardCommentRecipients: bindDbDeps(client, chatSendDeps, chatSendData.notifyBoardCommentRecipients),
    sendMessage: bindDbDeps(client, chatSendDeps, chatSendData.sendMessage),
    getPinnedMessage: bindDbDeps(client, chatSendDeps, chatSendData.getPinnedMessage),
    setMessagePin: bindDbDeps(client, chatSendDeps, chatSendData.setMessagePin),
  };
}

function createClientApi(
  client: DataClient,
) {
  return {
    isTransientAuthError: clientData.isTransientAuthError,
    isPlatformAdmin: bindDb(client, clientData.isPlatformAdmin),
    healthCheck: bindDb(client, clientData.healthCheck),
    verifySupabaseToken: bindDb(client, clientData.verifySupabaseToken),
    verifySupabaseTokenDetailed: bindDb(client, clientData.verifySupabaseTokenDetailed),
  };
}

function createDecksApi(
  client: DataClient,
  decksDeps: decksData.DeckDeps,
) {
  return {
    createDeck: bindDbDeps(client, decksDeps, decksData.createDeck),
    createDeckWithCards: bindDbDeps(client, decksDeps, decksData.createDeckWithCards),
    addCardsToExistingDeck: bindDbDeps(client, decksDeps, decksData.addCardsToExistingDeck),
    tryCreateDeckWithCardsRpc: bindDb(client, decksData.tryCreateDeckWithCardsRpc),
    getDeckRow: bindDb(client, decksData.getDeckRow),
    getDeckCardRows: bindDb(client, decksData.getDeckCardRows),
    deleteDeckRowBestEffort: bindDb(client, decksData.deleteDeckRowBestEffort),
    invalidateDeckCaches: bindDb(client, decksData.invalidateDeckCaches),
    getDecks: bindDbDeps(client, decksDeps, decksData.getDecks),
    getSharedDecks: bindDb(client, decksData.getSharedDecks),
    getDeckCollaborators: bindDbDeps(client, decksDeps, decksData.getDeckCollaborators),
    addDeckCollaborator: bindDbDeps(client, decksDeps, decksData.addDeckCollaborator),
    removeDeckCollaborator: bindDbDeps(client, decksDeps, decksData.removeDeckCollaborator),
    getDeck: bindDb(client, decksData.getDeck),
    updateDeck: bindDbDeps(client, decksDeps, decksData.updateDeck),
    deleteDeck: bindDbDeps(client, decksDeps, decksData.deleteDeck),
    exportDeck: bindDbDeps(client, decksDeps, decksData.exportDeck),
    importDeck: bindDb(client, decksData.importDeck),
    replaceDeckCards: bindDb(client, decksData.replaceDeckCards),
    createFlashcard: bindDbDeps(client, decksDeps, decksData.createFlashcard),
  };
}

function createDirectMessagesApi(
  client: DataClient,
  directMessagesDeps: directMessagesData.DirectMessageDeps,
) {
  return {
    getDirectMessages: bindDbDeps(client, directMessagesDeps, directMessagesData.getDirectMessages),
    sendDirectMessage: bindDbDeps(client, directMessagesDeps, directMessagesData.sendDirectMessage),
    blockUser: bindDb(client, directMessagesData.blockUser),
    unblockUser: bindDb(client, directMessagesData.unblockUser),
    listBlockedUserIds: bindDb(client, directMessagesData.listBlockedUserIds),
    isDmBlockedBetween: bindDb(client, directMessagesData.isDmBlockedBetween),
    didUserBlock: bindDb(client, directMessagesData.didUserBlock),
    acceptDmMessageRequest: bindDbDeps(client, directMessagesDeps, directMessagesData.acceptDmMessageRequest),
    declineDmMessageRequest: bindDb(client, directMessagesData.declineDmMessageRequest),
    searchMessages: bindDbDeps(client, directMessagesDeps, directMessagesData.searchMessages),
  };
}

function createGamificationApi(
  client: DataClient,
  gamificationDeps: gamificationData.GamificationDeps,
) {
  return {
    getLeaderboard: bindDb(client, gamificationData.getLeaderboard),
    getAchievements: bindDb(client, gamificationData.getAchievements),
    getUserAchievements: bindDb(client, gamificationData.getUserAchievements),
    awardPoints: bindDb(client, gamificationData.awardPoints),
    awardAchievement: bindDbDeps(client, gamificationDeps, gamificationData.awardAchievement),
    getUserProgress: bindDbDeps(client, gamificationDeps, gamificationData.getUserProgress),
    getGamificationStats: bindDb(client, gamificationData.getGamificationStats),
    getBadges: bindDb(client, gamificationData.getBadges),
    getUserBadges: bindDb(client, gamificationData.getUserBadges),
    awardBadge: bindDbDeps(client, gamificationDeps, gamificationData.awardBadge),
    getLevels: bindDb(client, gamificationData.getLevels),
    getUserLevel: bindDbDeps(client, gamificationDeps, gamificationData.getUserLevel),
    recordStudyActivity: bindDb(client, gamificationData.recordStudyActivity),
    profileToGamificationUser: bindDb(client, gamificationData.profileToGamificationUser),
    incrementUserStatsAndAwardBadges: bindDbDeps(client, gamificationDeps, gamificationData.incrementUserStatsAndAwardBadges),
    recomputeDerivedUserStats: bindDb(client, gamificationData.recomputeDerivedUserStats),
    syncGamificationProgress: bindDbDeps(client, gamificationDeps, gamificationData.syncGamificationProgress),
    syncGamificationProgressWithStats: bindDbDeps(client, gamificationDeps, gamificationData.syncGamificationProgressWithStats),
    applyTestCompletionGamification: bindDbDeps(client, gamificationDeps, gamificationData.applyTestCompletionGamification),
    touchLastSeen: bindDb(client, gamificationData.touchLastSeen),
    getStudyActivity: bindDb(client, gamificationData.getStudyActivity),
    parseStreakReferenceDate: bindDb(client, gamificationData.parseStreakReferenceDate),
    recomputeUserStreak: bindDbDeps(client, gamificationDeps, gamificationData.recomputeUserStreak),
  };
}

function createGroupMessagesApi(
  client: DataClient,
  groupMessagesDeps: groupMessagesData.GroupMessageDeps,
) {
  return {
    getGroupMessages: bindDbDeps(client, groupMessagesDeps, groupMessagesData.getGroupMessages),
    getMessageById: bindDbDeps(client, groupMessagesDeps, groupMessagesData.getMessageById),
    mapChatMutationRow: groupMessagesData.mapChatMutationRow,
    refreshChatPreview: bindDb(client, groupMessagesData.refreshChatPreview),
    invalidateChatMessageMutation: groupMessagesData.invalidateChatMessageMutation,
    refreshChatMessageNotifications: bindDb(client, groupMessagesData.refreshChatMessageNotifications),
    editChatMessage: bindDbDeps(client, groupMessagesDeps, groupMessagesData.editChatMessage),
    removeChatMessage: bindDbDeps(client, groupMessagesDeps, groupMessagesData.removeChatMessage),
    clearPinOnRemovedMessage: bindDb(client, groupMessagesData.clearPinOnRemovedMessage),
    syncQuestionStatusAfterVote: bindDbDeps(client, groupMessagesDeps, groupMessagesData.syncQuestionStatusAfterVote),
    voteQuestion: bindDbDeps(client, groupMessagesDeps, groupMessagesData.voteQuestion),
    removeVote: bindDbDeps(client, groupMessagesDeps, groupMessagesData.removeVote),
    reactionsMissingTable: groupMessagesData.reactionsMissingTable,
    addMessageReaction: bindDbDeps(client, groupMessagesDeps, groupMessagesData.addMessageReaction),
    removeMessageReaction: bindDbDeps(client, groupMessagesDeps, groupMessagesData.removeMessageReaction),
    readMessageReactions: bindDbDeps(client, groupMessagesDeps, groupMessagesData.readMessageReactions),
    countDistinctReactionEmoji: bindDeps(groupMessagesDeps, groupMessagesData.countDistinctReactionEmoji),
    getUserReactionsForGroup: bindDbDeps(client, groupMessagesDeps, groupMessagesData.getUserReactionsForGroup),
    getUserReactionsForThread: bindDbDeps(client, groupMessagesDeps, groupMessagesData.getUserReactionsForThread),
    countPeerUpvotesForMessage: bindDb(client, groupMessagesData.countPeerUpvotesForMessage),
    attachPeerUpvotes: bindDb(client, groupMessagesData.attachPeerUpvotes),
    getUserVotesForGroup: bindDb(client, groupMessagesData.getUserVotesForGroup),
    updateQuestionStatus: bindDb(client, groupMessagesData.updateQuestionStatus),
    updateMessageFlagged: bindDb(client, groupMessagesData.updateMessageFlagged),
    fetchMessages: bindDbDeps(client, groupMessagesDeps, groupMessagesData.fetchMessages),
  };
}

function createGroupsApi(
  client: DataClient,
  groupsDeps: groupsData.GroupDeps,
) {
  return {
    getGroups: bindDbDeps(client, groupsDeps, groupsData.getGroups),
    getGroupById: bindDb(client, groupsData.getGroupById),
    createGroup: bindDbDeps(client, groupsDeps, groupsData.createGroup),
    updateGroup: bindDbDeps(client, groupsDeps, groupsData.updateGroup),
    getGroupByInviteId: bindDb(client, groupsData.getGroupByInviteId),
    addGroupMember: bindDbDeps(client, groupsDeps, groupsData.addGroupMember),
    addGroupMembersBatch: bindDb(client, groupsData.addGroupMembersBatch),
    acceptGroupInvite: bindDb(client, groupsData.acceptGroupInvite),
    declineGroupInvite: bindDb(client, groupsData.declineGroupInvite),
    getPendingGroupInvitesForUser: bindDb(client, groupsData.getPendingGroupInvitesForUser),
    isGroupMember: bindDb(client, groupsData.isGroupMember),
    isDmThreadParticipant: bindDb(client, groupsData.isDmThreadParticipant),
    getAuthorizedDmMessage: bindDbDeps(client, groupsDeps, groupsData.getAuthorizedDmMessage),
    canViewPeerChatAvatar: bindDb(client, groupsData.canViewPeerChatAvatar),
    getAuthorizedGroupMessage: bindDb(client, groupsData.getAuthorizedGroupMessage),
    isGroupAdmin: bindDbDeps(client, groupsDeps, groupsData.isGroupAdmin),
    canNotifyUser: bindDbDeps(client, groupsDeps, groupsData.canNotifyUser),
    removeGroupMember: bindDbDeps(client, groupsDeps, groupsData.removeGroupMember),
    deleteGroup: bindDb(client, groupsData.deleteGroup),
    getGroupMembers: bindDb(client, groupsData.getGroupMembers),
    getGroupStats: bindDb(client, groupsData.getGroupStats),
  };
}

function createMappersApi(mappersDeps: mappersData.MessageRecordDeps) {
  return {
    mapProfileSender: mappersData.mapProfileSender,
    resolveNestedProfile: mappersData.resolveNestedProfile,
    mapChatMessageRow: mappersData.mapChatMessageRow,
    parseMessageContent: mappersData.parseMessageContent,
    normalizeMessageRecord: bindDeps(mappersDeps, mappersData.normalizeMessageRecord),
  };
}

function createMarketplaceApi(
  client: DataClient,
  marketplaceDeps: marketplaceData.MarketplaceDeps,
  ratingColumns: ReturnType<typeof marketplaceData.createRatingColumnCircuitBreaker>,
) {
  return {
    ratingColumnsAvailable: ratingColumns.ratingColumnsAvailable,
    noteRatingColumnsMissing: ratingColumns.noteRatingColumnsMissing,
    normalizeListingRecord: bindDeps(marketplaceDeps, marketplaceData.normalizeListingRecord),
    normalizeListingRecordAsync: bindDeps(marketplaceDeps, marketplaceData.normalizeListingRecordAsync),
    normalizeOfferRecord: bindDeps(marketplaceDeps, marketplaceData.normalizeOfferRecord),
    signSimilarListingCards: bindDeps(marketplaceDeps, marketplaceData.signSimilarListingCards),
    createInquiryNotification: bindDeps(marketplaceDeps, marketplaceData.createInquiryNotification),
    createPurchaseNotification: bindDeps(marketplaceDeps, marketplaceData.createPurchaseNotification),
    marketplaceWriteError: marketplaceData.marketplaceWriteError,
    stripServerOwnedListingFields: marketplaceData.stripServerOwnedListingFields,
    pickServerOwnedListingFields: marketplaceData.pickServerOwnedListingFields,
    sanitizeListingImages: marketplaceData.sanitizeListingImages,
    assertValidListingKind: marketplaceData.assertValidListingKind,
    assertValidBundleItems: marketplaceData.assertValidBundleItems,
    assertValidListingQuantity: marketplaceData.assertValidListingQuantity,
    listingStateError: marketplaceData.listingStateError,
    // Takes only `{ getMarketplaceListingById }`, which the domain's own deps
    // literal already reads through the layer at call time. It used to be
    // handed `layer` — the last read of the facade in this file.
    assertSellerListingUpdateAllowed: bindDeps(
      marketplaceDeps,
      marketplaceData.assertSellerListingUpdateAllowed,
    ),
    getMarketplaceCampuses: bindDb(client, marketplaceData.getMarketplaceCampuses),
    getMarketplaceCampusById: bindDb(client, marketplaceData.getMarketplaceCampusById),
    toListingCardRecords: bindDeps(marketplaceDeps, marketplaceData.toListingCardRecords),
    attachSellerTrust: bindDeps(marketplaceDeps, marketplaceData.attachSellerTrust),
    fetchSellerTrust: bindDb(client, marketplaceData.fetchSellerTrust),
    pickCompactListingFields: marketplaceData.pickCompactListingFields,
    attachListingKinds: bindDb(client, marketplaceData.attachListingKinds),
    isMissingRatingColumn: marketplaceData.isMissingRatingColumn,
    getMarketplaceListings: bindDbDeps(client, marketplaceDeps, marketplaceData.getMarketplaceListings),
    getMarketplaceListingsByIds: bindDbDeps(client, marketplaceDeps, marketplaceData.getMarketplaceListingsByIds),
    getRelatedMarketplaceListings: bindDeps(marketplaceDeps, marketplaceData.getRelatedMarketplaceListings),
    getRelatedMarketplaceListingsInner: bindDeps(marketplaceDeps, marketplaceData.getRelatedMarketplaceListingsInner),
    getMarketplaceCategoryAnalytics: bindDb(client, marketplaceData.getMarketplaceCategoryAnalytics),
    getMarketplaceListingById: bindDbDeps(client, marketplaceDeps, marketplaceData.getMarketplaceListingById),
    getMarketplaceListingForViewer: bindDeps(marketplaceDeps, marketplaceData.getMarketplaceListingForViewer),
    createMarketplaceListing: bindDbDeps(client, marketplaceDeps, marketplaceData.createMarketplaceListing),
    updateMarketplaceListing: bindDbDeps(client, marketplaceDeps, marketplaceData.updateMarketplaceListing),
    deleteMarketplaceListing: bindDb(client, marketplaceData.deleteMarketplaceListing),
    deleteMarketplaceListingSafely: bindDbDeps(client, marketplaceDeps, marketplaceData.deleteMarketplaceListingSafely),
    getSavedSearchMatches: bindDb(client, marketplaceData.getSavedSearchMatches),
    canUserReviewListing: bindDbDeps(client, marketplaceDeps, marketplaceData.canUserReviewListing),
    addMarketplaceReview: bindDbDeps(client, marketplaceDeps, marketplaceData.addMarketplaceReview),
    getMarketplaceReviews: bindDbDeps(client, marketplaceDeps, marketplaceData.getMarketplaceReviews),
    attachMarketplaceReviewSignals: bindDb(client, marketplaceData.attachMarketplaceReviewSignals),
    setMarketplaceReviewVote: bindDb(client, marketplaceData.setMarketplaceReviewVote),
    buyMarketplaceListingNow: bindDeps(marketplaceDeps, marketplaceData.buyMarketplaceListingNow),
    boostMarketplaceListing: bindDbDeps(client, marketplaceDeps, marketplaceData.boostMarketplaceListing),
    reportMarketplaceListing: bindDb(client, marketplaceData.reportMarketplaceListing),
    initiateMarketplaceTransaction: bindDbDeps(client, marketplaceDeps, marketplaceData.initiateMarketplaceTransaction),
    logMarketplaceBudgetTransactions: bindDb(client, marketplaceData.logMarketplaceBudgetTransactions),
    maybeLogManualSoldBudget: bindDbDeps(client, marketplaceDeps, marketplaceData.maybeLogManualSoldBudget),
    finalizeOfferAcceptSale: bindDeps(marketplaceDeps, marketplaceData.finalizeOfferAcceptSale),
    normalizeInquiryRecord: bindDeps(marketplaceDeps, marketplaceData.normalizeInquiryRecord),
    normalizeFavoriteRecord: bindDeps(marketplaceDeps, marketplaceData.normalizeFavoriteRecord),
    getListingsBySeller: bindDbDeps(client, marketplaceDeps, marketplaceData.getListingsBySeller),
    updateListingStatus: bindDbDeps(client, marketplaceDeps, marketplaceData.updateListingStatus),
    incrementListingViews: bindDb(client, marketplaceData.incrementListingViews),
    getSellerStats: bindDb(client, marketplaceData.getSellerStats),
    addFavorite: bindDb(client, marketplaceData.addFavorite),
    removeFavorite: bindDb(client, marketplaceData.removeFavorite),
    getUserFavorites: bindDbDeps(client, marketplaceDeps, marketplaceData.getUserFavorites),
    isListingFavorited: bindDb(client, marketplaceData.isListingFavorited),
    createInquiry: bindDbDeps(client, marketplaceDeps, marketplaceData.createInquiry),
    getInquiryByListingAndBuyer: bindDbDeps(client, marketplaceDeps, marketplaceData.getInquiryByListingAndBuyer),
    stripInquiryListingModeration: marketplaceData.stripInquiryListingModeration,
    getSellerInquiries: bindDbDeps(client, marketplaceDeps, marketplaceData.getSellerInquiries),
    getBuyerInquiries: bindDbDeps(client, marketplaceDeps, marketplaceData.getBuyerInquiries),
    updateInquiryStatus: bindDb(client, marketplaceData.updateInquiryStatus),
    getInquiryByThread: bindDbDeps(client, marketplaceDeps, marketplaceData.getInquiryByThread),
  };
}

function createNotesApi(
  client: DataClient,
  notesDeps: notesData.NotesDeps,
) {
  return {
    mapNote: notesData.mapNote,
    resolveNoteAccess: bindDb(client, notesData.resolveNoteAccess),
    isNoteOwner: bindDb(client, notesData.isNoteOwner),
    getNoteOwnerPresentation: bindDb(client, notesData.getNoteOwnerPresentation),
    mapNoteFolder: notesData.mapNoteFolder,
    getNoteFolders: bindDbDeps(client, notesDeps, notesData.getNoteFolders),
    createNoteFolder: bindDbDeps(client, notesDeps, notesData.createNoteFolder),
    updateNoteFolder: bindDbDeps(client, notesDeps, notesData.updateNoteFolder),
    deleteNoteFolder: bindDb(client, notesData.deleteNoteFolder),
    getNotes: bindDbDeps(client, notesDeps, notesData.getNotes),
    attachNoteSearchText: bindDb(client, notesData.attachNoteSearchText),
    getNote: bindDbDeps(client, notesDeps, notesData.getNote),
    createNote: bindDbDeps(client, notesDeps, notesData.createNote),
    canEditNote: bindDeps(notesDeps, notesData.canEditNote),
    updateNote: bindDbDeps(client, notesDeps, notesData.updateNote),
    deleteNote: bindDb(client, notesData.deleteNote),
    getNoteAttachment: bindDb(client, notesData.getNoteAttachment),
    updateNoteAttachment: bindDb(client, notesData.updateNoteAttachment),
    uploadNoteFile: bindDb(client, notesData.uploadNoteFile),
    createSignedNoteFileUploadUrl: bindDbDeps(client, notesDeps, notesData.createSignedNoteFileUploadUrl),
    createSignedNoteFileUrl: bindDeps(notesDeps, notesData.createSignedNoteFileUrl),
    deleteNoteFile: bindDb(client, notesData.deleteNoteFile),
    downloadNoteFile: bindDb(client, notesData.downloadNoteFile),
    resolveNoteAttachmentStoragePath: notesData.resolveNoteAttachmentStoragePath,
    getNoteAttachments: bindDb(client, notesData.getNoteAttachments),
    addNoteAttachment: bindDb(client, notesData.addNoteAttachment),
    getNoteCollaborators: bindDb(client, notesData.getNoteCollaborators),
    addNoteCollaborator: bindDbDeps(client, notesDeps, notesData.addNoteCollaborator),
    removeNoteCollaborator: bindDbDeps(client, notesDeps, notesData.removeNoteCollaborator),
    updateNoteCollaboratorRole: bindDbDeps(client, notesDeps, notesData.updateNoteCollaboratorRole),
    leaveNoteCollaboration: bindDbDeps(client, notesDeps, notesData.leaveNoteCollaboration),
    createNoteShareLink: bindDbDeps(client, notesDeps, notesData.createNoteShareLink),
    listNoteShareLinks: bindDbDeps(client, notesDeps, notesData.listNoteShareLinks),
    revokeNoteShareLink: bindDbDeps(client, notesDeps, notesData.revokeNoteShareLink),
    previewNoteShareLink: bindDbDeps(client, notesDeps, notesData.previewNoteShareLink),
    acceptNoteShareLink: bindDbDeps(client, notesDeps, notesData.acceptNoteShareLink),
    copyNoteForUser: bindDeps(notesDeps, notesData.copyNoteForUser),
    getNoteComments: bindDb(client, notesData.getNoteComments),
    addNoteComment: bindDb(client, notesData.addNoteComment),
    shareNoteWithGroup: bindDeps(notesDeps, notesData.shareNoteWithGroup),
    mapNoteQuiz: notesData.mapNoteQuiz,
    getNoteQuiz: bindDbDeps(client, notesDeps, notesData.getNoteQuiz),
    isNoteQuizProtected: notesData.isNoteQuizProtected,
    upsertNoteQuiz: bindDbDeps(client, notesDeps, notesData.upsertNoteQuiz),
    updateNoteQuiz: bindDbDeps(client, notesDeps, notesData.updateNoteQuiz),
  };
}

function createNotificationsApi(
  client: DataClient,
  notificationsDeps: notificationsData.CreateNotificationDeps,
) {
  return {
    getUserNotifications: bindDb(client, notificationsData.getUserNotifications),
    getNotificationById: bindDb(client, notificationsData.getNotificationById),
    createNotification: (
      userId: Parameters<typeof notificationsData.createNotification>[1],
      notificationData: Parameters<typeof notificationsData.createNotification>[2],
    ) =>
      notificationsData.createNotification(
        client,
        userId,
        notificationData,
        notificationsDeps,
      ),
    markNotificationAsRead: bindDb(client, notificationsData.markNotificationAsRead),
    markAllNotificationsAsRead: bindDb(client, notificationsData.markAllNotificationsAsRead),
    deleteNotification: bindDb(client, notificationsData.deleteNotification),
    deleteAllNotifications: bindDb(client, notificationsData.deleteAllNotifications),
    getNotificationStats: bindDb(client, notificationsData.getNotificationStats),
    createBulkNotifications: bindDb(client, notificationsData.createBulkNotifications),
  };
}

function createOfflineBundlesApi(
  client: DataClient,
  offlineBundlesDeps: offlineBundlesData.FlashcardDeps,
) {
  return {
    getOfflineBundles: bindDb(client, offlineBundlesData.getOfflineBundles),
    saveOfflineBundle: bindDb(client, offlineBundlesData.saveOfflineBundle),
    deleteOfflineBundle: bindDb(client, offlineBundlesData.deleteOfflineBundle),
    getAccessibleDeckIds: bindDb(client, offlineBundlesData.getAccessibleDeckIds),
    fetchDeckRecord: bindDb(client, offlineBundlesData.fetchDeckRecord),
    verifyDeckAccess: bindDbDeps(client, offlineBundlesDeps, offlineBundlesData.verifyDeckAccess),
    getDeckForUser: bindDbDeps(client, offlineBundlesDeps, offlineBundlesData.getDeckForUser),
    getFlashcardForUser: bindDbDeps(client, offlineBundlesDeps, offlineBundlesData.getFlashcardForUser),
    getFlashcards: bindDbDeps(client, offlineBundlesDeps, offlineBundlesData.getFlashcards),
    getFlashcard: bindDb(client, offlineBundlesData.getFlashcard),
    getFlashcardComments: bindDb(client, offlineBundlesData.getFlashcardComments),
    addFlashcardComment: bindDb(client, offlineBundlesData.addFlashcardComment),
    reviewFlashcard: bindDbDeps(client, offlineBundlesDeps, offlineBundlesData.reviewFlashcard),
    updateFlashcard: bindDbDeps(client, offlineBundlesDeps, offlineBundlesData.updateFlashcard),
    deleteFlashcard: bindDbDeps(client, offlineBundlesDeps, offlineBundlesData.deleteFlashcard),
    attachQuestionStatStems: bindDb(client, offlineBundlesData.attachQuestionStatStems),
    getUserQuestionStats: bindDbDeps(client, offlineBundlesDeps, offlineBundlesData.getUserQuestionStats),
    updateUserQuestionStats: bindDb(client, offlineBundlesData.updateUserQuestionStats),
    getUserQuestionStat: bindDb(client, offlineBundlesData.getUserQuestionStat),
    upsertUserQuestionStat: bindDb(client, offlineBundlesData.upsertUserQuestionStat),
    resetDeckStatistics: bindDbDeps(client, offlineBundlesDeps, offlineBundlesData.resetDeckStatistics),
  };
}

function createReadStateApi(
  client: DataClient,
  readStateDeps: readStateData.ReadStateDeps,
) {
  return {
    getGroupUnreadCount: bindDb(client, readStateData.getGroupUnreadCount),
    getAllGroupUnreadCounts: bindDbDeps(client, readStateDeps, readStateData.getAllGroupUnreadCounts),
    getAllGroupUnreadCountsFallback: bindDb(client, readStateData.getAllGroupUnreadCountsFallback),
    markGroupAsRead: bindDbDeps(client, readStateDeps, readStateData.markGroupAsRead),
    getDMUnreadCount: bindDb(client, readStateData.getDMUnreadCount),
    getAllDMUnreadCounts: bindDbDeps(client, readStateDeps, readStateData.getAllDMUnreadCounts),
    getAllDMUnreadCountsFallback: bindDbDeps(client, readStateDeps, readStateData.getAllDMUnreadCountsFallback),
    markDMAsRead: bindDbDeps(client, readStateDeps, readStateData.markDMAsRead),
    deleteDmThread: bindDb(client, readStateData.deleteDmThread),
    archiveDmThread: bindDb(client, readStateData.archiveDmThread),
    unarchiveDmThread: bindDb(client, readStateData.unarchiveDmThread),
    isChatMuted: bindDb(client, readStateData.isChatMuted),
    getChatMute: bindDb(client, readStateData.getChatMute),
    assertChatMuteAccess: bindDb(client, readStateData.assertChatMuteAccess),
    setChatMute: bindDbDeps(client, readStateDeps, readStateData.setChatMute),
    clearChatMute: bindDbDeps(client, readStateDeps, readStateData.clearChatMute),
  };
}

function createStorageAclApi(
  client: DataClient,
  supabaseUrl: string,
  storageAclDeps: storageAclData.StorageAclDeps,
) {
  return {
    normalizeStorageUrl: bindUrl(supabaseUrl, storageAclData.normalizeStorageUrl),
    resolveStorageReference: bindUrl(supabaseUrl, storageAclData.resolveStorageReference),
    createSignedStorageUrl: bindDbUrl(client, supabaseUrl, storageAclData.createSignedStorageUrl),
    createSignedStorageUrlWithVariant: bindDbUrl(client, supabaseUrl, storageAclData.createSignedStorageUrlWithVariant),
    signStorageDisplayUrls: bindDbUrl(client, supabaseUrl, storageAclData.signStorageDisplayUrls),
    signStorageDisplayUrl: bindDbUrl(client, supabaseUrl, storageAclData.signStorageDisplayUrl),
    canAccessStorageObject: bindDbDeps(client, storageAclDeps, storageAclData.canAccessStorageObject),
    escapeIlikePattern: storageAclData.escapeIlikePattern,
    storageUrlMatchesObject: storageAclData.storageUrlMatchesObject,
    canAccessFlashcardImage: bindDbDeps(client, storageAclDeps, storageAclData.canAccessFlashcardImage),
    canAccessQuestionImage: bindDbDeps(client, storageAclDeps, storageAclData.canAccessQuestionImage),
  };
}

function createTestsApi(
  client: DataClient,
  testsDeps: testsData.TestDeps,
) {
  return {
    generateTestQuestions: testsData.generateTestQuestions,
    calculateTestScore: testsData.calculateTestScore,
    getUserTests: bindDbDeps(client, testsDeps, testsData.getUserTests),
    getTestById: bindDb(client, testsData.getTestById),
    resolveTestSessionForCaller: bindDbDeps(client, testsDeps, testsData.resolveTestSessionForCaller),
    createTest: bindDbDeps(client, testsDeps, testsData.createTest),
    createPersonalTest: bindDbDeps(client, testsDeps, testsData.createPersonalTest),
    mapTestSessionRowToClient: bindDb(client, testsData.mapTestSessionRowToClient),
    fetchNoteTitles: bindDb(client, testsData.fetchNoteTitles),
    fetchDeckTitles: bindDb(client, testsData.fetchDeckTitles),
    resolvePersonalTestSourceTitle: bindDbDeps(client, testsDeps, testsData.resolvePersonalTestSourceTitle),
    attachSourceNoteTitles: bindDbDeps(client, testsDeps, testsData.attachSourceNoteTitles),
    createTestDraft: bindDbDeps(client, testsDeps, testsData.createTestDraft),
    updateTestDraft: bindDbDeps(client, testsDeps, testsData.updateTestDraft),
    completeTestDraft: bindDbDeps(client, testsDeps, testsData.completeTestDraft),
    abandonTestDraft: bindDb(client, testsData.abandonTestDraft),
    startTest: bindDbDeps(client, testsDeps, testsData.startTest),
    submitTest: bindDbDeps(client, testsDeps, testsData.submitTest),
    createTestResult: bindDbDeps(client, testsDeps, testsData.createTestResult),
    getTestResults: bindDbDeps(client, testsDeps, testsData.getTestResults),
    getTestQuestions: bindDbDeps(client, testsDeps, testsData.getTestQuestions),
    deleteTest: bindDb(client, testsData.deleteTest),
    deleteCompletedTestSession: bindDbDeps(client, testsDeps, testsData.deleteCompletedTestSession),
    clearCompletedTestHistory: bindDb(client, testsData.clearCompletedTestHistory),
    getSubjectStats: bindDb(client, testsData.getSubjectStats),
    getPerformanceStats: bindDb(client, testsData.getPerformanceStats),
    getTestTemplates: bindDb(client, testsData.getTestTemplates),
    fetchTestResults: bindDb(client, testsData.fetchTestResults),
    updateUserStats: bindDb(client, testsData.updateUserStats),
  };
}

function createUploadsApi(
  client: DataClient,
  signUrlDeps: uploadsData.SignUrlDeps,
  chatUploadDeps: uploadsData.ChatUploadDeps,
) {
  return {
    uploadSiblingThumb: bindDb(client, uploadsData.uploadSiblingThumb),
    uploadFlashcardImage: bindDbDeps(client, signUrlDeps, uploadsData.uploadFlashcardImage),
    assertCoverColumn: bindDb(client, uploadsData.assertCoverColumn),
    uploadCoverImage: bindDbDeps(client, signUrlDeps, uploadsData.uploadCoverImage),
    deleteCoverObject: bindDb(client, uploadsData.deleteCoverObject),
    setDeckCoverPath: bindDb(client, uploadsData.setDeckCoverPath),
    setNoteCoverPath: bindDb(client, uploadsData.setNoteCoverPath),
    setStudySetCoverPath: bindDb(client, uploadsData.setStudySetCoverPath),
    uploadMarketplaceImage: bindDbDeps(client, signUrlDeps, uploadsData.uploadMarketplaceImage),
    uploadChatImage: bindDbDeps(client, chatUploadDeps, uploadsData.uploadChatImage),
    uploadChatAudio: bindDbDeps(client, chatUploadDeps, uploadsData.uploadChatAudio),
    uploadQuestionImage: bindDbDeps(client, signUrlDeps, uploadsData.uploadQuestionImage),
    uploadProfileAvatar: bindDbDeps(client, signUrlDeps, uploadsData.uploadProfileAvatar),
    uploadGroupAvatar: bindDbDeps(client, signUrlDeps, uploadsData.uploadGroupAvatar),
  };
}

function createUsersApi(
  client: DataClient,
  deleteAccountDeps: usersData.DeleteAccountDeps,
  exportAccountDeps: usersData.ExportAccountDeps,
) {
  return {
    fetchUserProfile: bindDb(client, usersData.fetchUserProfile),
    updateUserProfile: bindDb(client, usersData.updateUserProfile),
    updateExpoPushToken: bindDb(client, usersData.updateExpoPushToken),
    clearExpoPushToken: bindDb(client, usersData.clearExpoPushToken),
    sendExpoPushForNotification: bindDb(client, usersData.sendExpoPushForNotification),
    createUserProfile: bindDb(client, usersData.createUserProfile),
    getUsers: bindDb(client, usersData.getUsers),
    getUserById: bindDb(client, usersData.getUserById),
    isProfileVisibleToViewer: bindDb(client, usersData.isProfileVisibleToViewer),
    getUserByEmail: bindDb(client, usersData.getUserByEmail),
    resolveCollaboratorUserId: bindDb(client, usersData.resolveCollaboratorUserId),
    createUser: bindDb(client, usersData.createUser),
    invalidateProfilePresentationCaches: bindDb(client, usersData.invalidateProfilePresentationCaches),
    updateUser: bindDb(client, usersData.updateUser),
    deleteUser: (userId: string) => usersData.deleteUser(deleteAccountDeps, userId),
    exportUserData: bindDbDeps(client, exportAccountDeps, usersData.exportUserData),
    deleteUserProfileOnly: bindDb(client, usersData.deleteUserProfileOnly),
    getUserStats: bindDb(client, usersData.getUserStats),
    getUserGroups: bindDb(client, usersData.getUserGroups),
  };
}

/**
 * The shape route families are injected with. Each namespace is derived from
 * its factory rather than transcribed, so a signature change in a data module
 * is a compile error at the call site instead of a lie in a hand-written type.
 */
export type DataLayer = {
  getClient: () => DataClient;
  academic: AcademicApi;
  adminAnalytics: AdminAnalyticsApi;
  boardActions: BoardActionsApi;
  categories: CategoriesApi;
  chatSend: ChatSendApi;
  client: ClientApi;
  decks: DecksApi;
  directMessages: DirectMessagesApi;
  gamification: GamificationApi;
  groupMessages: GroupMessagesApi;
  groups: GroupsApi;
  mappers: MappersApi;
  marketplace: MarketplaceApi;
  notes: NotesApi;
  notifications: NotificationsApi;
  offlineBundles: OfflineBundlesApi;
  readState: ReadStateApi;
  storageAcl: StorageAclApi;
  tests: TestsApi;
  uploads: UploadsApi;
  users: UsersApi;
};

export type AcademicApi = ReturnType<typeof createAcademicApi>;
export type AdminAnalyticsApi = ReturnType<typeof createAdminAnalyticsApi>;
export type BoardActionsApi = ReturnType<typeof createBoardActionsApi>;
export type CategoriesApi = ReturnType<typeof createCategoriesApi>;
export type ChatSendApi = ReturnType<typeof createChatSendApi>;
export type ClientApi = ReturnType<typeof createClientApi>;
export type DecksApi = ReturnType<typeof createDecksApi>;
export type DirectMessagesApi = ReturnType<typeof createDirectMessagesApi>;
export type GamificationApi = ReturnType<typeof createGamificationApi>;
export type GroupMessagesApi = ReturnType<typeof createGroupMessagesApi>;
export type GroupsApi = ReturnType<typeof createGroupsApi>;
export type MappersApi = ReturnType<typeof createMappersApi>;
export type MarketplaceApi = ReturnType<typeof createMarketplaceApi>;
export type NotesApi = ReturnType<typeof createNotesApi>;
export type NotificationsApi = ReturnType<typeof createNotificationsApi>;
export type OfflineBundlesApi = ReturnType<typeof createOfflineBundlesApi>;
export type ReadStateApi = ReturnType<typeof createReadStateApi>;
export type StorageAclApi = ReturnType<typeof createStorageAclApi>;
export type TestsApi = ReturnType<typeof createTestsApi>;
export type UploadsApi = ReturnType<typeof createUploadsApi>;
export type UsersApi = ReturnType<typeof createUsersApi>;

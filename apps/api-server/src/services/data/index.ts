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
 * ~60 route suites that inject a bare stand-in keep working with nothing but a
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
 * ## What it touches
 *
 * Nothing directly: it owns no query, no table and no bucket. It holds the one
 * service-role client (which BYPASSES RLS — every predicate in the modules
 * below is the access control) and the `supabaseUrl` the storage ACL needs to
 * sign an object.
 *
 * ## The gotcha: `host`, and why it exists
 *
 * Three deps cannot be built from the data layer alone, because their callees
 * take the whole `SupabaseService`:
 *
 *   - `incrementUserStatsAndAwardBadges` — `data/gamification.ts` is handed
 *     `service: this` by the facade;
 *   - `deleteUserAccountFully` / `exportUserDataArchive` —
 *     `services/userDataLifecycle.ts` takes the service, and the facade keeps
 *     the lazy `await import()` at its own call site.
 *
 * They arrive as `DataLayerHost`, built in `server.ts` from the facade. This
 * is a TRANSITIONAL seam, not an architecture: it shrinks as later lanes bind
 * more domains and flip those two callees, and when it is empty the facade can
 * be deleted. Do not add to it without saying in the PR how it comes back out.
 *
 * ## Growth
 *
 * Domains are bound as lanes need them, and a domain is bound COMPLETELY —
 * every exported function of its module — so the next lane adds callers, not
 * wiring. Bound so far: groups, users, notifications, uploads, readState
 * (the five `routes/groups.ts` uses).
 */
import { initialUserStats } from "@lantern/shared/utils/testHelpers";

import type { DataClient } from "./client";
import * as chatSendData from "./chatSend";
import * as groupsData from "./groups";
import * as notificationsData from "./notifications";
import * as readStateData from "./readState";
import * as storageAclData from "./storageAcl";
import * as uploadsData from "./uploads";
import * as usersData from "./users";

/** Same alias the monolith uses: the shape of `profiles.stats`. */
type UserStats = typeof initialUserStats;

/**
 * The few things still reachable only through `SupabaseService`. Built in
 * `server.ts`; see the gotcha above.
 */
export type DataLayerHost = {
  /**
   * The `SupabaseService` instance itself, for the SERVICES a flipped route
   * still has to hand it to — `getCommunitiesService(svc)`,
   * `getActivityFeedService(svc)` and friends, which this lane does not touch.
   * Typed `unknown` so this module never imports the facade; the call site
   * casts it back with a TYPE-ONLY import, which is erased at compile time.
   * It disappears when the `services/` importers are flipped.
   */
  legacyService: unknown;
  incrementUserStatsAndAwardBadges: (
    userId: string,
    increments: Partial<UserStats>,
  ) => Promise<unknown>;
  deleteUserAccountFully: (userId: string) => Promise<{ found: boolean }>;
  exportUserDataArchive: (userId: string) => Promise<Record<string, unknown>>;
};

export type CreateDataLayerOptions = {
  client: DataClient;
  /** Needed by the storage ACL to sign an object; `DatabaseConfig.url`. */
  supabaseUrl: string;
  host: DataLayerHost;
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

/**
 * `SupabaseService.getResponseProfile`, the one private helper `data/groups.ts`
 * needs. Three lines of pure coercion, so it is inlined here rather than
 * routed back through the facade.
 */
const getResponseProfile = (profile?: string): "compact" | "full" =>
  profile === "compact" ? "compact" : "full";

export function createDataLayer(options: CreateDataLayerOptions) {
  const { client, supabaseUrl, host } = options;

  // Declared first so every `deps` arrow below can read through it at CALL
  // time. Namespaces are assigned immediately after; nothing invokes a dep
  // during construction.
  const layer = {} as DataLayer;

  // --- deps literals, one per domain ---------------------------------------

  const groupDeps: groupsData.GroupDeps = {
    getGroupById: (id, uid) => layer.groups.getGroupById(id, uid),
    isGroupMember: (id, uid) => layer.groups.isGroupMember(id, uid),
    isDmThreadParticipant: (tid, uid) =>
      layer.groups.isDmThreadParticipant(tid, uid),
    acceptGroupInvite: (id, uid) => layer.groups.acceptGroupInvite(id, uid),
    getResponseProfile: (profile) => getResponseProfile(profile),
    incrementUserStatsAndAwardBadges: (uid, increments) =>
      host.incrementUserStatsAndAwardBadges(uid, increments),
  };

  const readStateDeps: readStateData.ReadStateDeps = {
    getAllGroupUnreadCountsFallback: (uid) =>
      layer.readState.getAllGroupUnreadCountsFallback(uid),
    getAllDMUnreadCountsFallback: (uid) =>
      layer.readState.getAllDMUnreadCountsFallback(uid),
    getDMUnreadCount: (tid, uid) => layer.readState.getDMUnreadCount(tid, uid),
    assertChatMuteAccess: (uid, scopeType, scopeId) =>
      layer.readState.assertChatMuteAccess(uid, scopeType, scopeId),
    // `broadcastChatRead` is `private` on the facade, but it delegates to a
    // plain export that needs only the client, so the layer calls it directly.
    broadcastChatRead: (chatId, payload) =>
      chatSendData.broadcastChatRead(client, chatId, payload),
  };

  const notificationDeps: notificationsData.CreateNotificationDeps = {
    isChatMuted: (uid, scopeType, scopeId) =>
      layer.readState.isChatMuted(uid, scopeType, scopeId),
    sendExpoPushForNotification: (uid, notification) =>
      layer.users.sendExpoPushForNotification(uid, notification),
  };

  const signUrlDeps: uploadsData.SignUrlDeps = {
    createSignedStorageUrl: (bucket, path, ttl) =>
      storageAclData.createSignedStorageUrl(
        client,
        supabaseUrl,
        bucket,
        path,
        ttl,
      ),
    createSignedStorageUrlWithVariant: (bucket, path, ttl, variant) =>
      storageAclData.createSignedStorageUrlWithVariant(
        client,
        supabaseUrl,
        bucket,
        path,
        ttl,
        variant,
      ),
  };

  const chatUploadDeps: uploadsData.ChatUploadDeps = {
    ...signUrlDeps,
    isGroupMember: (id, uid) => layer.groups.isGroupMember(id, uid),
    isDmThreadParticipant: (tid, uid) =>
      layer.groups.isDmThreadParticipant(tid, uid),
  };

  const deleteAccountDeps: usersData.DeleteAccountDeps = {
    deleteUserAccountFully: (uid) => host.deleteUserAccountFully(uid),
  };

  const exportAccountDeps: usersData.ExportAccountDeps = {
    exportUserDataArchive: (uid) => host.exportUserDataArchive(uid),
  };

  // --- namespaces -----------------------------------------------------------

  layer.getClient = () => client;
  layer.legacyService = host.legacyService;
  layer.groups = createGroupsApi(client, groupDeps);
  layer.users = createUsersApi(client, deleteAccountDeps, exportAccountDeps);
  layer.notifications = createNotificationsApi(client, notificationDeps);
  layer.uploads = createUploadsApi(client, signUrlDeps, chatUploadDeps);
  layer.readState = createReadStateApi(client, readStateDeps);

  return layer;
}

function createGroupsApi(client: DataClient, groupDeps: groupsData.GroupDeps) {
  return {
    getGroups: bindDbDeps(client, groupDeps, groupsData.getGroups),
    getGroupById: bindDb(client, groupsData.getGroupById),
    createGroup: bindDbDeps(client, groupDeps, groupsData.createGroup),
    updateGroup: bindDbDeps(client, groupDeps, groupsData.updateGroup),
    getGroupByInviteId: bindDb(client, groupsData.getGroupByInviteId),
    addGroupMember: bindDbDeps(client, groupDeps, groupsData.addGroupMember),
    addGroupMembersBatch: bindDb(client, groupsData.addGroupMembersBatch),
    acceptGroupInvite: bindDb(client, groupsData.acceptGroupInvite),
    declineGroupInvite: bindDb(client, groupsData.declineGroupInvite),
    getPendingGroupInvitesForUser: bindDb(
      client,
      groupsData.getPendingGroupInvitesForUser,
    ),
    isGroupMember: bindDb(client, groupsData.isGroupMember),
    isDmThreadParticipant: bindDb(client, groupsData.isDmThreadParticipant),
    getAuthorizedDmMessage: bindDbDeps(
      client,
      groupDeps,
      groupsData.getAuthorizedDmMessage,
    ),
    canViewPeerChatAvatar: bindDb(client, groupsData.canViewPeerChatAvatar),
    getAuthorizedGroupMessage: bindDb(
      client,
      groupsData.getAuthorizedGroupMessage,
    ),
    isGroupAdmin: bindDbDeps(client, groupDeps, groupsData.isGroupAdmin),
    canNotifyUser: bindDbDeps(client, groupDeps, groupsData.canNotifyUser),
    removeGroupMember: bindDbDeps(
      client,
      groupDeps,
      groupsData.removeGroupMember,
    ),
    deleteGroup: bindDb(client, groupsData.deleteGroup),
    getGroupMembers: bindDb(client, groupsData.getGroupMembers),
    getGroupStats: bindDb(client, groupsData.getGroupStats),
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
    sendExpoPushForNotification: bindDb(
      client,
      usersData.sendExpoPushForNotification,
    ),
    createUserProfile: bindDb(client, usersData.createUserProfile),
    getUsers: bindDb(client, usersData.getUsers),
    getUserById: bindDb(client, usersData.getUserById),
    isProfileVisibleToViewer: bindDb(client, usersData.isProfileVisibleToViewer),
    getUserByEmail: bindDb(client, usersData.getUserByEmail),
    resolveCollaboratorUserId: bindDb(
      client,
      usersData.resolveCollaboratorUserId,
    ),
    createUser: bindDb(client, usersData.createUser),
    invalidateProfilePresentationCaches: bindDb(
      client,
      usersData.invalidateProfilePresentationCaches,
    ),
    updateUser: bindDb(client, usersData.updateUser),
    // The only data function that takes no client.
    deleteUser: (userId: string) =>
      usersData.deleteUser(deleteAccountDeps, userId),
    exportUserData: bindDbDeps(
      client,
      exportAccountDeps,
      usersData.exportUserData,
    ),
    deleteUserProfileOnly: bindDb(client, usersData.deleteUserProfileOnly),
    getUserStats: bindDb(client, usersData.getUserStats),
    getUserGroups: bindDb(client, usersData.getUserGroups),
  };

}

function createNotificationsApi(
  client: DataClient,
  notificationDeps: notificationsData.CreateNotificationDeps,
) {
  return {
    getUserNotifications: bindDb(client, notificationsData.getUserNotifications),
    getNotificationById: bindDb(client, notificationsData.getNotificationById),
    // `deps` is this one's LAST parameter, not its second.
    createNotification: (
      userId: Parameters<typeof notificationsData.createNotification>[1],
      notificationData: Parameters<
        typeof notificationsData.createNotification
      >[2],
    ) =>
      notificationsData.createNotification(
        client,
        userId,
        notificationData,
        notificationDeps,
      ),
    markNotificationAsRead: bindDb(
      client,
      notificationsData.markNotificationAsRead,
    ),
    markAllNotificationsAsRead: bindDb(
      client,
      notificationsData.markAllNotificationsAsRead,
    ),
    deleteNotification: bindDb(client, notificationsData.deleteNotification),
    deleteAllNotifications: bindDb(
      client,
      notificationsData.deleteAllNotifications,
    ),
    getNotificationStats: bindDb(client, notificationsData.getNotificationStats),
    createBulkNotifications: bindDb(
      client,
      notificationsData.createBulkNotifications,
    ),
  };

}

function createUploadsApi(
  client: DataClient,
  signUrlDeps: uploadsData.SignUrlDeps,
  chatUploadDeps: uploadsData.ChatUploadDeps,
) {
  return {
    uploadSiblingThumb: bindDb(client, uploadsData.uploadSiblingThumb),
    uploadFlashcardImage: bindDbDeps(
      client,
      signUrlDeps,
      uploadsData.uploadFlashcardImage,
    ),
    assertCoverColumn: bindDb(client, uploadsData.assertCoverColumn),
    uploadCoverImage: bindDbDeps(
      client,
      signUrlDeps,
      uploadsData.uploadCoverImage,
    ),
    deleteCoverObject: bindDb(client, uploadsData.deleteCoverObject),
    setDeckCoverPath: bindDb(client, uploadsData.setDeckCoverPath),
    setNoteCoverPath: bindDb(client, uploadsData.setNoteCoverPath),
    setStudySetCoverPath: bindDb(client, uploadsData.setStudySetCoverPath),
    uploadMarketplaceImage: bindDbDeps(
      client,
      signUrlDeps,
      uploadsData.uploadMarketplaceImage,
    ),
    uploadChatImage: bindDbDeps(
      client,
      chatUploadDeps,
      uploadsData.uploadChatImage,
    ),
    uploadChatAudio: bindDbDeps(
      client,
      chatUploadDeps,
      uploadsData.uploadChatAudio,
    ),
    uploadQuestionImage: bindDbDeps(
      client,
      signUrlDeps,
      uploadsData.uploadQuestionImage,
    ),
    uploadProfileAvatar: bindDbDeps(
      client,
      signUrlDeps,
      uploadsData.uploadProfileAvatar,
    ),
    uploadGroupAvatar: bindDbDeps(
      client,
      signUrlDeps,
      uploadsData.uploadGroupAvatar,
    ),
  };

}

function createReadStateApi(
  client: DataClient,
  readStateDeps: readStateData.ReadStateDeps,
) {
  return {
    getGroupUnreadCount: bindDb(client, readStateData.getGroupUnreadCount),
    getAllGroupUnreadCounts: bindDbDeps(
      client,
      readStateDeps,
      readStateData.getAllGroupUnreadCounts,
    ),
    getAllGroupUnreadCountsFallback: bindDb(
      client,
      readStateData.getAllGroupUnreadCountsFallback,
    ),
    markGroupAsRead: bindDbDeps(
      client,
      readStateDeps,
      readStateData.markGroupAsRead,
    ),
    getDMUnreadCount: bindDb(client, readStateData.getDMUnreadCount),
    getAllDMUnreadCounts: bindDbDeps(
      client,
      readStateDeps,
      readStateData.getAllDMUnreadCounts,
    ),
    getAllDMUnreadCountsFallback: bindDbDeps(
      client,
      readStateDeps,
      readStateData.getAllDMUnreadCountsFallback,
    ),
    markDMAsRead: bindDbDeps(client, readStateDeps, readStateData.markDMAsRead),
    deleteDmThread: bindDb(client, readStateData.deleteDmThread),
    archiveDmThread: bindDb(client, readStateData.archiveDmThread),
    unarchiveDmThread: bindDb(client, readStateData.unarchiveDmThread),
    isChatMuted: bindDb(client, readStateData.isChatMuted),
    getChatMute: bindDb(client, readStateData.getChatMute),
    assertChatMuteAccess: bindDb(client, readStateData.assertChatMuteAccess),
    setChatMute: bindDbDeps(client, readStateDeps, readStateData.setChatMute),
    clearChatMute: bindDbDeps(
      client,
      readStateDeps,
      readStateData.clearChatMute,
    ),
  };
}

/**
 * The shape route families are injected with. Derived from the namespaces
 * above rather than transcribed, so a signature change in a data module is a
 * compile error at the call site instead of a lie in a hand-written type.
 */
export type DataLayer = {
  getClient: () => DataClient;
  /** See `DataLayerHost.legacyService`. Transitional; do not add callers. */
  legacyService: unknown;
  groups: GroupsApi;
  users: UsersApi;
  notifications: NotificationsApi;
  uploads: UploadsApi;
  readState: ReadStateApi;
};

export type GroupsApi = ReturnType<typeof createGroupsApi>;
export type UsersApi = ReturnType<typeof createUsersApi>;
export type NotificationsApi = ReturnType<typeof createNotificationsApi>;
export type UploadsApi = ReturnType<typeof createUploadsApi>;
export type ReadStateApi = ReturnType<typeof createReadStateApi>;

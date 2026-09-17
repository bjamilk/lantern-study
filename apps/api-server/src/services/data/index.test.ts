/**
 * The composition root's WIRING, which is the only thing in `data/index.ts`
 * that can be wrong: every function it hands out is somebody else's body.
 *
 * Three properties are pinned, because each one is a silent behaviour change
 * if it breaks and no route test would catch it:
 *
 *  1. the client is bound as the FIRST argument and the caller's own arguments
 *     follow unchanged;
 *  2. `deps` lands in the position that function declares — second for almost
 *     everything, LAST for `createNotification`;
 *  3. a cross-function dep reads through the layer AT CALL TIME, so an
 *     overridden `layer.groups.isGroupMember` is what a sibling sees. That is
 *     the property `jest.spyOn(SupabaseService.prototype, …)` has today and
 *     the reason the facade builds its `deps` literal inline.
 */
jest.mock('./groups');
jest.mock('./users');
jest.mock('./notifications');
jest.mock('./readState');
jest.mock('./uploads');
jest.mock('./storageAcl');
jest.mock('./chatSend');
jest.mock('./gamification');
jest.mock('./boardActions');
jest.mock('./marketplace');

import { createDataLayer, type DataLayerHost } from './index';
import * as groupsData from './groups';
import * as notificationsData from './notifications';
import * as readStateData from './readState';
import * as uploadsData from './uploads';
import * as storageAclData from './storageAcl';
import * as gamificationData from './gamification';
import * as boardActionsData from './boardActions';
import * as marketplaceData from './marketplace';

const client = { marker: 'client' } as never;
const legacyService = { marker: 'facade' } as never;

// Only the entries these tests exercise; the rest of the bridge is a jest.fn().
const host = {
  legacyService,
  resolveTopicForArtefact: jest.fn(async () => null),
  normalizeMessageRecord: jest.fn((row: unknown) => row),
  normalizeListingRecord: jest.fn((l: unknown) => l),
  normalizeListingRecordAsync: jest.fn(async (l: unknown) => l),
  ratingColumnsAvailable: jest.fn(() => true),
  noteRatingColumnsMissing: jest.fn(),
  signSimilarListingCards: jest.fn(async (l: unknown) => l),
  calculateTestScore: jest.fn(() => 0),
  generateTestQuestions: jest.fn(() => []),
  recordLearningConnection: jest.fn(async () => undefined),
  createOrderFromBuyNow: jest.fn(async () => ({})),
  createOrderFromOfferAccept: jest.fn(async () => ({})),
  consumeBoostCredit: jest.fn(async () => true),
  notifyListingBackAvailable: jest.fn(async () => undefined),
  deleteUserAccountFully: jest.fn(async () => ({ found: true })),
  exportUserDataArchive: jest.fn(async () => ({})),
} as unknown as DataLayerHost;

const build = () =>
  createDataLayer({ client, supabaseUrl: 'https://example.supabase.co', host });

describe('createDataLayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The breaker factory is mocked away with the rest of `./marketplace`;
    // every layer still needs the pair it returns.
    (
      marketplaceData.createRatingColumnCircuitBreaker as jest.Mock
    ).mockImplementation(() => {
      let brokenUntil = 0;
      return {
        ratingColumnsAvailable: () => Date.now() >= brokenUntil,
        noteRatingColumnsMissing: () => {
          brokenUntil = Date.now() + 10 * 60 * 1000;
        },
      };
    });
  });

  it('binds the client first and leaves the caller arguments alone', async () => {
    const layer = build();
    await layer.groups.getGroupById('group-1', 'user-1');
    expect(groupsData.getGroupById).toHaveBeenCalledWith(
      client,
      'group-1',
      'user-1',
    );
  });

  it('passes deps second, and last where the function declares it there', async () => {
    const layer = build();

    await layer.readState.setChatMute('user-1', 'group', 'group-1', new Date(0));
    const muteCall = (readStateData.setChatMute as jest.Mock).mock.calls[0];
    expect(muteCall[0]).toBe(client);
    expect(typeof muteCall[1].assertChatMuteAccess).toBe('function');
    expect(muteCall.slice(2)).toEqual(['user-1', 'group', 'group-1', new Date(0)]);

    await layer.notifications.createNotification('user-1', { message: 'hi' });
    const notifyCall = (notificationsData.createNotification as jest.Mock).mock
      .calls[0];
    expect(notifyCall[0]).toBe(client);
    expect(notifyCall[1]).toBe('user-1');
    expect(notifyCall[2]).toEqual({ message: 'hi' });
    expect(typeof notifyCall[3].isChatMuted).toBe('function');
  });

  it('reads a sibling dep through the layer at call time', async () => {
    const layer = build();
    await layer.groups.getGroups({ userId: 'user-1' });

    const deps = (groupsData.getGroups as jest.Mock).mock.calls[0][1];
    const override = jest.fn(async () => true);
    layer.groups.isGroupMember = override as never;

    await expect(deps.isGroupMember('group-1', 'user-1')).resolves.toBe(true);
    expect(override).toHaveBeenCalledWith('group-1', 'user-1');
    expect(groupsData.isGroupMember).not.toHaveBeenCalled();
  });

  it('routes a cross-domain dep to the domain that owns it', async () => {
    const layer = build();
    await layer.groups.getGroups({});
    const groupDeps = (groupsData.getGroups as jest.Mock).mock.calls[0][1];

    // Gamification owns this one, so the dep resolves through that namespace.
    await groupDeps.incrementUserStatsAndAwardBadges('user-1', {});
    expect(gamificationData.incrementUserStatsAndAwardBadges).toHaveBeenCalled();

    // The storage ACL takes the project URL as its second positional argument,
    // which is the binder shape that module gets to itself.
    await layer.uploads.uploadGroupAvatar({
      groupId: 'group-1',
      fileName: 'a.png',
      base64Data: '',
      contentType: 'image/png',
    });
    const signDeps = (uploadsData.uploadGroupAvatar as jest.Mock).mock.calls[0][1];
    await signDeps.createSignedStorageUrl('group-avatars', 'a.png', 60);
    expect(storageAclData.createSignedStorageUrl).toHaveBeenCalledWith(
      client,
      'https://example.supabase.co',
      'group-avatars',
      'a.png',
      60,
    );
  });

  it('gives data/storageAcl its own binder shape: client, then the project URL', async () => {
    const layer = build();
    await layer.storageAcl.signStorageDisplayUrl('https://example/x.png');
    expect(storageAclData.signStorageDisplayUrl).toHaveBeenCalledWith(
      client,
      'https://example.supabase.co',
      'https://example/x.png',
    );
    // The pure half takes the URL and no client.
    layer.storageAcl.normalizeStorageUrl('https://example/y.png');
    expect(storageAclData.normalizeStorageUrl).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'https://example/y.png',
    );
  });

  it('binds deps first for the functions that issue no query', async () => {
    const layer = build();
    await layer.boardActions.enrichBoardViewerState([], 'user-1');
    const call = (boardActionsData.enrichBoardViewerState as jest.Mock).mock
      .calls[0];
    expect(call[0]).not.toBe(client);
    expect(typeof call[0].repostedByMeAmong).toBe('function');
    expect(call.slice(1)).toEqual([[], 'user-1']);
  });

  it('routes a dep with no data-layer home through the host bridge', async () => {
    const layer = build();
    await layer.marketplace.getMarketplaceListingById('listing-1');
    const deps = (marketplaceData.getMarketplaceListingById as jest.Mock).mock
      .calls[0][1];

    // `marketplaceOrders` takes the whole facade, so this one is still the
    // bridge's. The five bodies that used to be here moved into the data
    // modules in lane M3 and are read through `layer` like any sibling.
    await deps.createOrderFromBuyNow('listing-1', 'buyer-1');
    expect(host.createOrderFromBuyNow).toHaveBeenCalledWith(
      'listing-1',
      'buyer-1',
    );
  });

  it('holds the rating-column circuit breaker PER LAYER', async () => {
    const first = build();
    const second = build();

    expect(first.marketplace.ratingColumnsAvailable()).toBe(true);
    first.marketplace.noteRatingColumnsMissing();

    // The layer that saw the 42703 stops asking; a second layer is untouched.
    expect(first.marketplace.ratingColumnsAvailable()).toBe(false);
    expect(second.marketplace.ratingColumnsAvailable()).toBe(true);
  });

  it('hands out the client and the legacy facade handle unchanged', () => {
    const layer = build();
    expect(layer.getClient()).toBe(client);
    expect(layer.legacyService).toBe(legacyService);
  });
});

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

import { createDataLayer, type DataLayerHost } from './index';
import * as groupsData from './groups';
import * as notificationsData from './notifications';
import * as readStateData from './readState';
import * as uploadsData from './uploads';
import * as storageAclData from './storageAcl';

const client = { marker: 'client' } as never;
const legacyService = { marker: 'facade' };

const host: DataLayerHost = {
  legacyService,
  incrementUserStatsAndAwardBadges: jest.fn(async () => undefined),
  deleteUserAccountFully: jest.fn(async () => ({ found: true })),
  exportUserDataArchive: jest.fn(async () => ({})),
};

const build = () =>
  createDataLayer({ client, supabaseUrl: 'https://example.supabase.co', host });

describe('createDataLayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    // Gamification is not bound yet, so it goes through the host seam.
    await groupDeps.incrementUserStatsAndAwardBadges('user-1', {});
    expect(host.incrementUserStatsAndAwardBadges).toHaveBeenCalledWith(
      'user-1',
      {},
    );

    // The storage ACL is not bound either, but needs only the client and the
    // project URL, so the layer calls it directly.
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

  it('hands out the client and the legacy facade handle unchanged', () => {
    const layer = build();
    expect(layer.getClient()).toBe(client);
    expect(layer.legacyService).toBe(legacyService);
  });
});

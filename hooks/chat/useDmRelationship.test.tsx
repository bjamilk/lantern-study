// @vitest-environment jsdom
/**
 * Contract test for the DM request / block / mute cluster (lane M8b, step 5).
 *
 * Everything here is asymmetric, and the asymmetries are the point:
 *
 *  - blocking asks for confirmation; unblocking does not. An accidental unblock
 *    is recoverable by the person who made it. An accidental block is invisible
 *    to the person it hits.
 *  - `dmBlocked` and `iBlockedThem` are two different facts. Both close the
 *    composer, but only the second offers an Unblock button, so a hook that
 *    collapsed them would let a blocked user think they could undo it.
 *  - mute is not DM-only: a group chat mutes through a different pair of
 *    endpoints, chosen by `isGroup`. One caller, two backends.
 *  - a refused mute must leave the state alone and say so, rather than showing
 *    a muted bell over a chat that still rings.
 *
 * The hook is mounted for real (jsdom + react-dom/client); `services/supabase`,
 * the toast store and the confirm dialog are replaced.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDmRelationship } from './useDmRelationship';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = {
  acceptDmMessageRequest: vi.fn(),
  declineDmMessageRequest: vi.fn(),
  getDmBlockStatus: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  getDmMuteStatus: vi.fn(),
  muteDmThread: vi.fn(),
  unmuteDmThread: vi.fn(),
  getGroupMuteStatus: vi.fn(),
  muteGroupChat: vi.fn(),
  unmuteGroupChat: vi.fn(),
};

vi.mock('../../services/supabase', () => ({
  acceptDmMessageRequest: (...a: unknown[]) => api.acceptDmMessageRequest(...a),
  declineDmMessageRequest: (...a: unknown[]) => api.declineDmMessageRequest(...a),
  getDmBlockStatus: (...a: unknown[]) => api.getDmBlockStatus(...a),
  blockUser: (...a: unknown[]) => api.blockUser(...a),
  unblockUser: (...a: unknown[]) => api.unblockUser(...a),
  getDmMuteStatus: (...a: unknown[]) => api.getDmMuteStatus(...a),
  muteDmThread: (...a: unknown[]) => api.muteDmThread(...a),
  unmuteDmThread: (...a: unknown[]) => api.unmuteDmThread(...a),
  getGroupMuteStatus: (...a: unknown[]) => api.getGroupMuteStatus(...a),
  muteGroupChat: (...a: unknown[]) => api.muteGroupChat(...a),
  unmuteGroupChat: (...a: unknown[]) => api.unmuteGroupChat(...a),
}));

const showToast = vi.fn();
vi.mock('../../stores/toastStore', () => ({
  useToastStore: { getState: () => ({ showToast }) },
}));

const confirm = vi.fn();
vi.mock('../../stores/confirmStore', () => ({
  confirmDialog: (...a: unknown[]) => confirm(...a),
}));

const currentUser = { id: 'u1', name: 'Ada' } as never;
const dmChat = { id: 'd1', chatType: 'dm', participantIds: ['u1', 'u2'] } as never;
const groupChat = { id: 'g1', chatType: 'group' } as never;

let container: HTMLDivElement;
let root: Root;
let rel: ReturnType<typeof useDmRelationship>;

const Probe: React.FC<{ params: Record<string, unknown> }> = ({ params }) => {
  rel = useDmRelationship({
    chat: dmChat,
    currentUser,
    isGroup: false,
    ...params,
  } as never);
  return null;
};

const mount = async (params: Record<string, unknown> = {}) => {
  await act(async () => {
    root.render(<Probe params={params} />);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getDmBlockStatus.mockResolvedValue({ blocked: false, iBlockedThem: false });
  api.getDmMuteStatus.mockResolvedValue({ muted: false, mutedUntil: null });
  api.getGroupMuteStatus.mockResolvedValue({ muted: false, mutedUntil: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useDmRelationship', () => {
  it('hands back the whole relationship and the five actions', async () => {
    await mount();
    expect(Object.keys(rel).sort()).toEqual([
      'chatMuted',
      'dmBlockBusy',
      'dmBlocked',
      'dmPeerId',
      'dmRequestBusy',
      'dmRequestStatus',
      'dmThread',
      'handleAcceptDmRequest',
      'handleDeclineDmRequest',
      'handleMuteFor',
      'handleToggleDmBlock',
      'handleUnmute',
      'iBlockedThem',
      'muteBusy',
      'muteUntilLabel',
    ]);
  });

  it('finds the peer in a DM, and has none in a group', async () => {
    await mount();
    expect(rel.dmPeerId).toBe('u2');
    expect(rel.dmThread).toBeTruthy();

    await mount({ chat: groupChat, isGroup: true });
    expect(rel.dmPeerId).toBeUndefined();
    expect(rel.dmThread).toBeNull();
  });

  describe('message requests', () => {
    it('reads the status off the thread', async () => {
      await mount({ chat: { ...(dmChat as object), status: 'pending' } as never });
      expect(rel.dmRequestStatus).toBe('pending');
    });

    it('accepting opens the thread and tells the shell', async () => {
      const onDmThreadStatusChange = vi.fn();
      await mount({
        chat: { ...(dmChat as object), status: 'pending', requestedBy: 'u2' } as never,
        onDmThreadStatusChange,
      });
      await act(async () => {
        await rel.handleAcceptDmRequest();
      });
      expect(api.acceptDmMessageRequest).toHaveBeenCalledWith('d1');
      expect(rel.dmRequestStatus).toBe('open');
      expect(onDmThreadStatusChange).toHaveBeenCalledWith('d1', {
        status: 'open',
        requestedBy: null,
      });
    });

    it('declining keeps it one-way, and remembers who asked', async () => {
      const onDmThreadStatusChange = vi.fn();
      await mount({
        chat: { ...(dmChat as object), status: 'pending', requestedBy: 'u2' } as never,
        onDmThreadStatusChange,
      });
      await act(async () => {
        await rel.handleDeclineDmRequest();
      });
      expect(rel.dmRequestStatus).toBe('declined');
      expect(onDmThreadStatusChange).toHaveBeenCalledWith('d1', {
        status: 'declined',
        requestedBy: 'u2',
      });
    });

    it('does not change the status when the server refuses', async () => {
      api.acceptDmMessageRequest.mockRejectedValue(new Error('offline'));
      await mount({ chat: { ...(dmChat as object), status: 'pending' } as never });
      await act(async () => {
        await rel.handleAcceptDmRequest();
      });
      expect(rel.dmRequestStatus).toBe('pending');
      expect(showToast).toHaveBeenCalledWith('offline', 'error');
    });
  });

  describe('blocking', () => {
    it('confirms before blocking, and names the peer while asking', async () => {
      confirm.mockResolvedValue(true);
      await mount();
      await act(async () => {
        await rel.handleToggleDmBlock('Chidi Nwosu');
      });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(String((confirm.mock.calls[0]![0] as { message: string }).message)).toContain(
        'Chidi Nwosu'
      );
      expect(api.blockUser).toHaveBeenCalledWith('u1', 'u2');
      expect(rel.dmBlocked).toBe(true);
      expect(rel.iBlockedThem).toBe(true);
    });

    it('blocks nobody when the confirmation is dismissed', async () => {
      confirm.mockResolvedValue(false);
      await mount();
      await act(async () => {
        await rel.handleToggleDmBlock('Chidi Nwosu');
      });
      expect(api.blockUser).not.toHaveBeenCalled();
      expect(rel.dmBlocked).toBe(false);
    });

    it('unblocks without asking, then re-reads who is blocked', async () => {
      api.getDmBlockStatus.mockResolvedValue({ blocked: true, iBlockedThem: true });
      await mount();
      expect(rel.iBlockedThem).toBe(true);

      api.getDmBlockStatus.mockResolvedValue({ blocked: false, iBlockedThem: false });
      await act(async () => {
        await rel.handleToggleDmBlock('Chidi Nwosu');
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(api.unblockUser).toHaveBeenCalledWith('u1', 'u2');
      expect(rel.dmBlocked).toBe(false);
      expect(rel.iBlockedThem).toBe(false);
    });

    it('distinguishes being blocked from having blocked', async () => {
      api.getDmBlockStatus.mockResolvedValue({ blocked: true, iBlockedThem: false });
      await mount();
      expect(rel.dmBlocked).toBe(true);
      expect(rel.iBlockedThem).toBe(false);
    });
  });

  describe('muting', () => {
    it('mutes a DM through the DM endpoint', async () => {
      api.muteDmThread.mockResolvedValue({ muted: true, mutedUntil: null });
      await mount();
      await act(async () => {
        await rel.handleMuteFor('forever' as never);
      });
      expect(api.muteDmThread).toHaveBeenCalledWith('d1', 'forever');
      expect(api.muteGroupChat).not.toHaveBeenCalled();
      expect(rel.chatMuted).toBe(true);
    });

    it('mutes a group through the group endpoint', async () => {
      api.muteGroupChat.mockResolvedValue({ muted: true, mutedUntil: null });
      await mount({ chat: groupChat, isGroup: true });
      await act(async () => {
        await rel.handleMuteFor('forever' as never);
      });
      expect(api.muteGroupChat).toHaveBeenCalledWith('g1', 'forever');
      expect(api.muteDmThread).not.toHaveBeenCalled();
      expect(rel.chatMuted).toBe(true);
    });

    it('stays unmuted, and says so, when the server refuses', async () => {
      api.muteDmThread.mockResolvedValue({ muted: false });
      await mount();
      await act(async () => {
        await rel.handleMuteFor('forever' as never);
      });
      expect(rel.chatMuted).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Could not mute notifications.', 'error');
    });

    it('unmutes, and clears the until-label with it', async () => {
      api.getDmMuteStatus.mockResolvedValue({
        muted: true,
        mutedUntil: '2099-01-01T00:00:00.000Z',
      });
      await mount();
      expect(rel.chatMuted).toBe(true);
      expect(rel.muteUntilLabel).toBeTruthy();

      api.unmuteDmThread.mockResolvedValue({ muted: false });
      await act(async () => {
        await rel.handleUnmute();
      });
      expect(rel.chatMuted).toBe(false);
      expect(rel.muteUntilLabel).toBeFalsy();
    });
  });
});

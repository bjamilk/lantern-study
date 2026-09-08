import React, { useCallback, useEffect, useState } from 'react';
import Modal from './ui/Modal';
import { Avatar, Button } from './ui';
import { listBlockedUsers, unblockUser, fetchUserProfile } from '../services/supabase';
import { useToastStore } from '../stores/toastStore';
import { confirmDialog } from '../stores/confirmStore';
import { planUnblockUserConfirm } from '../utils/destructiveConfirm';

interface BlockedUser {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

interface BlockedUsersModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

/**
 * Web roster of users the caller has blocked, with an unblock action.
 * Mirrors the mobile BlockedUsersScreen so blocking is reversible without
 * having to find the original DM.
 */
export const BlockedUsersModal: React.FC<BlockedUsersModalProps> = ({ open, onClose, userId }) => {
  const { showToast } = useToastStore();
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const { blockedUserIds } = await listBlockedUsers(userId);
      // The endpoint returns ids only, so hydrate each. A profile that fails to
      // load still gets a row — otherwise the user loses the ability to unblock.
      const hydrated = await Promise.all(
        blockedUserIds.map(async (id): Promise<BlockedUser> => {
          try {
            const profile = await fetchUserProfile(id);
            return { id, name: profile?.name || 'Unknown user', avatarUrl: profile?.avatarUrl };
          } catch {
            return { id, name: 'Unknown user' };
          }
        })
      );
      setBlocked(hydrated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load blocked users.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleUnblock = async (target: BlockedUser) => {
    if (busyId) return;
    const ok = await confirmDialog(planUnblockUserConfirm({ name: target.name }));
    if (!ok) return;
    setBusyId(target.id);
    try {
      await unblockUser(userId, target.id);
      setBlocked((prev) => prev.filter((b) => b.id !== target.id));
      showToast(`Unblocked ${target.name}.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not unblock. Please try again.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      ariaLabelledBy="blocked-users-title"
      maxWidthClass="max-w-md"
      zIndexClass="z-[90]"
      panelClassName="flex flex-col max-h-[80vh] border border-lantern-border bg-lantern-surface rounded-lantern-xl"
    >
      <div className="flex items-center justify-between p-4 border-b border-lantern-border">
        <h2 id="blocked-users-title" className="text-lg font-semibold text-lantern-text">
          Blocked users
        </h2>
        <span className="text-xs text-lantern-text-secondary">
          {blocked.length > 0 ? `${blocked.length} blocked` : ''}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-lantern-text-secondary text-center py-8">Loading…</p>
        ) : error && blocked.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-lantern-text-secondary">{error}</p>
            <Button variant="secondary" onClick={() => void load()}>Retry</Button>
          </div>
        ) : blocked.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <p className="text-base font-semibold text-lantern-text">No blocked users</p>
            <p className="text-sm text-lantern-text-secondary">
              People you block from a direct message will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-lantern-border">
            {blocked.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-3">
                <Avatar name={item.name} src={item.avatarUrl || undefined} size="md" />
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-lantern-text">
                  {item.name}
                </span>
                <button
                  type="button"
                  onClick={() => void handleUnblock(item)}
                  disabled={busyId === item.id}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg border border-lantern-border text-xs font-semibold text-lantern-primary hover:bg-lantern-background disabled:opacity-50"
                >
                  {busyId === item.id ? 'Unblocking…' : 'Unblock'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex-shrink-0 p-4 border-t border-lantern-border flex justify-end">
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
};

export default BlockedUsersModal;

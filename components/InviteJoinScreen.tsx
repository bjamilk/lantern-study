import React, { useEffect, useState } from 'react';
import { AppIcon } from './ui/AppIcon';
import { fetchGroupInvitePreview, joinGroupByInvite, fetchGroups } from '../services/supabase';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { AppMode } from '../types';
import { navigateToPath } from '../utils/appNavigation';

const INVITE_STORAGE_KEY = 'pendingInviteId';

interface InviteJoinScreenProps {
  inviteId: string;
  userId: string;
}

const InviteJoinScreen: React.FC<InviteJoinScreenProps> = ({ inviteId, userId }) => {
  const setGroups = useGroupStore((s) => s.setGroups);
  const setSelectedChat = useUIStore((s) => s.setSelectedChat);
  const setAppModeDirect = useUIStore((s) => s.setAppModeDirect);

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    name: string;
    description: string;
    avatarUrl?: string;
    memberCount: number;
    alreadyMember: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGroupInvitePreview(inviteId)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Invalid or expired invite link');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteId]);

  const clearPending = () => {
    localStorage.removeItem(INVITE_STORAGE_KEY);
  };

  const handleDecline = () => {
    clearPending();
    navigateToPath('/dashboard', { replace: true });
    setAppModeDirect(AppMode.DASHBOARD);
  };

  const handleAccept = async () => {
    if (!preview) return;
    setJoining(true);
    setError(null);
    try {
      if (preview.alreadyMember) {
        clearPending();
        navigateToPath(`/chat/group/${encodeURIComponent(preview.id)}`, { replace: true });
        setAppModeDirect(AppMode.CHAT);
        return;
      }

      const group = await joinGroupByInvite(inviteId);
      clearPending();
      try {
        const updatedGroups = await fetchGroups(userId);
        if (updatedGroups) setGroups(updatedGroups);
      } catch (err) {
        console.error('Failed to refresh groups after joining:', err);
      }
      setSelectedChat({
        ...group,
        chatType: 'group' as const,
        members: group.members || [],
        unreadCount: 0,
      });
      navigateToPath(`/chat/group/${encodeURIComponent(group.id)}`, { replace: true });
      setAppModeDirect(AppMode.CHAT);
    } catch (err: any) {
      setError(err?.message || 'Failed to join group');
    } finally {
      setJoining(false);
    }
  };

  const avatar =
    preview?.avatarUrl ||
    (preview
      ? `https://ui-avatars.com/api/?name=${encodeURIComponent(preview.name)}&background=191919&color=fff&size=128`
      : '');

  return (
    <div className="min-h-screen flex items-center justify-center bg-lantern-background p-4">
      <div className="w-full max-w-md bg-lantern-surface rounded-2xl shadow-xl border border-lantern-border overflow-hidden">
        <div className="bg-gradient-to-r from-lantern-primary to-purple-600 px-6 py-4">
          <h1 className="text-lg font-bold text-white">Group invitation</h1>
          <p className="text-sm text-white/80">Choose whether to join this group</p>
        </div>

        <div className="p-6">
          {loading && (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-lantern-primary/30 border-t-lantern-primary" />
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-8 space-y-4">
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
              <button
                type="button"
                onClick={handleDecline}
                className="px-4 py-2 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary text-lantern-text text-sm font-medium"
              >
                Go to dashboard
              </button>
            </div>
          )}

          {!loading && preview && !error && (
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center">
                <img src={avatar} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-lantern-primary/20 dark:border-lantern-primary/30" />
                <h2 className="mt-3 text-xl font-semibold text-lantern-text">{preview.name}</h2>
                {preview.description ? (
                  <p className="mt-1 text-sm text-lantern-text-secondary">{preview.description}</p>
                ) : null}
                <p className="mt-2 text-xs text-lantern-text-tertiary flex items-center gap-1">
                  <AppIcon name="people" size={16} />
                  {preview.memberCount} member{preview.memberCount === 1 ? '' : 's'}
                </p>
                {preview.alreadyMember && (
                  <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">You are already a member of this group.</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleDecline}
                  disabled={joining}
                  className="flex-1 py-3 rounded-xl border border-lantern-border text-lantern-text font-semibold flex items-center justify-center gap-2 hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary"
                >
                  <AppIcon name="close" size={20} />
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => void handleAccept()}
                  disabled={joining}
                  className="flex-1 py-3 rounded-xl bg-lantern-primary hover:bg-lantern-primary-dark text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <AppIcon name="checkmark" size={20} />
                  {joining ? 'Joining…' : preview.alreadyMember ? 'Open group' : 'Accept'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InviteJoinScreen;
export { INVITE_STORAGE_KEY };

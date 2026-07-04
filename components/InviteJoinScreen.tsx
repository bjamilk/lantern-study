import React, { useEffect, useState } from 'react';
import { UsersIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
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
      ? `https://ui-avatars.com/api/?name=${encodeURIComponent(preview.name)}&background=6366f1&color=fff&size=128`
      : '');

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
          <h1 className="text-lg font-bold text-white">Group invitation</h1>
          <p className="text-sm text-white/80">Choose whether to join this group</p>
        </div>

        <div className="p-6">
          {loading && (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-200 border-t-indigo-600" />
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-8 space-y-4">
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
              <button
                type="button"
                onClick={handleDecline}
                className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-medium"
              >
                Go to dashboard
              </button>
            </div>
          )}

          {!loading && preview && !error && (
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center">
                <img src={avatar} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-indigo-100 dark:border-indigo-800" />
                <h2 className="mt-3 text-xl font-semibold text-slate-900 dark:text-slate-100">{preview.name}</h2>
                {preview.description ? (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{preview.description}</p>
                ) : null}
                <p className="mt-2 text-xs text-slate-400 flex items-center gap-1">
                  <UsersIcon className="w-4 h-4" />
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
                  className="flex-1 py-3 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-semibold flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <XMarkIcon className="w-5 h-5" />
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => void handleAccept()}
                  disabled={joining}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <CheckIcon className="w-5 h-5" />
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

import React, { useEffect, useState, useCallback } from 'react';
import type { GroupChallenge } from '../types';
import { XMarkIcon, CheckIcon, XCircleIcon, PlayIcon } from '@heroicons/react/24/outline';
import {
  fetchChallenges,
  acceptChallenge,
  declineChallenge,
} from '../services/challenges';

interface ChallengesInboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: string;
  onPlayChallenge: (challengeId: string) => void;
}

export const ChallengesInboxModal: React.FC<ChallengesInboxModalProps> = ({
  isOpen,
  onClose,
  currentUserId,
  onPlayChallenge,
}) => {
  const [challenges, setChallenges] = useState<GroupChallenge[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const data = await fetchChallenges();
      setChallenges(data);
    } catch (e) {
      console.error(e);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return;
    const intervalId = window.setInterval(() => {
      void load({ silent: true });
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [isOpen, load]);

  const handleAccept = async (id: string) => {
    setActionId(id);
    try {
      await acceptChallenge(id);
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to accept');
    } finally {
      setActionId(null);
    }
  };

  const handleDecline = async (id: string) => {
    setActionId(id);
    try {
      await declineChallenge(id);
      await load();
    } catch (e: any) {
      alert(e.message || 'Failed to decline');
    } finally {
      setActionId(null);
    }
  };

  if (!isOpen) return null;

  const pendingIncoming = challenges.filter(
    c => c.status === 'pending' && c.opponentId === currentUserId
  );
  const pendingOutgoing = challenges.filter(
    c => c.status === 'pending' && c.challengerId === currentUserId
  );
  const active = challenges.filter(c => c.status === 'accepted');
  const recent = challenges.filter(c => ['completed', 'declined', 'expired'].includes(c.status));

  const renderRow = (c: GroupChallenge) => {
    const isOpponent = c.opponentId === currentUserId;
    const otherName = isOpponent ? c.challenger?.name : c.opponent?.name;
    const busy = actionId === c.id;

    return (
      <div key={c.id} className="p-3 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-col gap-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <p className="font-medium text-slate-800 dark:text-slate-100">
              {isOpponent ? `${otherName} challenged you` : `You challenged ${otherName}`}
            </p>
            <p className="text-xs text-slate-500 capitalize">{c.status} · {c.config.numberOfQuestions} questions</p>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
            {c.status}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {c.status === 'pending' && isOpponent && (
            <>
              <button
                disabled={busy}
                onClick={() => handleAccept(c.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckIcon className="w-4 h-4" /> Accept
              </button>
              <button
                disabled={busy}
                onClick={() => handleDecline(c.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-600 rounded-md hover:bg-slate-300 dark:hover:bg-slate-500 disabled:opacity-50"
              >
                <XCircleIcon className="w-4 h-4" /> Decline
              </button>
            </>
          )}
          {c.status === 'accepted' && !c.myParticipant?.finishedAt && (
            <button
              onClick={() => { onPlayChallenge(c.id); onClose(); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              <PlayIcon className="w-4 h-4" /> Play Duel
            </button>
          )}
          {c.status === 'pending' && !isOpponent && (
            <span className="text-sm text-amber-600 dark:text-amber-400 italic">Waiting for {otherName} to accept…</span>
          )}
          {c.status === 'accepted' && c.myParticipant?.finishedAt && (
            <span className="text-sm text-slate-500 italic">Waiting for opponent…</span>
          )}
          {c.status === 'completed' && (
            <button
              onClick={() => { onPlayChallenge(c.id); onClose(); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-200 dark:bg-slate-600 rounded-md"
            >
              View Results
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[85]" role="dialog">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Duel Challenges</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700"><XMarkIcon className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && pendingIncoming.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">Incoming</h3>
              <div className="space-y-2">{pendingIncoming.map(renderRow)}</div>
            </section>
          )}
          {!loading && pendingOutgoing.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">Sent — waiting for response</h3>
              <div className="space-y-2">{pendingOutgoing.map(renderRow)}</div>
            </section>
          )}
          {!loading && active.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">Active</h3>
              <div className="space-y-2">{active.map(renderRow)}</div>
            </section>
          )}
          {!loading && recent.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">Recent</h3>
              <div className="space-y-2">{recent.slice(0, 10).map(renderRow)}</div>
            </section>
          )}
          {!loading && challenges.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-8">No duels yet. Challenge a group member to get started!</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChallengesInboxModal;

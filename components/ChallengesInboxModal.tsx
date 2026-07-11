import React, { useEffect, useState, useCallback } from 'react';
import { useToastStore } from '../stores/toastStore';
import type { GroupChallenge } from '../types';
import { XMarkIcon, CheckIcon, XCircleIcon, PlayIcon } from '@heroicons/react/24/outline';
import {
  fetchChallenges,
  acceptChallenge,
  declineChallenge,
} from '../services/challenges';
import Modal from './ui/Modal';

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
      setChallenges(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      if (message !== 'Authentication required') {
        console.warn('Failed to load challenges:', message || e);
      }
      setChallenges([]);
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
      useToastStore.getState().showToast(e.message || 'Failed to accept', 'error');
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
      useToastStore.getState().showToast(e.message || 'Failed to decline', 'error');
    } finally {
      setActionId(null);
    }
  };

  const renderRow = (c: GroupChallenge) => {
    const isOpponent = c.opponentId === currentUserId;
    const otherName = isOpponent ? c.challenger?.name : c.opponent?.name;
    const busy = actionId === c.id;

    return (
      <div key={c.id} className="p-3 border border-lantern-border rounded-lg flex flex-col gap-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <p className="font-medium text-lantern-text">
              {isOpponent ? `${otherName} challenged you` : `You challenged ${otherName}`}
            </p>
            <p className="text-xs text-lantern-text-muted capitalize">{c.status} · {c.config.numberOfQuestions} questions</p>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-lantern-background-secondary text-lantern-text-secondary">
            {c.status}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {c.status === 'pending' && isOpponent && (
            <>
              <button
                disabled={busy}
                onClick={() => handleAccept(c.id)}
                className="inline-flex items-center gap-1 min-h-[44px] px-3 py-1.5 text-sm bg-lantern-success text-white rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                <CheckIcon className="w-4 h-4" aria-hidden /> Accept
              </button>
              <button
                disabled={busy}
                onClick={() => handleDecline(c.id)}
                className="inline-flex items-center gap-1 min-h-[44px] px-3 py-1.5 text-sm bg-lantern-background-secondary rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                <XCircleIcon className="w-4 h-4" aria-hidden /> Decline
              </button>
            </>
          )}
          {c.status === 'accepted' && !c.myParticipant?.finishedAt && (
            <button
              onClick={() => { onPlayChallenge(c.id); onClose(); }}
              className="inline-flex items-center gap-1 min-h-[44px] px-3 py-1.5 text-sm bg-lantern-primary text-white rounded-lg hover:bg-lantern-primary-dark"
            >
              <PlayIcon className="w-4 h-4" aria-hidden /> Play Duel
            </button>
          )}
          {c.status === 'pending' && !isOpponent && (
            <span className="text-sm text-lantern-warning italic">Waiting for {otherName} to accept…</span>
          )}
          {c.status === 'accepted' && c.myParticipant?.finishedAt && (
            <span className="text-sm text-lantern-text-muted italic">Waiting for opponent…</span>
          )}
          {c.status === 'completed' && (
            <button
              onClick={() => { onPlayChallenge(c.id); onClose(); }}
              className="inline-flex items-center gap-1 min-h-[44px] px-3 py-1.5 text-sm bg-lantern-background-secondary rounded-lg"
            >
              View Results
            </button>
          )}
        </div>
      </div>
    );
  };

  const pendingIncoming = challenges.filter(
    c => c.status === 'pending' && c.opponentId === currentUserId
  );
  const pendingOutgoing = challenges.filter(
    c => c.status === 'pending' && c.challengerId === currentUserId
  );
  const active = challenges.filter(c => c.status === 'accepted');
  const recent = challenges.filter(c => ['completed', 'declined', 'expired'].includes(c.status));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="challenges-inbox-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 max-h-[80vh] flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between p-4 border-b border-lantern-border shrink-0">
        <h2 id="challenges-inbox-title" className="text-lg font-semibold text-lantern-text">Duel Challenges</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          aria-label="Close challenges inbox"
        >
          <XMarkIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-lantern-surface">
        {loading && <p className="text-sm text-lantern-text-muted">Loading…</p>}
        {!loading && pendingIncoming.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-lantern-text-secondary mb-2">Incoming</h3>
            <div className="space-y-2">{pendingIncoming.map(renderRow)}</div>
          </section>
        )}
        {!loading && pendingOutgoing.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-lantern-text-secondary mb-2">Sent — waiting for response</h3>
            <div className="space-y-2">{pendingOutgoing.map(renderRow)}</div>
          </section>
        )}
        {!loading && active.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-lantern-text-secondary mb-2">Active</h3>
            <div className="space-y-2">{active.map(renderRow)}</div>
          </section>
        )}
        {!loading && recent.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-lantern-text-secondary mb-2">Recent</h3>
            <div className="space-y-2">{recent.slice(0, 10).map(renderRow)}</div>
          </section>
        )}
        {!loading && challenges.length === 0 && (
          <p className="text-sm text-lantern-text-muted text-center py-8">No duels yet. Challenge a group member to get started!</p>
        )}
      </div>
    </Modal>
  );
};

export default ChallengesInboxModal;

import React, { useEffect, useMemo, useState } from 'react';
import { XCircleIcon, ArrowPathIcon, UserGroupIcon, PlusIcon } from '@heroicons/react/24/outline';
import { StudySession, StudySessionParticipant } from '../types';
import { createStudySession, endStudySession, fetchStudySessions, getStudySession, joinStudySession, leaveStudySession } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

interface StudySessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  deckId: string;
  autoJoinCode?: string;
}

const POLL_INTERVAL_MS = 5000;

const StudySessionModal: React.FC<StudySessionModalProps> = ({ isOpen, onClose, deckId, autoJoinCode }) => {
  const currentUser = useAuthStore(state => state.currentUser);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [pollId, setPollId] = useState<NodeJS.Timeout | null>(null);

  const loadSessions = async () => {
    if (!deckId) return;
    setIsLoading(true);
    try {
      const data = await fetchStudySessions(deckId);
      setSessions(data || []);
    } catch (err) {
      console.error('Failed to load study sessions', err);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshActiveSession = async (sessionId: string) => {
    try {
      const data = await getStudySession(sessionId);
      setActiveSession(data || null);
    } catch (err) {
      console.error('Failed to refresh session', err);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadSessions();
    return () => {
      if (pollId) clearInterval(pollId);
    };
  }, [isOpen, deckId]);

  useEffect(() => {
    if (!activeSession) return;

    const interval = setInterval(() => {
      refreshActiveSession(activeSession.id);
    }, POLL_INTERVAL_MS);

    setPollId(interval);
    return () => {
      clearInterval(interval);
      setPollId(null);
    };
  }, [activeSession]);

  const handleCreateSession = async () => {
    if (!currentUser?.id) return;
    setIsCreating(true);
    try {
      const session = await createStudySession(deckId, currentUser.id);
      setActiveSession(session);
      await loadSessions();
    } catch (err) {
      console.error('Failed to create session', err);
      alert('Failed to create session.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinSession = async (sessionId: string) => {
    if (!currentUser?.id) return;
    setIsJoining(true);
    try {
      await joinStudySession(sessionId, currentUser.id);
      await refreshActiveSession(sessionId);
      await loadSessions();
    } catch (err) {
      console.error('Failed to join session', err);
      alert('Failed to join session.');
    } finally {
      setIsJoining(false);
    }
  };

  const handleJoinByCode = async (code?: string) => {
    const target = (code || joinCode).trim();
    if (!target || !currentUser?.id) return;
    setIsJoining(true);
    try {
      await joinStudySession(target, currentUser.id);
      await refreshActiveSession(target);
      await loadSessions();
    } catch (err) {
      console.error('Failed to join session by code', err);
      alert('Failed to join session. Check the code and try again.');
    } finally {
      setIsJoining(false);
    }
  };

  useEffect(() => {
    if (isOpen && autoJoinCode) {
      setJoinCode(autoJoinCode);
      handleJoinByCode(autoJoinCode);
    }
  }, [isOpen, autoJoinCode]);

  const handleLeaveSession = async () => {
    if (!activeSession?.id || !currentUser?.id) return;
    setIsLeaving(true);
    try {
      await leaveStudySession(activeSession.id, currentUser.id);
      setActiveSession(null);
      await loadSessions();
    } catch (err) {
      console.error('Failed to leave session', err);
      alert('Failed to leave session.');
    } finally {
      setIsLeaving(false);
    }
  };

  const handleEndSession = async () => {
    if (!activeSession?.id) return;
    setIsEnding(true);
    try {
      await endStudySession(activeSession.id);
      setActiveSession(null);
      await loadSessions();
    } catch (err) {
      console.error('Failed to end session', err);
      alert('Failed to end session.');
    } finally {
      setIsEnding(false);
    }
  };

  const participantList = useMemo(() => {
    // Supabase may return participants under different key depending on relationship naming
    return (activeSession as any)?.participants || (activeSession as any)?.study_session_participants || [];
  }, [activeSession]);

  if (!isOpen) return null;

  const inviteLink = useMemo(() => {
    if (!activeSession) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/?studySession=${activeSession.id}`;
  }, [activeSession]);

  const isHost = currentUser?.id && activeSession?.createdBy === currentUser.id;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 w-full max-w-2xl rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <UserGroupIcon className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Shared Study Sessions</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Join an existing shared session to study with others. Sessions auto-refresh participants every few seconds.
            </p>
            <button
              onClick={handleCreateSession}
              disabled={isCreating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-md text-sm font-semibold"
            >
              <PlusIcon className="w-4 h-4" />
              {isCreating ? 'Creating…' : 'Create Session'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Join by session code"
                className="col-span-2 p-2 border rounded-md bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100"
              />
              <button
                onClick={handleJoinByCode}
                disabled={isJoining || !joinCode.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-md text-sm font-semibold"
              >
                {isJoining ? 'Joining…' : 'Join'}
              </button>
            </div>

            {activeSession && (
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Invite Link</div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={inviteLink}
                    className="flex-1 p-2 border rounded-md bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink).then(() => {
                        alert('Invite link copied');
                      });
                    }}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            {isLoading ? (
              <div className="text-sm text-slate-500">Loading sessions…</div>
            ) : sessions.length === 0 ? (
              <div className="text-sm text-slate-500">No active sessions yet. Create one to start a shared study.</div>
            ) : (
              sessions.map(session => (
                <div key={session.id} className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Session started {new Date(session.startedAt).toLocaleString()}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Code: <span className="font-mono">{session.id.slice(0, 8)}</span> - {session.isActive ? 'Active' : 'Ended'}</div>
                    </div>
                    <button
                      onClick={() => handleJoinSession(session.id)}
                      disabled={isJoining || !currentUser?.id}
                      className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-md text-sm font-semibold"
                    >
                      {isJoining ? 'Joining…' : 'Join'}
                    </button>
                  </div>

                  {activeSession?.id === session.id && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Participants</div>
                        <div className="flex gap-2">
                          {activeSession.isActive && currentUser?.id && (
                            <button
                              onClick={handleLeaveSession}
                              disabled={isLeaving}
                              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 rounded-md text-xs font-semibold"
                            >
                              {isLeaving ? 'Leaving…' : 'Leave'}
                            </button>
                          )}
                          {isHost && activeSession.isActive && (
                            <button
                              onClick={handleEndSession}
                              disabled={isEnding}
                              className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-md text-xs font-semibold"
                            >
                              {isEnding ? 'Ending…' : 'End Session'}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {participantList.length === 0 ? (
                          <div className="text-sm text-slate-500">No participants yet.</div>
                        ) : (
                          participantList.map((p: StudySessionParticipant) => (
                            <div key={p.userId} className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700">
                              <div>
                                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{p.name || p.userId}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">Joined {new Date(p.joinedAt).toLocaleTimeString()}</div>
                              </div>
                              {p.userId === currentUser?.id && (
                                <span className="text-xs text-indigo-600 dark:text-indigo-300 font-semibold">You</span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudySessionModal;

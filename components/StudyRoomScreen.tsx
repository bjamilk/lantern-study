import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import type { StudyRoomDetail } from '@lantern/shared/network';
import {
  fetchStudyRoom,
  joinOrCreateStudyRoom,
  joinStudyRoom,
  leaveStudyRoom,
  supabase,
} from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { studyRoomPresenceChannel } from '@lantern/shared/network';

export interface StudyRoomScreenProps {
  roomId?: string | null;
  join?: { courseId?: string | null; topic?: string | null } | null;
  onBack: () => void;
  onNeedCourse: () => void;
  onRoomReady?: (roomId: string) => void;
}

/**
 * Pull-based roster plus one presence channel for THIS room only.
 * Discover / the feed stay pull-based.
 */
export const StudyRoomScreen: React.FC<StudyRoomScreenProps> = ({
  roomId,
  join,
  onBack,
  onNeedCourse,
  onRoomReady,
}) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const showToast = useToastStore((s) => s.showToast);
  const [room, setRoom] = useState<StudyRoomDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveCount, setLiveCount] = useState(0);
  const onRoomReadyRef = useRef(onRoomReady);
  onRoomReadyRef.current = onRoomReady;

  const load = useCallback(async () => {
    setError(null);
    try {
      if (roomId) {
        const next = await fetchStudyRoom(roomId);
        setRoom(next);
        onRoomReadyRef.current?.(next.id);
        return;
      }
      if (join?.courseId) {
        const next = await joinOrCreateStudyRoom({
          courseId: join.courseId,
          topic: join.topic || null,
        });
        setRoom(next);
        onRoomReadyRef.current?.(next.id);
        return;
      }
      setRoom(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load the study room');
    } finally {
      setLoading(false);
    }
  }, [roomId, join?.courseId, join?.topic]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!room?.id || !currentUser?.id) return;
    const channelName = room.presenceChannel || studyRoomPresenceChannel(room.id);
    const channel = supabase.channel(channelName, {
      config: { presence: { key: currentUser.id } },
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setLiveCount(Object.keys(state).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId: currentUser.id,
            name: currentUser.name || 'Student',
          });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room?.id, room?.presenceChannel, currentUser?.id, currentUser?.name]);

  useEffect(() => {
    if (!room?.id) return;
    const interval = setInterval(() => {
      void fetchStudyRoom(room.id)
        .then(setRoom)
        .catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, [room?.id]);

  const handleJoin = async () => {
    if (!room) return;
    try {
      setRoom(await joinStudyRoom(room.id));
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not join', 'error');
    }
  };

  const handleLeave = async () => {
    if (!room) return;
    try {
      await leaveStudyRoom(room.id);
      onBack();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Could not leave', 'error');
    }
  };

  return (
    <div className="min-h-full bg-lantern-background">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-lg text-lantern-text-secondary hover:bg-lantern-background-secondary"
            aria-label="Back"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-semibold text-lantern-text">
            {room?.title || 'Study room'}
          </h1>
        </div>

        {loading && !room ? (
          <div className="h-32 rounded-xl bg-lantern-background-secondary animate-pulse" />
        ) : error && !room ? (
          <p className="text-sm text-lantern-error" role="alert">
            {error}{' '}
            <button type="button" className="underline font-semibold" onClick={() => void load()}>
              Retry
            </button>
          </p>
        ) : !room ? (
          <div className="rounded-xl border border-dashed border-lantern-border p-8 text-center">
            <p className="text-sm text-lantern-text">Pick a course to open a room.</p>
            <button
              type="button"
              onClick={onNeedCourse}
              className="mt-3 rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Start a study room
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-lantern-text-secondary">
              {room.topic ? `Studying ${room.topic}` : 'Course study room'}
              {liveCount > 0 ? ` · ${liveCount} live in the room` : ''}
            </p>
            <ul className="mt-4 divide-y divide-lantern-border/60 rounded-xl border border-lantern-border bg-lantern-surface">
              {(room.participants ?? []).length === 0 ? (
                <li className="px-4 py-3 text-sm text-lantern-text-secondary">Nobody here yet.</li>
              ) : (
                (room.participants ?? []).map((p) => (
                  <li key={p.userId} className="flex items-center gap-3 px-4 py-3">
                    <UserGroupIcon className="h-4 w-4 text-lantern-text-tertiary" aria-hidden />
                    <span className="text-sm text-lantern-text">{p.name}</span>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-4 flex gap-2">
              {room.joined ? (
                <button
                  type="button"
                  onClick={() => void handleLeave()}
                  className="rounded-lg border border-lantern-border px-4 py-2 text-sm font-semibold text-lantern-text"
                >
                  Leave room
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleJoin()}
                  className="rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Join room
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default StudyRoomScreen;

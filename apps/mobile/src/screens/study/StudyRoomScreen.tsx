import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { StudyRoomDetail } from '@lantern/shared/network';
import {
  fetchStudyRoom,
  joinOrCreateStudyRoom,
  joinStudyRoom,
  leaveStudyRoom,
} from '../../services/api';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { studyRoomPresenceChannel,
  COMMUNITY_COPY,
  STUDY_ROOM_LIFETIME_COPY,
} from '@lantern/shared/network';
import { CoursePicker } from '../../components/CoursePicker';
import { Screen, useScreenBottomPadding } from '../../components/layout';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Params = {
  roomId?: string;
  courseId?: string;
  topic?: string;
  /** Set when opened from inside a community (spec §4.7): join-or-create lands in that community's room. */
  communityId?: string;
  communityName?: string;
};

export function StudyRoomScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: Params };
}) {
  const user = useAuthStore((s) => s.user);
  const params = route?.params;
  const communityId = params?.communityId;
  const communityName = params?.communityName;
  const [room, setRoom] = useState<StudyRoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState(0);
  const [pickedCourseId, setPickedCourseId] = useState<string | null>(null);
  const [topicDraft, setTopicDraft] = useState('');
  const [starting, setStarting] = useState(false);
  // The bottom tab bar is an absolute overlay on this route, so the scroll
  // content has to clear it; `pb` used to be `py-4` on the ScrollView's own
  // style, which both under-paid the bar and clipped the scrollable extent.
  const bottomPadding = useScreenBottomPadding();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (params?.roomId) {
        setRoom(await fetchStudyRoom(params.roomId));
        return;
      }
      // From the hub's "Join room" presence line: a course is enough to land
      // straight in the room. Inside a community we show the picker first so
      // the topic can be set (the course is already known for course rooms).
      if (params?.courseId && !communityId) {
        setRoom(
          await joinOrCreateStudyRoom({
            courseId: params.courseId,
            topic: params.topic || null,
          }),
        );
        return;
      }
      setRoom(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load the study room');
    } finally {
      setLoading(false);
    }
  }, [params?.roomId, params?.courseId, params?.topic, communityId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!room?.id || !user?.id) return;
    const channelName = room.presenceChannel || studyRoomPresenceChannel(room.id);
    const channel = supabase.channel(channelName, {
      config: { presence: { key: user.id } },
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        setLiveCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ userId: user.id });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room?.id, room?.presenceChannel, user?.id]);

  useEffect(() => {
    if (!room?.id) return;
    const interval = setInterval(() => {
      void fetchStudyRoom(room.id).then(setRoom).catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, [room?.id]);

  // Course communities carry their course in params; other communities may
  // pick one (optional). Outside a community the course is required as today.
  const pickerCourseId = params?.courseId ?? pickedCourseId;
  const canStart = communityId ? true : !!pickedCourseId;

  const startRoom = () => {
    if (!canStart || starting) return;
    setStarting(true);
    void joinOrCreateStudyRoom({
      communityId: communityId ?? null,
      courseId: pickerCourseId ?? null,
      topic: topicDraft.trim() || null,
    })
      .then(setRoom)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Could not open a study room'),
      )
      .finally(() => setStarting(false));
  };

  return (
    // `keyboard` wraps the fixed header + scroller in a KeyboardAvoidingView
    // whose vertical offset the primitive measures, so the topic TextInput and
    // the "Join or create" button stay above the keyboard.
    <Screen edges={['top']} bottom="none" keyboard>
      <View className="flex-row items-center gap-2 px-4 py-3 border-b border-lantern-border">
        <Pressable hitSlop={10} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back" className="p-2">
          <Ionicons name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <View className="flex-1 min-w-0">
          <Text className="text-lg font-semibold text-lantern-text" numberOfLines={1}>
            {room?.title || 'Study room'}
          </Text>
          {communityName ? (
            <Text className="text-xs text-lantern-text-tertiary" numberOfLines={1}>
              {COMMUNITY_COPY.inCommunity(communityName)}
            </Text>
          ) : null}
        </View>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-4"
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator />
        ) : error ? (
          <Pressable onPress={() => void load()}>
            <Text className="text-sm text-lantern-error">{error} · Retry</Text>
          </Pressable>
        ) : !room ? (
          <View>
            <Text className="text-sm text-lantern-text-secondary mb-3">
              {communityId
                ? communityName
                  ? `${COMMUNITY_COPY.startRoomIn(communityName)}. If a room is already open here, you land there.`
                  : 'If a room is already open here, you land there.'
                : 'Pick a course. If a room is already open for it, you land there.'}
              {' '}Rooms are temporary — they close on their own.
            </Text>
            {/* A course community already knows its course; only ask otherwise. */}
            {params?.courseId ? null : (
              <CoursePicker
                value={pickedCourseId}
                onChange={(course) => setPickedCourseId(course?.id ?? null)}
                placeholder={communityId ? 'Course (optional)' : 'Choose a course'}
              />
            )}
            <TextInput
              value={topicDraft}
              onChangeText={setTopicDraft}
              placeholder="Topic (optional), e.g. cardiology"
              placeholderTextColor="#94a3b8"
              maxLength={80}
              className="mt-3 rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
              accessibilityLabel="Room topic"
            />
            <Pressable
              disabled={!canStart || starting}
              onPress={startRoom}
              accessibilityRole="button"
              accessibilityLabel="Join or create a room"
              accessibilityState={{ disabled: !canStart || starting, busy: starting }}
              className="mt-4 min-h-[44px] justify-center rounded-lg bg-lantern-primary px-4"
              style={{ opacity: !canStart || starting ? 0.6 : 1 }}
            >
              <Text className="text-center text-sm font-semibold text-white">
                {starting ? 'Opening…' : 'Join or create'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text className="text-sm text-lantern-text-secondary">
              {room.topic ? `Studying ${room.topic}` : 'Course study room'}
              {liveCount > 0 ? ` · ${liveCount} live` : ''}
            </Text>
            <Text className="mt-1 text-[11px] text-lantern-text-tertiary">
              {STUDY_ROOM_LIFETIME_COPY}
            </Text>
            {room.participants.map((p) => (
              <View key={p.userId} className="mt-2 rounded-lg border border-lantern-border px-3 py-2">
                <Text className="text-sm text-lantern-text">{p.name}</Text>
              </View>
            ))}
            <Pressable
              onPress={() => {
                if (!room) return;
                if (room.joined) {
                  void leaveStudyRoom(room.id).then(() => navigation.goBack());
                } else {
                  void joinStudyRoom(room.id).then(setRoom);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={room.joined ? 'Leave room' : 'Join room'}
              className="mt-4 min-h-[44px] justify-center rounded-lg bg-lantern-primary px-4"
            >
              <Text className="text-center text-sm font-semibold text-white">
                {room.joined ? 'Leave room' : 'Join room'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

export default StudyRoomScreen;

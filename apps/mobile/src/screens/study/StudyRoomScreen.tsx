import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { studyRoomPresenceChannel } from '@lantern/shared/network';
import { CoursePicker } from '../../components/CoursePicker';
import { HangoutChatPanel } from '../../components/HangoutChatPanel';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function StudyRoomScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: { roomId?: string; courseId?: string; topic?: string } };
}) {
  const user = useAuthStore((s) => s.user);
  const params = route?.params;
  const [room, setRoom] = useState<StudyRoomDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState(0);
  const [pickedCourseId, setPickedCourseId] = useState<string | null>(null);
  const [topicDraft, setTopicDraft] = useState('');
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (params?.roomId) {
        setRoom(await fetchStudyRoom(params.roomId));
        return;
      }
      if (params?.courseId) {
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
  }, [params?.roomId, params?.courseId, params?.topic]);

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

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="flex-row items-center gap-2 px-4 py-3 border-b border-lantern-border">
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" className="p-2">
          <Ionicons name="arrow-back" size={20} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold text-lantern-text" numberOfLines={1}>
          {room?.title || 'Study room'}
        </Text>
      </View>
      <ScrollView className="flex-1 px-4 py-4">
        {loading ? (
          <ActivityIndicator />
        ) : error ? (
          <Pressable onPress={() => void load()}>
            <Text className="text-sm text-lantern-error">{error} · Retry</Text>
          </Pressable>
        ) : !room ? (
          <View>
            <Text className="text-sm text-lantern-text-secondary mb-3">
              Pick a course. If a room is already open tonight, you land there.
            </Text>
            <CoursePicker
              value={pickedCourseId}
              onChange={(course) => setPickedCourseId(course?.id ?? null)}
              label="Course"
            />
            <TextInput
              value={topicDraft}
              onChangeText={setTopicDraft}
              placeholder="Topic (optional), e.g. cardiology"
              maxLength={80}
              className="mt-3 rounded-lg border border-lantern-border px-3 py-2 text-sm text-lantern-text"
            />
            <Pressable
              disabled={!pickedCourseId || starting}
              onPress={() => {
                if (!pickedCourseId || starting) return;
                setStarting(true);
                void joinOrCreateStudyRoom({
                  courseId: pickedCourseId,
                  topic: topicDraft.trim() || null,
                })
                  .then(setRoom)
                  .catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : 'Could not open a study room'),
                  )
                  .finally(() => setStarting(false));
              }}
              className="mt-4 rounded-lg bg-lantern-primary px-4 py-3"
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
            {room.joined && room.groupId ? (
              <View className="mt-4">
                <HangoutChatPanel
                  groupId={room.groupId}
                  title="Room chat"
                  onOpenInChats={() => {
                    navigation.navigate('ChatTab', {
                      screen: 'GroupChat',
                      params: { groupId: room.groupId, groupName: room.title },
                    });
                  }}
                />
              </View>
            ) : !room.joined ? (
              <Text className="mt-3 text-xs text-lantern-text-tertiary">
                Join the room to chat in the hangout.
              </Text>
            ) : null}
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
              className="mt-4 rounded-lg bg-lantern-primary px-4 py-3"
            >
              <Text className="text-center text-sm font-semibold text-white">
                {room.joined ? 'Leave room' : 'Join room'}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default StudyRoomScreen;

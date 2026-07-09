import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './ui';
import { searchUsers, fetchGroups } from '../services/api';
import {
  addNoteCollaborator,
  fetchNoteCollaborators,
  removeNoteCollaborator,
  shareNoteWithGroup,
} from '../services/notes';

interface Collaborator {
  noteId: string;
  userId: string;
  role: string;
  user?: { id: string; name?: string; avatarUrl?: string };
}

interface NoteCollaboratorsModalProps {
  visible: boolean;
  noteId: string;
  currentUserId?: string;
  onClose: () => void;
}

export function NoteCollaboratorsModal({
  visible,
  noteId,
  currentUserId,
  onClose,
}: NoteCollaboratorsModalProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [userQuery, setUserQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name?: string }>>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shareGroupId, setShareGroupId] = useState('');

  const load = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    try {
      const data = await fetchNoteCollaborators(noteId);
      setCollaborators(Array.isArray(data) ? data : []);
    } catch {
      setCollaborators([]);
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (visible) {
      void load();
      setUserQuery('');
      setSelectedUserId('');
      setShareGroupId('');
      if (currentUserId) {
        void fetchGroups(currentUserId).then((g) => {
          setGroups((g || []).map((group: { id: string; name: string }) => ({ id: group.id, name: group.name })));
        }).catch(() => setGroups([]));
      }
    }
  }, [visible, noteId, currentUserId, load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!userQuery.trim()) {
        setSuggestions([]);
        return;
      }
      void searchUsers(userQuery.trim(), 8)
        .then((users) => setSuggestions(users || []))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [userQuery]);

  const handleAdd = async () => {
    const target = selectedUserId || userQuery.trim();
    if (!target) return;
    setSaving(true);
    try {
      await addNoteCollaborator(noteId, target, 'editor');
      await load();
      setUserQuery('');
      setSelectedUserId('');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not add collaborator.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setSaving(true);
    try {
      await removeNoteCollaborator(noteId, userId);
      await load();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not remove collaborator.');
    } finally {
      setSaving(false);
    }
  };

  const handleShareGroup = async () => {
    if (!shareGroupId) return;
    setSaving(true);
    try {
      await shareNoteWithGroup(noteId, shareGroupId);
      Alert.alert('Shared', 'Note shared with group.');
      onClose();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not share note.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <View className="bg-white dark:bg-slate-900 rounded-t-2xl max-h-[85%]">
          <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
            <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100">Collaborators</Text>
            <Pressable onPress={onClose} className="p-2">
              <Ionicons name="close" size={22} color="#64748b" />
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="px-5 pb-8">
            {loading ? (
              <ActivityIndicator className="my-4" />
            ) : (
              collaborators.map((c) => (
                <View key={c.userId} className="flex-row items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                  <Text className="text-sm text-slate-800 dark:text-slate-200">
                    {c.user?.name || c.userId}
                  </Text>
                  {c.userId !== currentUserId ? (
                    <Pressable onPress={() => void handleRemove(c.userId)} disabled={saving}>
                      <Ionicons name="trash-outline" size={18} color="#ef4444" />
                    </Pressable>
                  ) : (
                    <Text className="text-xs text-slate-400">Owner</Text>
                  )}
                </View>
              ))
            )}

            <Text className="text-sm font-medium text-slate-800 dark:text-slate-200 mt-4 mb-2">Invite by username</Text>
            <TextInput
              value={userQuery}
              onChangeText={setUserQuery}
              placeholder="Search users..."
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mb-2 text-slate-900 dark:text-slate-100"
            />
            {suggestions.map((u) => (
              <Pressable
                key={u.id}
                onPress={() => {
                  setSelectedUserId(u.id);
                  setUserQuery(u.name || u.id);
                }}
                className="py-2"
              >
                <Text className="text-sm text-slate-700 dark:text-slate-300">{u.name || u.id}</Text>
              </Pressable>
            ))}
            <Button variant="primary" size="sm" loading={saving} onPress={() => void handleAdd()} className="mt-2 mb-4">
              Add collaborator
            </Button>

            {groups.length > 0 ? (
              <>
                <Text className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-2">Share to group</Text>
                {groups.map((g) => (
                  <Pressable
                    key={g.id}
                    onPress={() => setShareGroupId(g.id)}
                    className={`p-3 rounded-lg mb-1 ${shareGroupId === g.id ? 'bg-indigo-50 dark:bg-indigo-950/30' : ''}`}
                  >
                    <Text className="text-sm text-slate-800 dark:text-slate-200">{g.name}</Text>
                  </Pressable>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  loading={saving}
                  disabled={!shareGroupId}
                  onPress={() => void handleShareGroup()}
                  className="mt-2"
                >
                  Share with group
                </Button>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DeckCollaborator } from '@lantern/shared/types';
import * as api from '../services/api';
import { Button } from './ui';

interface SearchUser {
  id: string;
  name?: string;
  username?: string;
  email?: string;
}

function mapCollaborator(raw: Record<string, unknown>): DeckCollaborator {
  return {
    userId: String(raw.userId ?? raw.user_id ?? ''),
    role: (raw.role as DeckCollaborator['role']) || 'editor',
    addedAt: String(raw.addedAt ?? raw.added_at ?? new Date().toISOString()),
    profile: raw.profile as DeckCollaborator['profile'],
  };
}

interface CollaboratorsModalProps {
  visible: boolean;
  onClose: () => void;
  deckId: string;
  currentUserId?: string;
}

export default function CollaboratorsModal({
  visible,
  onClose,
  deckId,
  currentUserId,
}: CollaboratorsModalProps) {
  const [collaborators, setCollaborators] = useState<DeckCollaborator[]>([]);
  const [userQuery, setUserQuery] = useState('');
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRoleId] = useState<'viewer' | 'editor' | 'owner'>('editor');
  const [userSuggestions, setUserSuggestions] = useState<SearchUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const loadCollaborators = useCallback(async () => {
    if (!deckId) return;
    setIsLoading(true);
    try {
      const data = await api.fetchDeckCollaborators(deckId);
      setCollaborators((data || []).map(item => mapCollaborator(item as Record<string, unknown>)));
    } catch {
      setCollaborators([]);
    } finally {
      setIsLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    if (visible) {
      void loadCollaborators();
    }
  }, [visible, loadCollaborators]);

  useEffect(() => {
    if (!userQuery.trim() || userQuery.trim().length < 2) {
      setUserSuggestions([]);
      return;
    }

    setIsSearching(true);
    const timeoutId = setTimeout(async () => {
      try {
        const users = await api.searchUsers(userQuery.trim(), 10);
        setUserSuggestions(users || []);
      } catch {
        setUserSuggestions([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [userQuery]);

  const handleAdd = async () => {
    const targetId = newUserId.trim();
    if (!targetId) return;
    setIsSaving(true);
    try {
      const added = await api.addDeckCollaborator(deckId, targetId, newRole);
      setCollaborators(prev => [...prev, mapCollaborator(added as Record<string, unknown>)]);
      setNewUserId('');
      setUserQuery('');
      setUserSuggestions([]);
      setNewRoleId('editor');
    } catch {
      Alert.alert('Error', 'Failed to add collaborator.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = (userId: string) => {
    Alert.alert('Remove collaborator', 'Remove this collaborator from the deck?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.removeDeckCollaborator(deckId, userId);
            setCollaborators(prev => prev.filter(c => c.userId !== userId));
          } catch {
            Alert.alert('Error', 'Failed to remove collaborator.');
          }
        },
      },
    ]);
  };

  const roles: Array<'viewer' | 'editor' | 'owner'> = ['viewer', 'editor', 'owner'];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[85%] min-h-[50%]">
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <View className="flex-row items-center gap-2">
              <Ionicons name="people-outline" size={22} color="#6366f1" />
              <Text className="text-lg font-bold text-slate-900 dark:text-slate-100">Collaborators</Text>
            </View>
            <Pressable onPress={onClose} className="p-2">
              <Ionicons name="close" size={24} color="#94a3b8" />
            </Pressable>
          </View>

          <View className="px-5 pt-4">
            <TextInput
              value={userQuery}
              onChangeText={text => {
                setUserQuery(text);
                setNewUserId(text);
              }}
              placeholder="Search users by name or @username"
              placeholderTextColor="#94a3b8"
              className="border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 mb-2"
            />

            {isSearching ? <ActivityIndicator className="mb-2" color="#6366f1" /> : null}

            {userSuggestions.length > 0 ? (
              <View className="mb-3 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {userSuggestions.map(u => (
                  <Pressable
                    key={u.id}
                    onPress={() => {
                      setNewUserId(u.id);
                      setUserQuery(u.username ? `@${u.username}` : u.name || u.id);
                      setUserSuggestions([]);
                    }}
                    className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900"
                  >
                    <Text className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {u.name || u.username || u.id}
                    </Text>
                    {u.username ? (
                      <Text className="text-xs text-indigo-600 dark:text-indigo-400">@{u.username}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View className="flex-row flex-wrap gap-2 mb-3">
              {roles.map(role => (
                <Pressable
                  key={role}
                  onPress={() => setNewRoleId(role)}
                  className={`px-3 py-1.5 rounded-full border ${
                    newRole === role
                      ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-400'
                      : 'border-slate-200 dark:border-slate-600'
                  }`}
                >
                  <Text className="text-xs capitalize text-slate-700 dark:text-slate-300">{role}</Text>
                </Pressable>
              ))}
            </View>

            <Button size="sm" loading={isSaving} disabled={!newUserId.trim()} onPress={handleAdd}>
              Add collaborator
            </Button>
          </View>

          {isLoading ? (
            <ActivityIndicator className="py-8" color="#6366f1" />
          ) : (
            <FlatList
              data={collaborators}
              keyExtractor={item => item.userId}
              contentContainerClassName="px-5 py-4"
              ListEmptyComponent={
                <Text className="text-sm text-slate-500 dark:text-slate-400 py-4">No collaborators yet.</Text>
              }
              renderItem={({ item }) => (
                <View className="flex-row items-center justify-between p-3 mb-2 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <View className="flex-1 pr-3">
                    <Text className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {item.profile?.name || item.userId}
                    </Text>
                    <Text className="text-xs text-slate-500 capitalize">{item.role}</Text>
                  </View>
                  {item.userId !== currentUserId ? (
                    <Pressable onPress={() => handleRemove(item.userId)} className="p-2">
                      <Ionicons name="trash-outline" size={20} color="#ef4444" />
                    </Pressable>
                  ) : null}
                </View>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

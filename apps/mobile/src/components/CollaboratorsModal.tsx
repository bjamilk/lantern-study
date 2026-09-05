import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { DeckCollaborator } from '@lantern/shared/types';
import * as api from '../services/api';
import { Button } from './ui';
import { SCREEN_KEYBOARD_BEHAVIOR } from './layout';
import { AppIcon } from './ui/AppIcon';

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
  const insets = useSafeAreaInsets();
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
    if (userQuery.trim().replace(/^@+/, '').length < 2) {
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
      {/* The keyboard lands exactly where a bottom-anchored sheet sits, and on
          Android 15+ (this app targets SDK 36) the window is not resized, so
          the input and its confirm button were covered with no scroll range.
          Making the KeyboardAvoidingView the overlay lifts the sheet, and its
          max-height then resolves against the keyboard-free box. */}
      <KeyboardAvoidingView
        behavior={SCREEN_KEYBOARD_BEHAVIOR}
        className="flex-1 bg-black/50 justify-end"
      >
        <View className="bg-lantern-surface rounded-t-3xl max-h-[85%] min-h-[50%]" style={{ paddingBottom: insets.bottom + 8 }}>
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-lantern-border dark:border-lantern-border">
            <View className="flex-row items-center gap-2">
              <AppIcon name="people" size={22} color="#6366f1" />
              <Text className="text-lg font-bold text-lantern-text">Collaborators</Text>
            </View>
            <Pressable onPress={onClose} className="p-2">
              <AppIcon name="close" size={24} color="#94a3b8" />
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
              className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text bg-lantern-background-secondary mb-2"
            />

            {isSearching ? <ActivityIndicator className="mb-2" color="#6366f1" /> : null}

            {userSuggestions.length > 0 ? (
              <View className="mb-3 rounded-xl border border-lantern-border overflow-hidden">
                {userSuggestions.map(u => (
                  <Pressable
                    key={u.id}
                    onPress={() => {
                      setNewUserId(u.id);
                      setUserQuery(u.username ? `@${u.username}` : u.name || u.id);
                      setUserSuggestions([]);
                    }}
                    className="px-3 py-2.5 border-b border-lantern-border dark:border-lantern-border bg-lantern-surface"
                  >
                    <Text className="text-sm font-medium text-lantern-text">
                      {u.name || u.username || u.id}
                    </Text>
                    {u.username ? (
                      <Text className="text-xs text-lantern-primary">@{u.username}</Text>
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
                      ? 'bg-lantern-primary-background dark:bg-lantern-primary-dark/40 border-lantern-primary'
                      : 'border-lantern-border'
                  }`}
                >
                  <Text className="text-xs capitalize text-lantern-text">{role}</Text>
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
                <Text className="text-sm text-lantern-text-secondary py-4">No collaborators yet.</Text>
              }
              renderItem={({ item }) => (
                <View className="flex-row items-center justify-between p-3 mb-2 rounded-xl bg-lantern-background-secondary">
                  <View className="flex-1 pr-3">
                    <Text className="text-sm font-semibold text-lantern-text">
                      {item.profile?.name || item.userId}
                    </Text>
                    <Text className="text-xs text-lantern-text-secondary capitalize">{item.role}</Text>
                  </View>
                  {item.userId !== currentUserId ? (
                    <Pressable onPress={() => handleRemove(item.userId)} className="p-2">
                      <AppIcon name="trash" size={20} color="#ef4444" />
                    </Pressable>
                  ) : null}
                </View>
              )}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

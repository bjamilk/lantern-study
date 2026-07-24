import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { generateNoteShareLink } from '@lantern/shared';
import { Button } from './ui';
import { searchUsers } from '../services/api';
import {
  addNoteCollaborator,
  createNoteShareLink,
  fetchNoteCollaborators,
  fetchNoteShareLinks,
  removeNoteCollaborator,
  revokeNoteShareLink,
  updateNoteCollaboratorRole,
} from '../services/notes';

type Role = 'viewer' | 'editor';
type Collaborator = {
  noteId: string;
  userId: string;
  role: Role;
  user?: { id: string; name?: string; avatarUrl?: string };
};
type ShareLink = {
  id: string;
  token?: string;
  role: Role;
  createdAt?: string;
  expiresAt?: string | null;
  isActive?: boolean;
};

interface NoteCollaboratorsModalProps {
  visible: boolean;
  noteId: string;
  noteTitle?: string;
  currentUserId?: string;
  onClose: () => void;
}

export function NoteCollaboratorsModal({
  visible,
  noteId,
  noteTitle = 'this note',
  currentUserId,
  onClose,
}: NoteCollaboratorsModalProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [userQuery, setUserQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name?: string }>>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('viewer');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    try {
      const [nextCollaborators, nextLinks] = await Promise.all([
        fetchNoteCollaborators(noteId),
        fetchNoteShareLinks(noteId),
      ]);
      setCollaborators(Array.isArray(nextCollaborators) ? nextCollaborators : []);
      setShareLinks(
        Array.isArray(nextLinks) ? nextLinks.filter((link) => link.isActive !== false) : []
      );
    } catch (error) {
      setCollaborators([]);
      setShareLinks([]);
      Alert.alert('Could not load sharing', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (!visible) return;
    setUserQuery('');
    setSelectedUserId('');
    setInviteRole('viewer');
    setCopiedLinkId(null);
    void load();
  }, [visible, load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!userQuery.trim() || selectedUserId) {
        setSuggestions([]);
        return;
      }
      void searchUsers(userQuery.trim(), 8)
        .then((users) => setSuggestions(users || []))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [userQuery, selectedUserId]);

  const copyLink = async (link: ShareLink) => {
    if (!link.token) return;
    await Clipboard.setStringAsync(generateNoteShareLink(link.token));
    setCopiedLinkId(link.id);
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const handleCreateLink = async () => {
    setSaving(true);
    try {
      const link = (await createNoteShareLink(noteId, inviteRole)) as ShareLink;
      if (!link.token) throw new Error('The share link could not be created.');
      await copyLink(link);
      await Share.share({
        title: `Share ${noteTitle}`,
        message: `Open "${noteTitle}" in Lantern Study:\n${generateNoteShareLink(link.token)}`,
      });
      await load();
    } catch (error) {
      Alert.alert('Could not create link', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    const target = selectedUserId || userQuery.trim();
    if (!target) return;
    setSaving(true);
    try {
      await addNoteCollaborator(noteId, target, inviteRole);
      setUserQuery('');
      setSelectedUserId('');
      await load();
    } catch (error) {
      Alert.alert('Could not add collaborator', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (collaborator: Collaborator) => {
    const nextRole: Role = collaborator.role === 'viewer' ? 'editor' : 'viewer';
    setSaving(true);
    try {
      await updateNoteCollaboratorRole(noteId, collaborator.userId, nextRole);
      await load();
    } catch (error) {
      Alert.alert('Could not update role', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setSaving(true);
    try {
      await removeNoteCollaborator(noteId, userId);
      await load();
    } catch (error) {
      Alert.alert('Could not remove collaborator', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (linkId: string) => {
    setSaving(true);
    try {
      await revokeNoteShareLink(noteId, linkId);
      await load();
    } catch (error) {
      Alert.alert('Could not revoke link', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <View className="bg-lantern-surface rounded-t-2xl max-h-[88%]">
          <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
            <Text className="text-lg font-semibold text-lantern-text">Share note</Text>
            <Pressable onPress={onClose} className="p-2" accessibilityLabel="Close share note">
              <Ionicons name="close" size={22} color="#64748b" />
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="px-5 pb-8">
            <Text className="text-sm font-medium text-lantern-text mt-2 mb-2">Permission</Text>
            <View className="flex-row gap-2 mb-3">
              {(['viewer', 'editor'] as Role[]).map((role) => (
                <Pressable
                  key={role}
                  onPress={() => setInviteRole(role)}
                  className={`flex-1 rounded-lg border px-3 py-2 ${inviteRole === role ? 'border-lantern-primary bg-lantern-primary-background' : 'border-lantern-border'}`}
                >
                  <Text className={`text-center text-sm font-medium ${inviteRole === role ? 'text-lantern-primary' : 'text-lantern-text'}`}>
                    {role === 'viewer' ? 'Viewer' : 'Editor'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-xs text-lantern-text-secondary mb-3">
              Viewers can read. Editors can change note content.
            </Text>
            <Button size="sm" loading={saving} onPress={() => void handleCreateLink()}>
              Create, copy & share link
            </Button>

            <Text className="text-sm font-medium text-lantern-text mt-6 mb-2">Invite a collaborator</Text>
            <TextInput
              value={userQuery}
              onChangeText={(value) => {
                setUserQuery(value);
                setSelectedUserId('');
              }}
              placeholder="Search users..."
              autoCapitalize="none"
              className="border border-lantern-border rounded-lg px-3 py-2 mb-1 text-lantern-text"
            />
            {suggestions.map((user) => (
              <Pressable
                key={user.id}
                onPress={() => {
                  setSelectedUserId(user.id);
                  setUserQuery(user.name || user.id);
                  setSuggestions([]);
                }}
                className="py-2"
              >
                <Text className="text-sm text-lantern-text">{user.name || user.id}</Text>
              </Pressable>
            ))}
            <Button variant="secondary" size="sm" loading={saving} disabled={!userQuery.trim()} onPress={() => void handleAdd()} className="mt-2">
              Add {inviteRole}
            </Button>

            <Text className="text-sm font-medium text-lantern-text mt-6 mb-2">People with access</Text>
            {loading ? (
              <ActivityIndicator className="my-4" />
            ) : collaborators.length === 0 ? (
              <Text className="text-sm text-lantern-text-secondary">Only you have access.</Text>
            ) : (
              collaborators.map((collaborator) => (
                <View key={collaborator.userId} className="flex-row items-center justify-between py-3 border-b border-lantern-border">
                  <View className="flex-1">
                    <Text className="text-sm text-lantern-text">{collaborator.user?.name || collaborator.userId}</Text>
                    <Text className="text-xs text-lantern-text-secondary capitalize">{collaborator.role}</Text>
                  </View>
                  {collaborator.userId !== currentUserId ? (
                    <View className="flex-row items-center gap-3">
                      <Pressable onPress={() => void handleRoleChange(collaborator)} disabled={saving}>
                        <Text className="text-xs font-semibold text-lantern-primary">
                          Make {collaborator.role === 'viewer' ? 'editor' : 'viewer'}
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => void handleRemove(collaborator.userId)} disabled={saving} accessibilityLabel="Remove collaborator">
                        <Ionicons name="trash-outline" size={18} color="#ef4444" />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))
            )}

            <Text className="text-sm font-medium text-lantern-text mt-6 mb-2">Active links</Text>
            {!loading && shareLinks.length === 0 ? (
              <Text className="text-sm text-lantern-text-secondary">No active links.</Text>
            ) : (
              shareLinks.map((link) => (
                <View key={link.id} className="flex-row items-center justify-between py-3 border-b border-lantern-border">
                  <View className="flex-1">
                    <Text className="text-sm text-lantern-text capitalize">{link.role} link</Text>
                    <Text className="text-xs text-lantern-text-secondary">
                      {link.expiresAt ? `Expires ${new Date(link.expiresAt).toLocaleDateString()}` : 'No expiry'}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-3">
                    {link.token ? (
                      <Pressable onPress={() => void copyLink(link)} disabled={saving}>
                        <Text className="text-xs font-semibold text-lantern-primary">
                          {copiedLinkId === link.id ? 'Copied' : 'Copy'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => void handleRevoke(link.id)} disabled={saving} accessibilityLabel="Revoke share link">
                      <Ionicons name="close-circle-outline" size={20} color="#ef4444" />
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

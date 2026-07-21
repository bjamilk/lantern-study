import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuthStore } from '../../stores/authStore';
import { updateUserProfile, fetchUserProfile, uploadProfileAvatar } from '../../services/api';
import { supabase } from '../../services/supabase';
import { Button, Card, ScreenHeader } from '../../components/ui';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';

type NavigationProp = {
  goBack: () => void;
};

function guessContentType(uri: string, mimeType?: string | null): string {
  if (mimeType && mimeType.startsWith('image/')) return mimeType;
  const lower = uri.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export default function EditProfileScreen({ navigation }: { navigation: NavigationProp }) {
  const user = useAuthStore(s => s.user);

  const [name, setName] = useState(user?.user_metadata?.name || '');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      try {
        const profile = await fetchUserProfile(user.id);
        setName(profile.name || user.user_metadata?.name || '');
        setPhone(profile.phone || '');
        const stored =
          (profile as { avatar_url?: string; avatarUrl?: string }).avatar_url ||
          (profile as { avatarUrl?: string }).avatarUrl ||
          null;
        setAvatarUrl(stored);
        setPreviewUrl(null);
      } catch {
        setName(user.user_metadata?.name || '');
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id]);

  const handlePickAvatar = useCallback(async () => {
    if (!user?.id) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to change your avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploadingAvatar(true);
    try {
      const asset = result.assets[0];
      const contentType = guessContentType(asset.uri, asset.mimeType);
      let base64Data = asset.base64 || null;

      if (!base64Data && asset.uri) {
        base64Data = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
      }
      if (!base64Data) throw new Error('Could not read image');

      const uploaded = await uploadProfileAvatar(user.id, {
        fileName: asset.fileName || `avatar.${contentType === 'image/png' ? 'png' : 'jpg'}`,
        base64Data,
        contentType,
      });

      setAvatarUrl(uploaded.avatarUrl);
      setPreviewUrl(uploaded.url);
      await supabase.auth.updateUser({ data: { avatar_url: uploaded.avatarUrl } });
    } catch (e: unknown) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not update avatar');
    } finally {
      setUploadingAvatar(false);
    }
  }, [user?.id]);

  const handleRemoveAvatar = useCallback(async () => {
    if (!user?.id) return;
    setUploadingAvatar(true);
    try {
      await updateUserProfile(user.id, { avatar_url: null });
      setAvatarUrl(null);
      setPreviewUrl(null);
      await supabase.auth.updateUser({ data: { avatar_url: null } });
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not remove avatar');
    } finally {
      setUploadingAvatar(false);
    }
  }, [user?.id]);

  const handleSaveProfile = useCallback(async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await updateUserProfile(user.id, { name: name.trim(), phone: phone.trim() });
      await supabase.auth.updateUser({ data: { name: name.trim() } });
      Alert.alert('Saved', 'Profile updated successfully.');
      navigation.goBack();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }, [user?.id, name, phone, navigation]);

  const handleChangePassword = useCallback(async () => {
    if (!user?.email) return;
    if (newPassword.length < 6) {
      Alert.alert('Invalid password', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'New passwords do not match.');
      return;
    }

    setChangingPassword(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInError) {
        Alert.alert('Error', 'Current password is incorrect.');
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordSection(false);
      Alert.alert('Success', 'Password updated successfully.');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  }, [user?.email, currentPassword, newPassword, confirmPassword]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center">
        <ActivityIndicator size="large" color="#6366f1" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader
        title="Edit Profile"
        right={
          <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
            Cancel
          </Button>
        }
      />

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView className="flex-1 px-4" contentContainerClassName="pb-10" keyboardShouldPersistTaps="handled">
          <View className="items-center py-6">
            <Pressable onPress={() => void handlePickAvatar()} className="relative">
              <ResolvedAvatar
                name={name || user?.email || 'U'}
                uri={previewUrl || avatarUrl}
                size={96}
              />
              <View className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-lantern-surface dark:bg-lantern-surface-secondary border border-lantern-border items-center justify-center">
                {uploadingAvatar ? (
                  <ActivityIndicator size="small" color="#6366f1" />
                ) : (
                  <Ionicons name="camera" size={16} color="#6366f1" />
                )}
              </View>
            </Pressable>
            <Text className="text-xs text-lantern-text-secondary mt-2">Tap to change photo</Text>
            {avatarUrl || previewUrl ? (
              <Pressable onPress={() => void handleRemoveAvatar()} className="mt-2">
                <Text className="text-xs text-lantern-error">Remove photo</Text>
              </Pressable>
            ) : null}
          </View>

          <Card className="mb-4">
            <Text className="text-sm font-semibold text-lantern-text mb-3">Profile</Text>
            <Text className="text-xs text-lantern-text-secondary mb-1">Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="#94a3b8"
              className="border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface mb-3"
            />
            <Text className="text-xs text-lantern-text-secondary mb-1">Phone</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              className="border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface mb-1"
            />
            <Text className="text-xs text-lantern-text-tertiary mt-1">{user?.email}</Text>
          </Card>

          <Card className="mb-4">
            <Pressable onPress={() => setShowPasswordSection(v => !v)} className="flex-row items-center justify-between">
              <Text className="text-sm font-semibold text-lantern-text">Change password</Text>
              <Ionicons name={showPasswordSection ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" />
            </Pressable>
            {showPasswordSection ? (
              <View className="mt-3 gap-2">
                <TextInput
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Current password"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry
                  className="border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface"
                />
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="New password"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry
                  className="border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface"
                />
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm new password"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry
                  className="border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface"
                />
                <Button
                  size="sm"
                  loading={changingPassword}
                  disabled={!currentPassword || !newPassword}
                  onPress={() => void handleChangePassword()}
                >
                  Update password
                </Button>
              </View>
            ) : null}
          </Card>

          <Button fullWidth loading={saving} onPress={() => void handleSaveProfile()}>
            Save changes
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

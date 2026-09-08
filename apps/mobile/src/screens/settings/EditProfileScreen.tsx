import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../stores/authStore';
import { updateUserProfile, fetchUserProfile, uploadProfileAvatar } from '../../services/api';
import { supabase } from '../../services/supabase';
import { Button, Card, ScreenHeader } from '../../components/ui';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
};

export default function EditProfileScreen({ navigation }: { navigation: NavigationProp }) {
  const user = useAuthStore(s => s.user);
  // `pb-10` is 35px at this project's rem of 14 and the root dropped the bottom
  // edge, so half the Save button sat inside the system nav bar.
  const bottomPadding = useScreenBottomPadding();

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
      appAlert('Permission needed', 'Allow photo library access to change your avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: false,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploadingAvatar(true);
    try {
      const asset = result.assets[0];
      const { prepareImageBase64ForUpload } = await import('../../utils/prepareImage');
      const prepared = await prepareImageBase64ForUpload(asset.uri, 'avatar', {
        fileName: asset.fileName || 'avatar.jpg',
        mimeType: asset.mimeType,
      });

      const uploaded = await uploadProfileAvatar(user.id, {
        fileName: prepared.fileName,
        base64Data: prepared.base64Data,
        contentType: prepared.contentType,
      });

      setAvatarUrl(uploaded.avatarUrl);
      setPreviewUrl(uploaded.url);
      await supabase.auth.updateUser({ data: { avatar_url: uploaded.avatarUrl } });
    } catch (e: unknown) {
      appAlert('Upload failed', e instanceof Error ? e.message : 'Could not update avatar');
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
      appAlert('Error', e instanceof Error ? e.message : 'Could not remove avatar');
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
      appAlert('Saved', 'Profile updated successfully.');
      navigation.goBack();
    } catch (e: unknown) {
      appAlert('Error', e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }, [user?.id, name, phone, navigation]);

  const handleChangePassword = useCallback(async () => {
    if (!user?.email) return;
    if (newPassword.length < 6) {
      appAlert('Invalid password', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      appAlert('Mismatch', 'New passwords do not match.');
      return;
    }

    setChangingPassword(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInError) {
        appAlert('Error', 'Current password is incorrect.');
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordSection(false);
      appAlert('Success', 'Password updated successfully.');
    } catch (e: unknown) {
      appAlert('Error', e instanceof Error ? e.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  }, [user?.email, currentPassword, newPassword, confirmPassword]);

  if (loading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom="none" keyboard>
      <ScreenHeader
        title="Edit Profile"
        right={
          <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
            Cancel
          </Button>
        }
      />

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
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
                <AppIcon name="camera" size={16} color="#6366f1" />
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
            <AppIcon name={showPasswordSection ? 'chevron-up' : 'chevron-down'} size={18} color="#94a3b8" />
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
    </Screen>
  );
}

import React, { useState } from 'react';
import { TextInput, View, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '../ui';
import { useTheme } from '../../theme';

interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onAttachImage?: (uri: string, mimeType?: string | null) => Promise<void>;
  sending?: boolean;
  placeholder?: string;
}

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onAttachImage,
  sending = false,
  placeholder = 'Message...',
}: ChatComposerProps) {
  const { colors } = useTheme();
  const [attaching, setAttaching] = useState(false);

  const pickImage = async () => {
    if (!onAttachImage || attaching) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setAttaching(true);
    try {
      await onAttachImage(asset.uri, asset.mimeType);
    } finally {
      setAttaching(false);
    }
  };

  return (
    <View className="flex-row items-end gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      {onAttachImage ? (
        <Pressable
          onPress={() => void pickImage()}
          disabled={attaching || sending}
          className="p-2 mb-0.5"
          accessibilityLabel="Attach image"
        >
          {attaching ? (
            <ActivityIndicator size="small" color="#6366f1" />
          ) : (
            <Ionicons name="image-outline" size={24} color="#6366f1" />
          )}
        </Pressable>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inputPlaceholder}
        multiline
        className="flex-1 max-h-28 px-3 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100"
      />
      <Button size="sm" loading={sending} disabled={!value.trim()} onPress={onSend}>
        Send
      </Button>
    </View>
  );
}

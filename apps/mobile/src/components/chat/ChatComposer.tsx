import React from 'react';
import { TextInput, View } from 'react-native';
import { Button } from '../ui';
import { useTheme } from '../../theme';

interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  sending?: boolean;
  placeholder?: string;
}

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  sending = false,
  placeholder = 'Message...',
}: ChatComposerProps) {
  const { colors } = useTheme();

  return (
    <View className="flex-row items-end gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
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

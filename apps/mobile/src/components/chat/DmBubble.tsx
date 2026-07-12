import React from 'react';
import { Text, View } from 'react-native';
import { Avatar } from '../../components/ui';
import { useTheme } from '../../theme';

interface DmBubbleProps {
  message: { text: string; timestamp: string };
  isOwn: boolean;
  senderName?: string;
}

export function DmBubble({ message, isOwn, senderName }: DmBubbleProps) {
  const { colors } = useTheme();
  const timeLabel = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View className={`mb-3 flex-row gap-2 max-w-[92%] ${isOwn ? 'self-end' : 'self-start'}`}>
      {!isOwn ? <Avatar name={senderName || 'User'} size={28} /> : null}

      <View className={`flex-1 min-w-0 ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn && senderName ? (
          <Text className="text-xs font-semibold mb-1 ml-0.5" style={{ color: colors.primary }}>
            {senderName}
          </Text>
        ) : null}

        <View
          className={`px-3.5 py-2.5 rounded-2xl max-w-full shadow-sm ${
            isOwn ? 'rounded-br-md' : 'rounded-bl-md border border-lantern-border'
          }`}
          style={isOwn ? { backgroundColor: colors.primary } : { backgroundColor: colors.card }}
        >
          <Text
            className="text-sm leading-relaxed"
            style={{ color: isOwn ? colors.textInverse : colors.text }}
          >
            {message.text}
          </Text>
          <Text
            className="text-[10px] mt-1.5 text-right"
            style={{ color: isOwn ? '#c7d2fe' : colors.textTertiary }}
          >
            {timeLabel}
          </Text>
        </View>
      </View>

      {isOwn ? <View className="w-7" /> : null}
    </View>
  );
}

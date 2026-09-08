import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { appAlert } from '../ui/appDialog';
import { AppIcon } from '../ui/AppIcon';

interface ReceiptTicksProps {
  status?: 'sent' | 'read';
  seenByCount?: number;
  seenByTotal?: number;
  isGroupChat?: boolean;
  onPrimary?: boolean;
}

export function ReceiptTicks({
  status = 'sent',
  seenByCount,
  seenByTotal,
  isGroupChat,
  onPrimary,
}: ReceiptTicksProps) {
  const { colors } = useTheme();
  const isRead = status === 'read';
  const color = isRead ? '#38bdf8' : onPrimary ? 'rgba(255,255,255,0.7)' : colors.textTertiary;
  const label =
    isGroupChat && typeof seenByTotal === 'number'
      ? `Seen by ${seenByCount ?? 0} of ${seenByTotal}`
      : isRead
        ? 'Read'
        : 'Sent';

  const showSeenDetail =
    isGroupChat &&
    typeof seenByTotal === 'number' &&
    seenByTotal > 0 &&
    !isRead &&
    (seenByCount ?? 0) < seenByTotal;

  const handleLongPress = () => {
    if (!showSeenDetail) return;
    appAlert('Read receipts', label);
  };

  const icon = (
    // Label lives on whichever wrapper is announced (or nowhere, when the row
    // speaks the state) — never on the glyph itself.
    <AppIcon
      name={isRead ? 'checkmark-done' : 'checkmark'}
      size={14}
      color={color}
      importantForAccessibility="no"
    />
  );

  if (!showSeenDetail) {
    // Purely visual: the message row's accessibility label already speaks the
    // delivery state, so the bare tick was a duplicate TalkBack stop per message.
    return (
      <View
        className="ml-0.5"
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {icon}
      </View>
    );
  }

  return (
    <Pressable
      onLongPress={handleLongPress}
      delayLongPress={300}
      className="ml-0.5"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Double tap and hold for read receipt details"
    >
      {icon}
    </Pressable>
  );
}

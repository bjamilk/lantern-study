import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { getLegalPageUrl } from '@lantern/shared';

interface AIDisclaimerProps {
  compact?: boolean;
  textColor?: string;
  linkColor?: string;
}

export function AIDisclaimer({ compact, textColor = '#6b7280', linkColor = '#6366f1' }: AIDisclaimerProps) {
  const openPrivacy = () => void Linking.openURL(getLegalPageUrl('privacy'));

  return (
    <View style={styles.wrap}>
      <Text style={[styles.text, { color: textColor }]}>
        {compact
          ? 'AI-generated content may be inaccurate. Not professional advice.'
          : 'Content is AI-generated and may be inaccurate. It is not professional advice. Review before use. '}
        {!compact && (
          <Text style={[styles.link, { color: linkColor }]} onPress={openPrivacy}>
            Privacy Policy
          </Text>
        )}
      </Text>
    </View>
  );
}

export function AIGeneratedBadge({ backgroundColor = '#ede9fe', color = '#6d28d9' }: { backgroundColor?: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Text style={[styles.badgeText, { color }]}>AI</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 6 },
  text: { fontSize: 11, lineHeight: 16 },
  link: { textDecorationLine: 'underline' },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start' },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
});

export default AIDisclaimer;

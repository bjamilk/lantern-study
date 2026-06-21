import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  LEGAL_DOCUMENT_TITLES,
  getLegalDocumentContent,
  type LegalDocumentId,
} from '@lantern/shared';
import { MarkdownRenderer } from '@lantern/shared';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'LegalDocument'>;

export default function LegalDocumentScreen({ navigation, route }: Props) {
  const { document } = route.params;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const title = LEGAL_DOCUMENT_TITLES[document];
  const content = getLegalDocumentContent(document);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <MarkdownRenderer
          content={content}
          style={{ color: colors.text, fontSize: 14, lineHeight: 22 }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  scrollContent: { padding: 16, paddingBottom: 32 },
});

export type { LegalDocumentId };

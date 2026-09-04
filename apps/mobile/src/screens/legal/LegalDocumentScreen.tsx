import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  LEGAL_DOCUMENT_TITLES,
  getLegalDocumentContent,
  type LegalDocumentId,
} from '@lantern/shared';
import { MarkdownRenderer } from '@lantern/shared';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'LegalDocument'>;

export default function LegalDocumentScreen({ navigation, route }: Props) {
  const { document } = route.params;
  const { colors } = useTheme();
  // The screen owns the top inset (`Screen edges={['top']}`) and the bottom
  // clearance comes from the primitive: this is a root-stack route with no tab
  // bar, so it resolves to the system inset instead of the hardcoded 32.
  const bottomPadding = useScreenBottomPadding();
  const title = LEGAL_DOCUMENT_TITLES[document];
  const content = getLegalDocumentContent(document);

  return (
    <Screen
      edges={['top']}
      bottom="none"
      className="flex-1"
      style={{ backgroundColor: colors.background }}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding }]}>
        <MarkdownRenderer
          content={content}
          style={{ color: colors.text, fontSize: 14, lineHeight: 22 }}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  scrollContent: { padding: 16 },
});

export type { LegalDocumentId };

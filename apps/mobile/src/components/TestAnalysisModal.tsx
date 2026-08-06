// ===========================================
// Lantern Study Mobile - Test Analysis Modal
// Prefer navigating to TestAnalysisScreen instead — nested RN Modal inside
// a fullScreenModal (TestResults) often fails silently on React Native.
// ===========================================

import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RecentTest } from '../types/dashboardStats';
import { ThemeScope, useTheme } from '../theme';
import TestAnalysisContent from './TestAnalysisContent';

interface TestAnalysisModalProps {
  visible: boolean;
  onClose: () => void;
  test: RecentTest | null;
}

export default function TestAnalysisModal({ visible, onClose, test }: TestAnalysisModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (!visible || !test) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ThemeScope style={styles.overlay}>
        <View
          style={[
            styles.container,
            { backgroundColor: colors.card, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <TestAnalysisContent test={test} onClose={onClose} showHeader />
        </View>
      </ThemeScope>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    minHeight: '70%',
    overflow: 'hidden',
  },
});

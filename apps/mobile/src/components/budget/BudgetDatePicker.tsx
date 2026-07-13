import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeScope, useTheme } from '../../theme';

interface BudgetDatePickerProps {
  visible: boolean;
  date: Date;
  accentColor?: string;
  onSelect: (date: Date) => void;
  onClose: () => void;
}

export function BudgetDatePicker({
  visible,
  date,
  accentColor,
  onSelect,
  onClose,
}: BudgetDatePickerProps) {
  const { colors, isDark } = useTheme();
  const accent = accentColor ?? colors.primary;
  const [selectedDate, setSelectedDate] = useState(date);

  const changeDay = (delta: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + delta);
    if (newDate <= new Date()) {
      setSelectedDate(newDate);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <ThemeScope
        style={[
          styles.overlay,
          { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.45)' },
        ]}
      >
        <TouchableOpacity style={styles.overlayTouchable} onPress={onClose} activeOpacity={1}>
          <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation()}>
            <View style={[styles.modal, { backgroundColor: colors.card }]}>
              <Text style={[styles.title, { color: colors.text }]}>Select Date</Text>

              <View style={styles.controls}>
                <TouchableOpacity
                  style={[styles.arrow, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => changeDay(-1)}
                >
                  <Ionicons name="chevron-back" size={28} color={accent} />
                </TouchableOpacity>

                <View style={styles.dateDisplay}>
                  <Text style={[styles.day, { color: accent }]}>{selectedDate.getDate()}</Text>
                  <Text style={[styles.monthYear, { color: colors.textSecondary }]}>
                    {selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.arrow, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={() => changeDay(1)}
                  disabled={selectedDate.toDateString() === new Date().toDateString()}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={28}
                    color={
                      selectedDate.toDateString() === new Date().toDateString()
                        ? colors.border
                        : accent
                    }
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.quickButtons}>
                {['Today', 'Yesterday', '2 days ago'].map((label, idx) => {
                  const quickDate = new Date();
                  quickDate.setDate(quickDate.getDate() - idx);
                  const isActive = selectedDate.toDateString() === quickDate.toDateString();
                  return (
                    <TouchableOpacity
                      key={label}
                      style={[
                        styles.quickButton,
                        { backgroundColor: colors.backgroundSecondary },
                        isActive && { backgroundColor: accent },
                      ]}
                      onPress={() => setSelectedDate(quickDate)}
                    >
                      <Text
                        style={[
                          styles.quickText,
                          { color: colors.textSecondary },
                          isActive && { color: colors.textInverse, fontWeight: '600' },
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.cancelButton, { backgroundColor: colors.backgroundSecondary }]}
                  onPress={onClose}
                >
                  <Text style={[styles.cancelText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, { backgroundColor: accent }]}
                  onPress={() => {
                    onSelect(selectedDate);
                    onClose();
                  }}
                >
                  <Text style={[styles.confirmText, { color: colors.textInverse }]}>Confirm</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </ThemeScope>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTouchable: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    borderRadius: 16,
    padding: 24,
    width: '85%',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  arrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateDisplay: {
    alignItems: 'center',
  },
  day: {
    fontSize: 48,
    fontWeight: 'bold',
  },
  monthYear: {
    fontSize: 16,
  },
  quickButtons: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  quickButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  quickText: {
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

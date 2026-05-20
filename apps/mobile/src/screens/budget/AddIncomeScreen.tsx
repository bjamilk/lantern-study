// ===========================================
// Lantern Study Mobile - Add Income Screen
// ===========================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBudgetStore, INCOME_CATEGORIES } from '../../stores/budgetStore';
import { useTheme } from '../../theme';

// Simple date picker component
const SimpleDatePicker: React.FC<{
  visible: boolean;
  date: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}> = ({ visible, date, onSelect, onClose }) => {
  const [selectedDate, setSelectedDate] = useState(date);

  const changeDay = (delta: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + delta);
    if (newDate <= new Date()) {
      setSelectedDate(newDate);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity style={styles.modalOverlay} onPress={onClose} activeOpacity={1}>
        <View style={styles.datePickerModal}>
          <Text style={styles.datePickerTitle}>Select Date</Text>
          
          <View style={styles.datePickerControls}>
            <TouchableOpacity 
              style={styles.dateArrow}
              onPress={() => changeDay(-1)}
            >
              <Ionicons name="chevron-back" size={28} color="#22c55e" />
            </TouchableOpacity>
            
            <View style={styles.dateDisplay}>
              <Text style={styles.dateDay}>{selectedDate.getDate()}</Text>
              <Text style={styles.dateMonthYear}>
                {selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </Text>
            </View>
            
            <TouchableOpacity 
              style={styles.dateArrow}
              onPress={() => changeDay(1)}
              disabled={selectedDate.toDateString() === new Date().toDateString()}
            >
              <Ionicons 
                name="chevron-forward" 
                size={28} 
                color={selectedDate.toDateString() === new Date().toDateString() ? '#334155' : '#22c55e'} 
              />
            </TouchableOpacity>
          </View>

          <View style={styles.dateQuickButtons}>
            {['Today', 'Yesterday', '2 days ago'].map((label, idx) => {
              const quickDate = new Date();
              quickDate.setDate(quickDate.getDate() - idx);
              return (
                <TouchableOpacity
                  key={label}
                  style={[
                    styles.quickDateButton,
                    selectedDate.toDateString() === quickDate.toDateString() && styles.quickDateButtonActive
                  ]}
                  onPress={() => setSelectedDate(quickDate)}
                >
                  <Text style={[
                    styles.quickDateText,
                    selectedDate.toDateString() === quickDate.toDateString() && styles.quickDateTextActive
                  ]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.datePickerActions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.confirmButton}
              onPress={() => { onSelect(selectedDate); onClose(); }}
            >
              <Text style={styles.confirmButtonText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

export default function AddIncomeScreen() {
  const navigation = useNavigation<any>();
  const { addTransaction, isLoading } = useBudgetStore();

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(INCOME_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const formatAmountInput = (value: string) => {
    const numericValue = value.replace(/[^0-9.]/g, '');
    const parts = numericValue.split('.');
    if (parts.length > 2) return amount;
    if (parts[1] && parts[1].length > 2) return amount;
    return numericValue;
  };

  const handleSubmit = useCallback(async () => {
    const amountNum = parseFloat(amount);
    
    if (!amount || amountNum <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid positive amount.');
      return;
    }

    if (!description.trim()) {
      Alert.alert('Missing Description', 'Please enter a description for this income.');
      return;
    }

    try {
      await addTransaction({
        userId: 'demo-user',
        type: 'INCOME',
        amount: amountNum,
        category,
        description: description.trim(),
        date: date.toISOString().split('T')[0],
      });

      Alert.alert('Success', 'Income added successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to add income. Please try again.');
    }
  }, [amount, category, description, date, addTransaction, navigation]);

  const getCategoryIcon = (cat: string): keyof typeof Ionicons.glyphMap => {
    const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
      'Salary': 'cash',
      'Freelance': 'laptop',
      'Investment': 'trending-up',
      'Gift': 'gift',
      'Allowance': 'wallet',
      'Other': 'ellipsis-horizontal',
    };
    return iconMap[cat] || 'help-circle';
  };

  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Add Income</Text>
        <TouchableOpacity
          style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Amount Input */}
          <View style={styles.amountSection}>
            <Text style={[styles.amountLabel, { color: colors.textSecondary }]}>Amount</Text>
            <View style={[styles.amountInputContainer, { backgroundColor: colors.card }]}>
              <Text style={styles.currencySymbol}>₦</Text>
              <TextInput
                style={[styles.amountInput, { color: colors.text }]}
                placeholder="0.00"
                placeholderTextColor={colors.textSecondary}
                value={amount}
                onChangeText={(val) => setAmount(formatAmountInput(val))}
                keyboardType="decimal-pad"
                autoFocus
              />
            </View>
          </View>

          {/* Category Selection */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Source / Category</Text>
            <View style={styles.categoryGrid}>
              {INCOME_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.categoryItem,
                    { backgroundColor: colors.card },
                    category === cat && styles.categoryItemActive,
                  ]}
                  onPress={() => setCategory(cat)}
                >
                  <View
                    style={[
                      styles.categoryIcon,
                      category === cat && styles.categoryIconActive,
                    ]}
                  >
                    <Ionicons
                      name={getCategoryIcon(cat)}
                      size={24}
                      color={category === cat ? '#ffffff' : '#22c55e'}
                    />
                  </View>
                  <Text
                    style={[
                      styles.categoryName,
                      { color: colors.textSecondary },
                      category === cat && styles.categoryNameActive,
                    ]}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Description</Text>
            <TextInput
              style={[styles.textInput, { backgroundColor: colors.card, color: colors.text }]}
              placeholder="What is this income from?"
              placeholderTextColor={colors.textSecondary}
              value={description}
              onChangeText={setDescription}
            />
          </View>

          {/* Date */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Date</Text>
            <TouchableOpacity
              style={[styles.dateButton, { backgroundColor: colors.card }]}
              onPress={() => setShowDatePicker(true)}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.dateText, { color: colors.text }]}>
                {date.toLocaleDateString('en-NG', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <SimpleDatePicker
            visible={showDatePicker}
            date={date}
            onSelect={setDate}
            onClose={() => setShowDatePicker(false)}
          />

          {/* Bottom spacing */}
          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  saveButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  saveButtonDisabled: {
    backgroundColor: '#334155',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  amountSection: {
    alignItems: 'center',
    paddingVertical: 32,
    marginBottom: 24,
  },
  amountLabel: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 8,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencySymbol: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#22c55e',
    marginRight: 4,
  },
  amountInput: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    minWidth: 100,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryItem: {
    width: '30%',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  categoryItemActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryIconActive: {
    backgroundColor: '#22c55e',
  },
  categoryName: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
  },
  categoryNameActive: {
    color: '#22c55e',
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#ffffff',
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  dateText: {
    flex: 1,
    fontSize: 15,
    color: '#ffffff',
  },
  // Date Picker Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  datePickerModal: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    alignItems: 'center',
  },
  datePickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 20,
  },
  datePickerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  dateArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateDisplay: {
    alignItems: 'center',
  },
  dateDay: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#22c55e',
  },
  dateMonthYear: {
    fontSize: 16,
    color: '#94a3b8',
  },
  dateQuickButtons: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  quickDateButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#0f172a',
  },
  quickDateButtonActive: {
    backgroundColor: '#22c55e',
  },
  quickDateText: {
    fontSize: 14,
    color: '#94a3b8',
  },
  quickDateTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  datePickerActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94a3b8',
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#22c55e',
    alignItems: 'center',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});

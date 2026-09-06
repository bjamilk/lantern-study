// ===========================================
import { toDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
// Lantern Study Mobile - Add Expense Screen
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBudgetStore, EXPENSE_CATEGORIES } from '../../stores/budgetStore';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { BudgetDatePicker } from '../../components/budget/BudgetDatePicker';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { AppIcon } from '../../components/ui/AppIcon';

export default function AddExpenseScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { addTransaction, isLoading } = useBudgetStore();

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0].id);
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

    // Description is optional — fall back to the category label.
    const selected = EXPENSE_CATEGORIES.find(c => c.id === category);
    try {
      await addTransaction({
        userId,
        type: 'EXPENSE',
        amount: amountNum,
        category,
        description: description.trim() || selected?.label || 'Expense',
        date: toDateOnlyLocal(date),
      });
      // Save silently and return — no blocking "Success" OK-tap between entries.
      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', 'Failed to add expense. Please try again.');
    }
  }, [amount, category, description, date, addTransaction, navigation, userId]);

  const { colors } = useTheme();
  // Replaces the hand-typed `<View style={{ height: 100 }} />` spacer: 100 is
  // short of the tab bar's real height on a 3-button-nav device.
  const bottomPadding = useScreenBottomPadding();

  return (
    <Screen keyboard bottom="none" className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.closeButton, { backgroundColor: colors.backgroundSecondary }]}
          onPress={() => navigation.goBack()}
        >
          <AppIcon name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Add Expense</Text>
        <TouchableOpacity
          style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.keyboardView}
        // Padding belongs on the content container, never on the ScrollView's
        // own style — vertical padding there clips the scrollable extent on
        // Android.
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Category</Text>
          <View style={styles.categoryGrid}>
            {EXPENSE_CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryItem,
                  { backgroundColor: colors.card },
                  category === cat.id && styles.categoryItemActive,
                ]}
                onPress={() => setCategory(cat.id)}
              >
                <View
                  style={[
                    styles.categoryIcon,
                    category === cat.id && styles.categoryIconActive,
                  ]}
                >
                  <Text style={{ fontSize: 18 }}>{cat.icon}</Text>
                </View>
                <Text
                  style={[
                    styles.categoryName,
                    { color: colors.textSecondary },
                    category === cat.id && styles.categoryNameActive,
                  ]}
                  numberOfLines={2}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Description (optional)</Text>
          <TextInput
            style={[styles.textInput, { backgroundColor: colors.card, color: colors.text }]}
            placeholder="What did you spend on?"
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
            <AppIcon name="calendar" size={20} color={colors.textSecondary} />
            <Text style={[styles.dateText, { color: colors.text }]}>
              {date.toLocaleDateString('en-NG', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
            <AppIcon name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <BudgetDatePicker
          visible={showDatePicker}
          date={date}
          accentColor="#ef4444"
          onSelect={setDate}
          onClose={() => setShowDatePicker(false)}
        />
      </ScrollView>
    </Screen>
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
    backgroundColor: '#ef4444',
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
    color: '#ef4444',
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
    gap: 10,
  },
  categoryItem: {
    width: '23%',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  categoryItemActive: {
    borderColor: '#ef4444',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  categoryIconActive: {
    backgroundColor: '#ef4444',
  },
  categoryName: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'center',
  },
  categoryNameActive: {
    color: '#ef4444',
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
  },
});

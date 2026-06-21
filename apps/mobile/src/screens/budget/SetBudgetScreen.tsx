// ===========================================
// Lantern Study Mobile - Set Budget Screen
// ===========================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBudgetStore, formatCurrency } from '../../stores/budgetStore';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';

export default function SetBudgetScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { budget, setBudget, isLoading } = useBudgetStore();
  const { colors } = useTheme();

  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (budget?.targetAmount) {
      setAmount(budget.targetAmount.toString());
    }
  }, [budget]);

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
      Alert.alert('Invalid Amount', 'Please enter a valid positive amount for your budget.');
      return;
    }

    try {
      await setBudget(userId, amountNum);
      Alert.alert('Success', 'Budget saved successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to save budget. Please try again.');
    }
  }, [amount, setBudget, navigation]);

  const currentMonth = new Date().toLocaleDateString('en-NG', {
    month: 'long',
    year: 'numeric',
  });

  const suggestedAmounts = [50000, 100000, 150000, 200000, 300000, 500000];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {budget ? 'Edit Budget' : 'Set Budget'}
        </Text>
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
        <View style={styles.content}>
          {/* Month Display */}
          <View style={[styles.monthContainer, { backgroundColor: colors.card }]}>
            <Ionicons name="calendar" size={20} color="#6366f1" />
            <Text style={[styles.monthText, { color: colors.text }]}>{currentMonth}</Text>
          </View>

          {/* Amount Input */}
          <View style={styles.amountSection}>
            <Text style={[styles.amountLabel, { color: colors.textSecondary }]}>Monthly Budget</Text>
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
            <Text style={[styles.amountHint, { color: colors.textSecondary }]}>
              Set a spending limit for this month
            </Text>
          </View>

          {/* Quick Amount Suggestions */}
          <View style={styles.suggestionsSection}>
            <Text style={[styles.suggestionsTitle, { color: colors.text }]}>Quick Select</Text>
            <View style={styles.suggestionsGrid}>
              {suggestedAmounts.map(suggestedAmount => (
                <TouchableOpacity
                  key={suggestedAmount}
                  style={[
                    styles.suggestionChip,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    parseFloat(amount) === suggestedAmount && styles.suggestionChipActive,
                  ]}
                  onPress={() => setAmount(suggestedAmount.toString())}
                >
                  <Text
                    style={[
                      styles.suggestionText,
                      { color: colors.textSecondary },
                      parseFloat(amount) === suggestedAmount && styles.suggestionTextActive,
                    ]}
                  >
                    {formatCurrency(suggestedAmount)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Info Card */}
          <View style={[styles.infoCard, { backgroundColor: colors.card }]}>
            <Ionicons name="information-circle" size={24} color="#6366f1" />
            <View style={styles.infoContent}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>How budgets work</Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                Your budget helps you track spending. When you add expenses, 
                we'll show you how much of your budget you've used and alert 
                you when you're approaching your limit.
              </Text>
            </View>
          </View>
        </View>
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
    backgroundColor: '#6366f1',
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
  monthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  monthText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6366f1',
  },
  amountSection: {
    alignItems: 'center',
    marginBottom: 40,
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
    color: '#6366f1',
    marginRight: 4,
  },
  amountInput: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    minWidth: 120,
    textAlign: 'center',
  },
  amountHint: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 12,
  },
  suggestionsSection: {
    marginBottom: 32,
  },
  suggestionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  suggestionChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  suggestionChipActive: {
    backgroundColor: '#6366f120',
    borderColor: '#6366f1',
  },
  suggestionText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  suggestionTextActive: {
    color: '#6366f1',
    fontWeight: '600',
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
  },
});

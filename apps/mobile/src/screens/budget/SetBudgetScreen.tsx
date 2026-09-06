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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScrollView } from 'react-native';
import {
  useBudgetStore,
  formatCurrency,
  INCOME_CATEGORIES,
} from '../../stores/budgetStore';
import { summarizeBudgetPlan } from '@lantern/shared/utils';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { AppIcon } from '../../components/ui/AppIcon';

export default function SetBudgetScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { budget, setBudget, setBudgetPlan, isLoading } = useBudgetStore();
  const { colors } = useTheme();
  // `paddingBottom: 48` did not clear the absolute bottom tab bar; this does,
  // and it tracks the device's own inset.
  const bottomPadding = useScreenBottomPadding();

  const [amount, setAmount] = useState('');
  // Planned income per category and a savings allocation — the half that turns a
  // spending cap into a plan you can balance.
  const [income, setIncome] = useState<Record<string, string>>({});
  const [savings, setSavings] = useState('');

  useEffect(() => {
    if (budget?.monthlyLimit) {
      setAmount(budget.monthlyLimit.toString());
    }
    if (budget?.plannedIncome) {
      setIncome(
        Object.fromEntries(
          Object.entries(budget.plannedIncome).map(([k, v]) => [k, String(v)])
        )
      );
    }
    if (budget?.plannedSavings) {
      setSavings(String(budget.plannedSavings));
    }
  }, [budget]);

  const toNumber = (value: string) => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const plannedIncome = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(income)) {
      const n = toNumber(value);
      if (n > 0) out[key] = n;
    }
    return out;
  }, [income]);

  const planSummary = React.useMemo(
    () =>
      summarizeBudgetPlan({
        monthYear: budget?.month ?? new Date().toISOString().slice(0, 7),
        monthlyLimit: toNumber(amount),
        plannedExpenses: budget?.categoryBudgets ?? {},
        plannedIncome,
        plannedSavings: toNumber(savings),
      }),
    [amount, savings, plannedIncome, budget?.categoryBudgets, budget?.month]
  );

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
      await setBudgetPlan(userId, {
        plannedIncome,
        plannedSavings: toNumber(savings),
      });
      Alert.alert('Success', 'Budget saved successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to save budget. Please try again.');
    }
  }, [amount, setBudget, setBudgetPlan, userId, plannedIncome, savings, navigation]);

  const currentMonth = new Date().toLocaleDateString('en-NG', {
    month: 'long',
    year: 'numeric',
  });

  const suggestedAmounts = [50000, 100000, 150000, 200000, 300000, 500000];

  return (
    <Screen keyboard bottom="none" className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <AppIcon name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {budget ? 'Edit Budget' : 'Set Budget'}
        </Text>
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primaryFill }, isLoading && styles.saveButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.keyboardView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Month Display */}
        <View style={[styles.monthContainer, { backgroundColor: colors.card }]}>
          <AppIcon name="calendar" size={20} color="#6366f1" />
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

        {/* Planned income — without it there is nothing to balance against. */}
        <View style={styles.planSection}>
          <Text style={[styles.suggestionsTitle, { color: colors.text }]}>
            Expected income
          </Text>
          <Text style={[styles.amountHint, { color: colors.textSecondary }]}>
            What you expect to receive this month. Leave a row blank if it does
            not apply.
          </Text>
          {INCOME_CATEGORIES.map(cat => (
            <View
              key={cat.id}
              style={[styles.planRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.planRowLabel, { color: colors.text }]} numberOfLines={1}>
                {cat.icon}  {cat.label}
              </Text>
              <View style={styles.planRowInputWrap}>
                <Text style={[styles.planRowCurrency, { color: colors.textSecondary }]}>₦</Text>
                <TextInput
                  style={[styles.planRowInput, { color: colors.text }]}
                  placeholder="0"
                  placeholderTextColor={colors.textSecondary}
                  value={income[cat.id] ?? ''}
                  onChangeText={val =>
                    setIncome(prev => ({ ...prev, [cat.id]: val.replace(/[^0-9.]/g, '') }))
                  }
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          ))}
        </View>

        {/* Savings as a planned allocation, competing with expenses. */}
        <View style={styles.planSection}>
          <Text style={[styles.suggestionsTitle, { color: colors.text }]}>
            Planned savings
          </Text>
          <View style={[styles.amountInputContainer, { backgroundColor: colors.card }]}>
            <Text style={styles.currencySymbol}>₦</Text>
            <TextInput
              style={[styles.amountInput, { color: colors.text }]}
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
              value={savings}
              onChangeText={val => setSavings(val.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
            />
          </View>
          <Text style={[styles.amountHint, { color: colors.textSecondary }]}>
            Set aside first, rather than hoping for leftovers
          </Text>
        </View>

        {/* The zero-based check, live as you type. */}
        {planSummary.totalPlannedIncome > 0 && (
          <View
            style={[
              styles.balanceCard,
              {
                backgroundColor: planSummary.isBalanced ? '#22c55e18' : colors.card,
                borderColor: planSummary.isBalanced ? '#22c55e' : colors.border,
              },
            ]}
          >
            <Text style={[styles.balanceLabel, { color: colors.textSecondary }]}>
              {planSummary.isBalanced
                ? 'Balanced — every naira has a job'
                : planSummary.leftToAllocate > 0
                  ? 'Left to allocate'
                  : 'Over-committed by'}
            </Text>
            <Text
              style={[
                styles.balanceValue,
                {
                  color: planSummary.isBalanced
                    ? '#22c55e'
                    : planSummary.leftToAllocate > 0
                      ? colors.text
                      : '#ef4444',
                },
              ]}
            >
              {planSummary.isBalanced
                ? '✓'
                : formatCurrency(Math.abs(Math.round(planSummary.leftToAllocate)))}
            </Text>
            <Text style={[styles.balanceHint, { color: colors.textSecondary }]}>
              {formatCurrency(planSummary.totalPlannedIncome)} income −{' '}
              {formatCurrency(planSummary.totalPlannedExpenses)} expenses −{' '}
              {formatCurrency(planSummary.plannedSavings)} savings
            </Text>
          </View>
        )}

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
          <AppIcon name="information-circle" size={24} color="#6366f1" />
          <View style={styles.infoContent}>
            <Text style={[styles.infoTitle, { color: colors.text }]}>How budgets work</Text>
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              Your budget helps you track spending. When you add expenses, 
              we'll show you how much of your budget you've used and alert 
              you when you're approaching your limit.
            </Text>
          </View>
        </View>
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
  // flexGrow, not flex: as a contentContainerStyle, `flex: 1` pins the content
  // to the viewport height and the form silently refuses to scroll — which hid
  // the savings input and the balance card below the fold.
  scrollContent: {
    flexGrow: 1,
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
  planSection: {
    marginBottom: 24,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    gap: 8,
  },
  planRowLabel: {
    fontSize: 13,
    flexShrink: 1,
    flexGrow: 1,
  },
  planRowInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 110,
  },
  planRowCurrency: {
    fontSize: 14,
    marginRight: 2,
  },
  planRowInput: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    paddingVertical: 4,
    textAlign: 'right',
  },
  balanceCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  balanceValue: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: 4,
  },
  balanceHint: {
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
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

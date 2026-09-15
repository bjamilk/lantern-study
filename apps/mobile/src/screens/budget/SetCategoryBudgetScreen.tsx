/**
 * Budget stack -> SetCategoryBudget. Per-category monthly limits, edited as a
 * single list and saved together.
 *
 * Exports: SetCategoryBudgetScreen (default).
 * Touches: budgetStore budget / fetchBudget / setBudget; authStore user id.
 * Gotcha: setBudget's second argument is the overall monthly cap. This screen
 * re-sends the existing budget.monthlyLimit unchanged; passing the sum of the
 * category budgets there would silently replace the student's real cap.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput } from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { useBudgetStore, EXPENSE_CATEGORIES, formatCurrency } from '../../stores/budgetStore';
import { ScreenHeader, Button, Card } from '../../components/ui';
import { Screen, useScreenBottomPadding } from '../../components/layout';

export default function SetCategoryBudgetScreen() {
  const navigation = useNavigation<any>();
  // The bottom tab bar is an absolute overlay on every Budget-stack screen, so
  // the only save control on this page needs its clearance, not a `pb-8`.
  const bottomPadding = useScreenBottomPadding();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { budget, fetchBudget, setBudget } = useBudgetStore();
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (userId) void fetchBudget(userId);
  }, [userId, fetchBudget]);

  useEffect(() => {
    if (budget?.categoryBudgets) {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(budget.categoryBudgets)) {
        next[k] = String(v);
      }
      setAmounts(next);
    }
  }, [budget?.categoryBudgets]);

  const save = async () => {
    const categoryBudgets: Record<string, number> = {};
    for (const cat of EXPENSE_CATEGORIES) {
      const n = parseFloat(amounts[cat.id] || '0');
      if (n > 0) categoryBudgets[cat.id] = n;
    }
    const total = Object.values(categoryBudgets).reduce((s, v) => s + v, 0);
    if (total <= 0) {
      appAlert('Enter at least one category budget');
      return;
    }
    // Preserve the overall monthly cap — do NOT overwrite it with the sum of the
    // category budgets. setBudget's 2nd arg is the monthlyLimit; passing `total`
    // silently replaced the user's real cap (e.g. a ₦50,000 limit) with the much
    // smaller category sum. Category budgets sit *within* the cap, they don't
    // define it. (Matches web SetMonthlyPlanModal, which only edits categories.)
    await setBudget(userId, budget?.monthlyLimit ?? 0, categoryBudgets);
    appAlert('Saved', 'Category budgets updated.');
    navigation.goBack();
  };

  return (
    <Screen bottom="none" keyboard>
      <ScreenHeader title="Category budgets" onBack={() => navigation.goBack()} subtitle="Monthly limits per category" />
      <ScrollView
        contentContainerClassName="px-4 gap-3"
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        {EXPENSE_CATEGORIES.map(cat => (
          <Card key={cat.id} className="p-3 flex-row items-center gap-3">
            <Text className="text-lg">{cat.icon}</Text>
            <Text className="flex-1 font-medium text-lantern-text">{cat.label}</Text>
            <TextInput
              value={amounts[cat.id] || ''}
              onChangeText={v => setAmounts(prev => ({ ...prev, [cat.id]: v }))}
              placeholder="₦0"
              keyboardType="decimal-pad"
              placeholderTextColor="#94a3b8"
              className="w-24 border border-lantern-border rounded-lg px-3 py-2 text-right text-lantern-text dark:text-white"
            />
          </Card>
        ))}
        <Button onPress={() => void save()}>Save category plan</Button>
        {budget?.monthlyLimit ? (
          <Text className="text-center text-xs text-lantern-text-secondary">Overall budget: {formatCurrency(budget.monthlyLimit)}</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { useBudgetStore, EXPENSE_CATEGORIES, formatCurrency } from '../../stores/budgetStore';
import { ScreenHeader, Button, Card } from '../../components/ui';

export default function SetCategoryBudgetScreen() {
  const navigation = useNavigation<any>();
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
      Alert.alert('Enter at least one category budget');
      return;
    }
    await setBudget(userId, total, categoryBudgets);
    Alert.alert('Saved', 'Category budgets updated.');
    navigation.goBack();
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <ScreenHeader title="Category budgets" onBack={() => navigation.goBack()} subtitle="Monthly limits per category" />
      <ScrollView contentContainerClassName="px-4 pb-8 gap-3">
        {EXPENSE_CATEGORIES.map(cat => (
          <Card key={cat.id} className="p-3 flex-row items-center gap-3">
            <Text className="text-lg">{cat.icon}</Text>
            <Text className="flex-1 font-medium text-slate-800 dark:text-slate-200">{cat.label}</Text>
            <TextInput
              value={amounts[cat.id] || ''}
              onChangeText={v => setAmounts(prev => ({ ...prev, [cat.id]: v }))}
              placeholder="₦0"
              keyboardType="decimal-pad"
              placeholderTextColor="#94a3b8"
              className="w-24 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-right text-slate-900 dark:text-white"
            />
          </Card>
        ))}
        <Button onPress={() => void save()}>Save category plan</Button>
        {budget?.targetAmount ? (
          <Text className="text-center text-xs text-slate-500">Overall budget: {formatCurrency(budget.targetAmount)}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

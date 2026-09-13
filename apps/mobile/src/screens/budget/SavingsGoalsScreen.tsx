import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, TouchableOpacity } from 'react-native';
import { appAlert, confirmAsync } from '../../components/ui/appDialog';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { useBudgetStore, formatCurrency, type SavingsGoal } from '../../stores/budgetStore';
import { ScreenHeader, Button, Card } from '../../components/ui';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { BudgetDatePicker } from '../../components/budget/BudgetDatePicker';
import { formatBudgetDate } from './budgetFormat';
import { AppIcon } from '../../components/ui/AppIcon';
import { brand } from '../../theme';

const GOAL_ICONS = ['🎯', '📱', '💻', '📚', '✈️', '🏠', '🚗', '👕', '🎓', '💰', '🎁', '⚽'];

export default function SavingsGoalsScreen() {
  const navigation = useNavigation<any>();
  // The Budget stack sits under the absolutely-positioned bottom tab bar, so
  // the trailing action needs its clearance rather than a hand-typed `pb-8`.
  const bottomPadding = useScreenBottomPadding();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { savingsGoals, loadSavingsGoals, addSavingsGoal, contributeToGoal, removeSavingsGoal } = useBudgetStore();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [icon, setIcon] = useState(GOAL_ICONS[0]);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [contributeId, setContributeId] = useState<string | null>(null);
  const [contributeAmount, setContributeAmount] = useState('');

  useEffect(() => {
    if (userId) void loadSavingsGoals(userId);
  }, [userId, loadSavingsGoals]);

  const activeGoals = useMemo(() => savingsGoals.filter(g => !g.completedAt), [savingsGoals]);
  const completedGoals = useMemo(() => savingsGoals.filter(g => g.completedAt), [savingsGoals]);

  const handleAdd = async () => {
    const amount = parseFloat(target);
    if (!name.trim() || !amount || amount <= 0) {
      appAlert('Invalid goal', 'Enter a name and target amount.');
      return;
    }
    await addSavingsGoal({
      name: name.trim(),
      targetAmount: amount,
      currentAmount: 0,
      userId,
      icon,
      deadline: deadline ? deadline.toISOString().slice(0, 10) : undefined,
    });
    setName('');
    setTarget('');
    setIcon(GOAL_ICONS[0]);
    setDeadline(null);
  };

  const handleContribute = async (goalId: string) => {
    const amount = parseFloat(contributeAmount);
    if (!amount || amount <= 0) return;
    await contributeToGoal(goalId, amount);
    setContributeId(null);
    setContributeAmount('');
  };

  // Deleting a goal throws away every naira saved toward it, so it confirms
  // first — naming the goal and the amount at stake — rather than vanishing on
  // a mis-tap the way the red trash used to.
  const handleRemoveGoal = async (goal: SavingsGoal) => {
    const saved = goal.currentAmount > 0
      ? `You've saved ${formatCurrency(goal.currentAmount)} toward it. `
      : '';
    const ok = await confirmAsync(
      'Delete this goal?',
      `"${goal.name}" will be removed. ${saved}This can't be undone.`,
      { confirmLabel: 'Delete', destructive: true }
    );
    if (ok) void removeSavingsGoal(goal.id);
  };

  const renderGoal = (goal: SavingsGoal) => {
    const pct = goal.targetAmount > 0 ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
    const done = !!goal.completedAt;
    return (
      <Card key={goal.id} className="p-4">
        <View className="flex-row justify-between items-start">
          <View className="flex-row items-start gap-2 flex-1">
            <Text className="text-2xl">{goal.icon || goal.emoji || '🎯'}</Text>
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="font-semibold text-lantern-text dark:text-white">{goal.name}</Text>
                {done && (
                  <View className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                    <Text className="text-label font-semibold text-lantern-success">✓ Done</Text>
                  </View>
                )}
              </View>
              <Text className="text-sm text-lantern-text-secondary mt-0.5">
                {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
              </Text>
              {goal.deadline && !done && (
                <Text className="text-xs text-lantern-text-tertiary mt-0.5">Due {formatBudgetDate(goal.deadline)}</Text>
              )}
            </View>
          </View>
          <Pressable onPress={() => void handleRemoveGoal(goal)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${goal.name}`}>
            <AppIcon name="trash" size={20} color="#ef4444" />
          </Pressable>
        </View>
        <View className="h-2 bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-full mt-3 overflow-hidden">
          <View className={`h-full rounded-full ${done ? 'bg-lantern-success' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
        </View>
        <Text className="text-xs text-lantern-text-tertiary mt-1">{pct.toFixed(0)}% saved</Text>
        {!done && (
          contributeId === goal.id ? (
            <View className="flex-row gap-2 mt-3">
              <TextInput value={contributeAmount} onChangeText={setContributeAmount} placeholder="Amount" keyboardType="decimal-pad" placeholderTextColor="#94a3b8" className="flex-1 border border-lantern-border rounded-xl px-3 py-2 text-lantern-text dark:text-white" />
              <Button size="sm" onPress={() => void handleContribute(goal.id)}>Add</Button>
            </View>
          ) : (
            <Button size="sm" variant="secondary" className="mt-3" onPress={() => setContributeId(goal.id)}>
              Contribute
            </Button>
          )
        )}
      </Card>
    );
  };

  return (
    <Screen bottom="none" keyboard>
      <ScreenHeader title="Savings goals" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerClassName="px-4 gap-3"
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <Card className="p-4 gap-3">
          <Text className="font-semibold text-lantern-text dark:text-white">New goal</Text>
          {/* Icon picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 py-1">
            {GOAL_ICONS.map(g => (
              <TouchableOpacity
                key={g}
                onPress={() => setIcon(g)}
                className={`w-11 h-11 rounded-xl items-center justify-center border ${icon === g ? 'border-lantern-primary bg-lantern-primary-background' : 'border-lantern-border bg-lantern-surface'}`}
              >
                <Text className="text-xl">{g}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput value={name} onChangeText={setName} placeholder="Goal name (e.g. New phone)" placeholderTextColor="#94a3b8" className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface" />
          <TextInput value={target} onChangeText={setTarget} placeholder="Target amount (₦)" keyboardType="decimal-pad" placeholderTextColor="#94a3b8" className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface" />
          <TouchableOpacity
            onPress={() => setShowDatePicker(true)}
            className="flex-row items-center justify-between border border-lantern-border rounded-xl px-4 py-3 bg-lantern-surface"
          >
            <Text className={deadline ? 'text-lantern-text dark:text-white' : 'text-lantern-text-tertiary'}>
              {deadline ? `Target date: ${formatBudgetDate(deadline)}` : 'Target date (optional)'}
            </Text>
            <AppIcon name="calendar" size={18} color="#94a3b8" />
          </TouchableOpacity>
          <Button onPress={() => void handleAdd()}>Add goal</Button>
        </Card>

        {activeGoals.map(renderGoal)}

        {completedGoals.length > 0 && (
          <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary tracking-wider mt-2">Completed</Text>
        )}
        {completedGoals.map(renderGoal)}

        {savingsGoals.length === 0 && (
          <View className="items-center py-8">
            <Text className="text-4xl mb-2">🎯</Text>
            <Text className="text-lantern-text-tertiary text-sm text-center px-6">Set a goal to save for something — a phone, textbooks, or a trip.</Text>
          </View>
        )}

        <BudgetDatePicker
          visible={showDatePicker}
          date={deadline || new Date()}
          accentColor={brand.text}
          onSelect={setDeadline}
          onClose={() => setShowDatePicker(false)}
        />
      </ScrollView>
    </Screen>
  );
}

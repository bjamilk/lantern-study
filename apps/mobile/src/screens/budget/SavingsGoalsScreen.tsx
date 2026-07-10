import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { useBudgetStore, formatCurrency, type SavingsGoal } from '../../stores/budgetStore';
import { ScreenHeader, Button, Card } from '../../components/ui';

export default function SavingsGoalsScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { savingsGoals, loadSavingsGoals, addSavingsGoal, contributeToGoal, removeSavingsGoal } = useBudgetStore();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [contributeId, setContributeId] = useState<string | null>(null);
  const [contributeAmount, setContributeAmount] = useState('');

  useEffect(() => {
    if (userId) void loadSavingsGoals(userId);
  }, [userId, loadSavingsGoals]);

  const handleAdd = async () => {
    const amount = parseFloat(target);
    if (!name.trim() || !amount || amount <= 0) {
      Alert.alert('Invalid goal', 'Enter a name and target amount.');
      return;
    }
    await addSavingsGoal({ name: name.trim(), targetAmount: amount, currentAmount: 0, userId });
    setName('');
    setTarget('');
  };

  const handleContribute = async (goalId: string) => {
    const amount = parseFloat(contributeAmount);
    if (!amount || amount <= 0) return;
    await contributeToGoal(goalId, amount);
    setContributeId(null);
    setContributeAmount('');
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader title="Savings goals" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerClassName="px-4 pb-8 gap-3">
        <Card className="p-4 gap-3">
          <Text className="font-semibold text-slate-900 dark:text-white">New goal</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Goal name" placeholderTextColor="#94a3b8" className="border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-slate-900 dark:text-white bg-white dark:bg-slate-800" />
          <TextInput value={target} onChangeText={setTarget} placeholder="Target amount" keyboardType="decimal-pad" placeholderTextColor="#94a3b8" className="border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-slate-900 dark:text-white bg-white dark:bg-slate-800" />
          <Button onPress={() => void handleAdd()}>Add goal</Button>
        </Card>
        {savingsGoals.map((goal: SavingsGoal) => {
          const pct = Math.min(100, (goal.currentAmount / goal.targetAmount) * 100);
          return (
            <Card key={goal.id} className="p-4">
              <View className="flex-row justify-between items-start">
                <View className="flex-1">
                  <Text className="font-semibold text-slate-900 dark:text-white">{goal.name}</Text>
                  <Text className="text-sm text-slate-500 mt-1">
                    {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
                  </Text>
                </View>
                <Pressable onPress={() => void removeSavingsGoal(goal.id)}>
                  <Ionicons name="trash-outline" size={20} color="#ef4444" />
                </Pressable>
              </View>
              <View className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full mt-3 overflow-hidden">
                <View className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
              </View>
              {contributeId === goal.id ? (
                <View className="flex-row gap-2 mt-3">
                  <TextInput value={contributeAmount} onChangeText={setContributeAmount} placeholder="Amount" keyboardType="decimal-pad" placeholderTextColor="#94a3b8" className="flex-1 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 text-slate-900 dark:text-white" />
                  <Button size="sm" onPress={() => void handleContribute(goal.id)}>Add</Button>
                </View>
              ) : (
                <Button size="sm" variant="secondary" className="mt-3" onPress={() => setContributeId(goal.id)}>
                  Contribute
                </Button>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

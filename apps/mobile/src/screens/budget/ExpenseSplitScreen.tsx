import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { useBudgetStore, formatCurrency, type ExpenseSplit } from '../../stores/budgetStore';
import { ScreenHeader, Button, Card } from '../../components/ui';

export default function ExpenseSplitScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { expenseSplits, loadExpenseSplits, addExpenseSplit, toggleSplitParticipantPaid, settleExpenseSplit, removeExpenseSplit } = useBudgetStore();
  const [title, setTitle] = useState('');
  const [total, setTotal] = useState('');
  const [participant, setParticipant] = useState('');

  useEffect(() => {
    if (userId) void loadExpenseSplits(userId);
  }, [userId, loadExpenseSplits]);

  const handleAdd = async () => {
    const amount = parseFloat(total);
    if (!title.trim() || !amount || amount <= 0 || !participant.trim()) {
      Alert.alert('Missing fields', 'Fill in title, amount, and at least one participant.');
      return;
    }
    await addExpenseSplit({
      userId,
      title: title.trim(),
      totalAmount: amount,
      participants: [{ name: participant.trim(), amount: amount, paid: false }],
    });
    setTitle('');
    setTotal('');
    setParticipant('');
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <ScreenHeader title="Expense splits" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerClassName="px-4 pb-8 gap-3">
        <Card className="p-4 gap-3">
          <TextInput value={title} onChangeText={setTitle} placeholder="Expense title" placeholderTextColor="#94a3b8" className="border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-slate-900 dark:text-white bg-white dark:bg-slate-800" />
          <TextInput value={total} onChangeText={setTotal} placeholder="Total amount" keyboardType="decimal-pad" placeholderTextColor="#94a3b8" className="border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-slate-900 dark:text-white bg-white dark:bg-slate-800" />
          <TextInput value={participant} onChangeText={setParticipant} placeholder="Participant name" placeholderTextColor="#94a3b8" className="border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-slate-900 dark:text-white bg-white dark:bg-slate-800" />
          <Button onPress={() => void handleAdd()}>Create split</Button>
        </Card>
        {expenseSplits.map((split: ExpenseSplit) => (
          <Card key={split.id} className="p-4">
            <View className="flex-row justify-between">
              <Text className="font-semibold text-slate-900 dark:text-white">{split.title}</Text>
              <Text className="text-indigo-600 font-medium">{formatCurrency(split.totalAmount)}</Text>
            </View>
            {split.participants.map((p, idx) => (
              <Pressable key={idx} onPress={() => void toggleSplitParticipantPaid(split.id, idx)} className="flex-row items-center gap-2 mt-2">
                <Ionicons name={p.paid ? 'checkbox' : 'square-outline'} size={18} color={p.paid ? '#10b981' : '#94a3b8'} />
                <Text className={`text-sm ${p.paid ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-300'}`}>
                  {p.name} — {formatCurrency(p.amount)}
                </Text>
              </Pressable>
            ))}
            <View className="flex-row gap-2 mt-3">
              <Button size="sm" variant="secondary" className="flex-1" onPress={() => void settleExpenseSplit(split.id)}>Settle</Button>
              <Button size="sm" variant="ghost" onPress={() => void removeExpenseSplit(split.id)}>Remove</Button>
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

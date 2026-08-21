import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Pressable, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import {
  useBudgetStore,
  formatCurrency,
  EXPENSE_CATEGORIES,
  getCategoryIcon,
  type ExpenseSplit,
} from '../../stores/budgetStore';
import { ScreenHeader, Button, Card } from '../../components/ui';

export default function ExpenseSplitScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const userName = useAuthStore(s => (s.user as any)?.profileName) || 'You';
  const { expenseSplits, loadExpenseSplits, addExpenseSplit, toggleSplitParticipantPaid, settleExpenseSplit, removeExpenseSplit } = useBudgetStore();

  const [title, setTitle] = useState('');
  const [total, setTotal] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0].id);
  // Other participants beyond the creator (who is always included).
  const [others, setOthers] = useState<string[]>(['']);

  useEffect(() => {
    if (userId) void loadExpenseSplits(userId);
  }, [userId, loadExpenseSplits]);

  const namedOthers = others.map(o => o.trim()).filter(Boolean);
  const headcount = namedOthers.length + 1; // + creator
  const amountNum = parseFloat(total) || 0;
  const perPerson = amountNum > 0 ? amountNum / headcount : 0;

  const activeSplits = useMemo(() => expenseSplits.filter(s => s.status === 'active'), [expenseSplits]);
  const settledSplits = useMemo(() => expenseSplits.filter(s => s.status === 'settled'), [expenseSplits]);

  const handleAdd = async () => {
    if (!title.trim() || amountNum <= 0) {
      Alert.alert('Missing fields', 'Enter a title and a total amount.');
      return;
    }
    const allNames = [userName, ...namedOthers];
    const per = Math.round(perPerson * 100) / 100;
    await addExpenseSplit({
      creatorId: userId,
      title: title.trim(),
      totalAmount: amountNum,
      category,
      participants: allNames.map((name, i) => ({
        userId: i === 0 ? userId : `participant_${Date.now()}_${i}`,
        userName: name,
        amount: per,
        paid: i === 0, // creator is already covered
      })),
    });
    setTitle('');
    setTotal('');
    setCategory(EXPENSE_CATEGORIES[0].id);
    setOthers(['']);
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader title="Expense splits" onBack={() => navigation.goBack()} subtitle="Share rent, data, gas with friends" />
      <ScrollView contentContainerClassName="px-4 pb-8 gap-3" keyboardShouldPersistTaps="handled">
        {/* ─── Create ─── */}
        <Card className="p-4 gap-3">
          <TextInput value={title} onChangeText={setTitle} placeholder="What are you splitting? (e.g. hostel rent)" placeholderTextColor="#94a3b8" className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface" />
          <TextInput value={total} onChangeText={setTotal} placeholder="Total amount (₦)" keyboardType="decimal-pad" placeholderTextColor="#94a3b8" className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface" />

          {/* Category chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 py-1">
            {EXPENSE_CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.id}
                onPress={() => setCategory(cat.id)}
                className={`px-3 py-2 rounded-xl border ${category === cat.id ? 'border-lantern-primary bg-lantern-primary-background' : 'border-lantern-border bg-lantern-surface'}`}
              >
                <Text className={`text-xs ${category === cat.id ? 'text-lantern-primary font-semibold' : 'text-lantern-text-secondary'}`}>
                  {cat.icon} {cat.label.split('/')[0].split('&')[0].trim()}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Participants */}
          <Text className="text-xs font-medium text-lantern-text-secondary">Split between you + {namedOthers.length} other{namedOthers.length === 1 ? '' : 's'}</Text>
          <View className="flex-row items-center gap-2 bg-lantern-primary-background rounded-xl px-3 py-2.5">
            <Ionicons name="person-circle" size={18} color="#6366f1" />
            <Text className="text-sm text-lantern-primary font-medium">{userName} (you)</Text>
          </View>
          {others.map((name, i) => (
            <View key={i} className="flex-row items-center gap-2">
              <TextInput
                value={name}
                onChangeText={v => setOthers(prev => prev.map((o, idx) => (idx === i ? v : o)))}
                placeholder="Name of person"
                placeholderTextColor="#94a3b8"
                className="flex-1 border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface"
              />
              {others.length > 1 && (
                <TouchableOpacity onPress={() => setOthers(prev => prev.filter((_, idx) => idx !== i))} className="p-2">
                  <Ionicons name="trash-outline" size={18} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity onPress={() => setOthers(prev => [...prev, ''])} className="flex-row items-center gap-1.5 py-1">
            <Ionicons name="person-add-outline" size={16} color="#6366f1" />
            <Text className="text-sm text-lantern-primary font-medium">Add person</Text>
          </TouchableOpacity>

          {amountNum > 0 && (
            <Text className="text-xs text-lantern-text-tertiary">Each person pays {formatCurrency(perPerson)}</Text>
          )}
          <Button onPress={() => void handleAdd()}>Create split</Button>
        </Card>

        {/* ─── Active ─── */}
        {activeSplits.length > 0 && (
          <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary tracking-wider mt-2">Active splits</Text>
        )}
        {activeSplits.map((split: ExpenseSplit) => {
          const paidCount = split.participants.filter(p => p.paid).length;
          return (
            <Card key={split.id} className="p-4">
              <View className="flex-row justify-between items-start">
                <View className="flex-1 pr-2">
                  <Text className="font-semibold text-lantern-text dark:text-white">
                    {getCategoryIcon(split.category, 'EXPENSE')} {split.title}
                  </Text>
                  <Text className="text-xs text-lantern-text-tertiary mt-0.5">{formatCurrency(split.totalAmount)} total · {split.participants.length} people</Text>
                </View>
                <TouchableOpacity onPress={() => void removeExpenseSplit(split.id)} className="p-1">
                  <Ionicons name="close" size={18} color="#94a3b8" />
                </TouchableOpacity>
              </View>
              <View className="gap-1.5 mt-3">
                {split.participants.map((p, idx) => (
                  <Pressable key={idx} onPress={() => void toggleSplitParticipantPaid(split.id, idx)} className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <Ionicons name={p.paid ? 'checkbox' : 'square-outline'} size={18} color={p.paid ? '#10b981' : '#94a3b8'} />
                      <Text className={`text-sm ${p.paid ? 'text-lantern-text-tertiary line-through' : 'text-lantern-text dark:text-white'}`}>
                        {p.userName}{p.userId === userId ? ' (you)' : ''}
                      </Text>
                    </View>
                    <Text className={`text-sm font-medium ${p.paid ? 'text-lantern-success' : 'text-lantern-text-secondary'}`}>{formatCurrency(p.amount)}</Text>
                  </Pressable>
                ))}
              </View>
              {/* progress */}
              <View className="flex-row gap-1 mt-3">
                {split.participants.map((p, idx) => (
                  <View key={idx} className={`flex-1 h-1.5 rounded-full ${p.paid ? 'bg-lantern-success' : 'bg-lantern-border'}`} />
                ))}
              </View>
              <Text className="text-xs text-lantern-text-tertiary mt-1">{paidCount}/{split.participants.length} paid</Text>
              <View className="flex-row gap-2 mt-3">
                <Button size="sm" variant="secondary" className="flex-1" onPress={() => void settleExpenseSplit(split.id)}>Mark all settled</Button>
              </View>
            </Card>
          );
        })}

        {/* ─── Settled ─── */}
        {settledSplits.length > 0 && (
          <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary tracking-wider mt-2">Settled</Text>
        )}
        {settledSplits.slice(0, 5).map((split: ExpenseSplit) => (
          <Card key={split.id} className="p-3 flex-row items-center gap-3">
            <Text className="text-lg">{getCategoryIcon(split.category, 'EXPENSE')}</Text>
            <View className="flex-1">
              <Text className="font-medium text-sm text-lantern-success">{split.title}</Text>
              <Text className="text-xs text-lantern-text-tertiary">{formatCurrency(split.totalAmount)} · all settled</Text>
            </View>
            <TouchableOpacity onPress={() => void removeExpenseSplit(split.id)} className="p-1">
              <Ionicons name="trash-outline" size={16} color="#94a3b8" />
            </TouchableOpacity>
          </Card>
        ))}

        {expenseSplits.length === 0 && (
          <View className="items-center py-8">
            <Text className="text-4xl mb-2">🤝</Text>
            <Text className="text-lantern-text-tertiary text-sm text-center px-6">Split rent, food, data or any shared cost with roommates or friends.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Budget stack -> Recurring. Lists the student's recurring income/expense
 * rules and adds new ones (type, amount, category, weekly or monthly, next
 * date).
 *
 * Exports: RecurringScreen (default).
 * Touches: services/api listRecurring / createRecurring / deleteRecurring /
 * runRecurring; budgetStore fetchTransactions (refreshed after a rule posts)
 * and budget.userId; BudgetDatePicker.
 * Note: rules are materialised server-side by runRecurring(), which is called
 * here right after a rule is created and again whenever Budget is opened, so
 * it must stay idempotent. The rule list is local state, not the store.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { useNavigation } from '@react-navigation/native';
import * as api from '../../services/api';
import {
  useBudgetStore,
  formatCurrency,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  getCategoryIcon,
} from '../../stores/budgetStore';
import { ScreenHeader, Button, Card } from '../../components/ui';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { BudgetDatePicker } from '../../components/budget/BudgetDatePicker';
import { formatBudgetDate } from './budgetFormat';
import { AppIcon } from '../../components/ui/AppIcon';
import { brand } from '../../theme';

interface RecurringRule {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string | null;
  description: string | null;
  frequency: 'weekly' | 'monthly';
  dayOfMonth: number | null;
  nextDate: string;
  active: boolean;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function RecurringScreen() {
  const navigation = useNavigation<any>();
  // The Budget stack sits under the absolutely-positioned bottom tab bar, so
  // the trailing action needs its clearance rather than a hand-typed `pb-8`.
  const bottomPadding = useScreenBottomPadding();
  const fetchTransactions = useBudgetStore(s => s.fetchTransactions);
  const currentUserId = useBudgetStore(s => s.budget?.userId);

  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0].id);
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('monthly');
  const [date, setDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listRecurring();
      setRules((res.rules || []) as RecurringRule[]);
    } catch {
      appAlert('Recurring', 'Could not load recurring items.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the category valid when the type flips.
  useEffect(() => {
    setCategory(cats[0].id);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      appAlert('Recurring', 'Enter a valid amount.');
      return;
    }
    setSaving(true);
    try {
      await api.createRecurring({
        type,
        amount: amt,
        category,
        description: description.trim() || undefined,
        frequency,
        dayOfMonth: frequency === 'monthly' ? date.getDate() : undefined,
        nextDate: ymd(date),
      });
      // Post it now if its date is today/past, so it shows immediately.
      await api.runRecurring().catch(() => {});
      setAmount('');
      setDescription('');
      await load();
      // Refresh transactions in case a rule just posted.
      const uid = currentUserId;
      if (uid) void fetchTransactions(uid);
    } catch {
      appAlert('Recurring', 'Could not add recurring item.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteRecurring(id);
      setRules(prev => prev.filter(r => r.id !== id));
    } catch {
      appAlert('Recurring', 'Could not remove recurring item.');
    }
  };

  return (
    <Screen bottom="none" keyboard>
      <ScreenHeader title="Recurring" onBack={() => navigation.goBack()} subtitle="Allowance, hostel, data — auto-posted" />
      <ScrollView
        contentContainerClassName="px-4 gap-3"
        contentContainerStyle={{ paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xs text-lantern-text-secondary px-1">
          Set up items that repeat. They post automatically on their date when you open Budget.
        </Text>

        {/* Existing rules */}
        {loading ? (
          <View className="py-6 items-center"><ActivityIndicator color={brand.text} /></View>
        ) : rules.length === 0 ? (
          <Text className="text-sm text-lantern-text-tertiary text-center py-4">No recurring items yet.</Text>
        ) : (
          rules.map(rule => (
            <Card key={rule.id} className="p-3 flex-row items-center justify-between">
              <View className="flex-1 pr-2">
                <Text className="text-sm font-medium text-lantern-text dark:text-white" numberOfLines={1}>
                  {rule.description || `${getCategoryIcon(rule.category || '', rule.type === 'income' ? 'INCOME' : 'EXPENSE')} ${rule.category || (rule.type === 'income' ? 'Income' : 'Expense')}`}
                </Text>
                <Text className="text-xs text-lantern-text-tertiary mt-0.5">
                  {getCategoryIcon(rule.category || '', rule.type === 'income' ? 'INCOME' : 'EXPENSE')} · {rule.frequency === 'monthly' ? 'Monthly' : 'Weekly'} · next {formatBudgetDate(rule.nextDate)}
                </Text>
              </View>
              <Text className={`text-sm font-semibold mr-3 ${rule.type === 'income' ? 'text-lantern-success' : 'text-red-500'}`}>
                {rule.type === 'income' ? '+' : '-'}{formatCurrency(rule.amount)}
              </Text>
              <TouchableOpacity onPress={() => void handleDelete(rule.id)} hitSlop={8}>
                <AppIcon name="trash" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </Card>
          ))
        )}

        {/* Add form */}
        <Card className="p-4 gap-3 mt-1">
          {/* Type toggle */}
          <View className="flex-row bg-lantern-background-secondary rounded-xl p-1">
            {(['expense', 'income'] as const).map(t => (
              <TouchableOpacity
                key={t}
                onPress={() => setType(t)}
                className={`flex-1 py-2.5 rounded-lg items-center ${type === t ? 'bg-lantern-primary-fill' : ''}`}
              >
                <Text className={`text-sm font-medium ${type === t ? 'text-white' : 'text-lantern-text-secondary'}`}>
                  {t === 'expense' ? 'Expense' : 'Income'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput value={amount} onChangeText={setAmount} placeholder="Amount (₦)" keyboardType="decimal-pad" placeholderTextColor="#94a3b8" className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface" />

          {/* Frequency */}
          <View className="flex-row gap-2">
            {(['monthly', 'weekly'] as const).map(f => (
              <TouchableOpacity
                key={f}
                onPress={() => setFrequency(f)}
                className={`flex-1 py-2.5 rounded-xl items-center border ${frequency === f ? 'border-lantern-primary bg-lantern-primary-background' : 'border-lantern-border bg-lantern-surface'}`}
              >
                <Text className={`text-sm ${frequency === f ? 'text-lantern-primary-text font-semibold' : 'text-lantern-text-secondary'}`}>
                  {f === 'monthly' ? 'Monthly' : 'Weekly'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Category chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 py-1">
            {cats.map(cat => (
              <TouchableOpacity
                key={cat.id}
                onPress={() => setCategory(cat.id)}
                className={`px-3 py-2 rounded-xl border ${category === cat.id ? 'border-lantern-primary bg-lantern-primary-background' : 'border-lantern-border bg-lantern-surface'}`}
              >
                <Text className={`text-xs ${category === cat.id ? 'text-lantern-primary-text font-semibold' : 'text-lantern-text-secondary'}`}>
                  {cat.icon} {cat.label.split('/')[0].split('&')[0].split('(')[0].trim()}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TextInput value={description} onChangeText={setDescription} placeholder="Description (optional) — e.g. Monthly allowance" placeholderTextColor="#94a3b8" className="border border-lantern-border rounded-xl px-4 py-3 text-lantern-text dark:text-white bg-lantern-surface" />

          <TouchableOpacity
            onPress={() => setShowDatePicker(true)}
            className="flex-row items-center justify-between border border-lantern-border rounded-xl px-4 py-3 bg-lantern-surface"
          >
            <Text className="text-lantern-text dark:text-white">
              {frequency === 'monthly' ? `Repeats on day ${date.getDate()} — from ${formatBudgetDate(date)}` : `First / next date: ${formatBudgetDate(date)}`}
            </Text>
            <AppIcon name="calendar" size={18} color="#94a3b8" />
          </TouchableOpacity>

          <Button onPress={() => void handleAdd()} disabled={saving}>
            {saving ? 'Adding…' : 'Add recurring item'}
          </Button>
        </Card>

        <BudgetDatePicker
          visible={showDatePicker}
          date={date}
          accentColor={brand.text}
          onSelect={setDate}
          onClose={() => setShowDatePicker(false)}
        />
      </ScrollView>
    </Screen>
  );
}

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { useBudgetStore, formatCurrency } from '../../stores/budgetStore';
import { ScreenHeader, Button, Card } from '../../components/ui';

export default function WalletScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { walletBalance, loadWalletBalance, adjustWalletBalance } = useBudgetStore();
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (userId) void loadWalletBalance(userId);
  }, [userId, loadWalletBalance]);

  const adjust = async (sign: 1 | -1) => {
    const n = parseFloat(amount);
    if (!n || n <= 0) {
      Alert.alert('Enter a valid amount');
      return;
    }
    await adjustWalletBalance(sign * n, userId);
    setAmount('');
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <ScreenHeader title="Study wallet" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerClassName="px-4 pb-8">
        <Card className="p-6 items-center mb-4">
          <Text className="text-sm text-slate-500">Lantern coins</Text>
          <Text className="text-4xl font-bold text-indigo-600 mt-1">{walletBalance}</Text>
          <Text className="text-xs text-slate-400 mt-2">Use coins for streak freezes and rewards</Text>
        </Card>
        <Card className="p-4 gap-3">
          <TextInput value={amount} onChangeText={setAmount} placeholder="Amount" keyboardType="number-pad" placeholderTextColor="#94a3b8" className="border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-slate-900 dark:text-white bg-white dark:bg-slate-800" />
          <View className="flex-row gap-2">
            <Button className="flex-1" variant="secondary" onPress={() => void adjust(-1)}>Spend</Button>
            <Button className="flex-1" onPress={() => void adjust(1)}>Add coins</Button>
          </View>
        </Card>
        <Text className="text-xs text-slate-500 mt-4 text-center">
          Balance: {formatCurrency(walletBalance * 0)} (display only — coins are whole numbers)
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

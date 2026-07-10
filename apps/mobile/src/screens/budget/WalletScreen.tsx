import React, { useEffect } from 'react';
import { View, Text, ScrollView, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { useBudgetStore } from '../../stores/budgetStore';
import { ScreenHeader, Card } from '../../components/ui';

const EARN_WAYS = [
  { icon: '📝', action: 'Complete a study session', coins: '+5' },
  { icon: '✅', action: 'Pass a test (80%+)', coins: '+15' },
  { icon: '🃏', action: 'Review 20 flashcards', coins: '+10' },
  { icon: '🔥', action: 'Maintain a 7-day streak', coins: '+50' },
  { icon: '💰', action: 'Stay under budget (monthly)', coins: '+100' },
  { icon: '🎯', action: 'Complete a savings goal', coins: '+75' },
];

export default function WalletScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { walletBalance, loadWalletBalance } = useBudgetStore();

  useEffect(() => {
    if (!userId) return;
    void loadWalletBalance(userId);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadWalletBalance(userId);
    });
    return () => sub.remove();
  }, [userId, loadWalletBalance]);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader title="Study wallet" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerClassName="px-4 pb-8">
        <Card className="p-6 items-center mb-4">
          <Text className="text-sm text-lantern-text-secondary">Lantern coins</Text>
          <Text className="text-4xl font-bold text-teal-600 mt-1">{walletBalance}</Text>
          <Text className="text-xs text-lantern-text-tertiary mt-2 text-center">
            Earn coins by studying and saving smart. Spend 50 coins on a streak freeze.
          </Text>
        </Card>

        <Text className="text-xs font-semibold uppercase text-slate-400 mb-2 px-1">How to earn</Text>
        <Card className="p-4 mb-4">
          {EARN_WAYS.map((row) => (
            <View key={row.action} className="flex-row items-center py-2 border-b border-slate-100 dark:border-slate-700 last:border-b-0">
              <Text className="text-lg mr-3">{row.icon}</Text>
              <Text className="flex-1 text-sm text-slate-700 dark:text-slate-200">{row.action}</Text>
              <Text className="text-xs font-bold text-emerald-600">{row.coins}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

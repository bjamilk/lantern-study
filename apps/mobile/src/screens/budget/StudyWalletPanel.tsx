/**
 * Body of the Budget screen's "Study wallet" segment: the Lantern-coin balance
 * and a static list of ways to earn. Rendered inside BudgetScreen, so it draws
 * no header and owns no navigation.
 *
 * Exports: StudyWalletPanel (default).
 * Touches: budgetStore walletBalance / loadWalletBalance; authStore for the
 * user id; react-native AppState (the balance is refetched whenever the app
 * returns to the foreground). The EARN_WAYS table is hard-coded copy.
 */
import React, { useEffect } from 'react';
import { View, Text, AppState } from 'react-native';
import { useAuthStore } from '../../stores/authStore';
import { useBudgetStore } from '../../stores/budgetStore';
import { Card } from '../../components/ui';

const EARN_WAYS = [
  { icon: '📝', action: 'Complete a study session', coins: '+5' },
  { icon: '✅', action: 'Pass a test (80%+)', coins: '+15' },
  { icon: '🃏', action: 'Review 20 flashcards', coins: '+10' },
  { icon: '🔥', action: 'Maintain a 7-day streak', coins: '+50' },
  { icon: '💰', action: 'Stay under budget (monthly)', coins: '+100' },
  { icon: '🎯', action: 'Complete a savings goal', coins: '+75' },
];

/** Study-wallet body for the Budget Wallet tab (no screen header / back). */
export default function StudyWalletPanel() {
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
    <>
      <Card className="p-6 items-center mb-4">
        <Text className="text-sm text-lantern-text-secondary">Lantern coins</Text>
        <Text className="text-4xl font-bold text-teal-600 mt-1">{walletBalance}</Text>
        <Text className="text-xs text-lantern-text-tertiary mt-2 text-center">
          Earn coins by studying and saving smart. Spend 50 coins on a streak freeze.
        </Text>
      </Card>

      <Text className="text-xs font-semibold uppercase text-lantern-text-tertiary mb-2 px-1">How to earn</Text>
      <Card className="p-4 mb-4">
        {EARN_WAYS.map((row) => (
          <View key={row.action} className="flex-row items-center py-2 border-b border-lantern-border last:border-b-0">
            <Text className="text-lg mr-3">{row.icon}</Text>
            <Text className="flex-1 text-sm text-lantern-text">{row.action}</Text>
            <Text className="text-xs font-bold text-emerald-600">{row.coins}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

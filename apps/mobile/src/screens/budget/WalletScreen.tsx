import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';

/** Legacy `/budget/wallet` destination — land on Budget with the Study wallet tab. */
export default function WalletScreen() {
  const navigation = useNavigation<any>();

  useEffect(() => {
    navigation.replace('BudgetHome', { tab: 'wallet' });
  }, [navigation]);

  return null;
}

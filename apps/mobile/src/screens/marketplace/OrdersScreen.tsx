import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchMarketplaceOrders } from '../../services/api';
import type { MarketplaceOrder } from '@lantern/shared/types';
import { formatPrice } from './marketplaceHelpers';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

export function OrdersScreen({ navigation }: { navigation: NavigationProp }) {
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await fetchMarketplaceOrders(role));
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <View className="px-4 py-3 flex-row items-center">
        <Pressable onPress={() => navigation.goBack()} className="p-2 -ml-2">
          <Ionicons name="arrow-back" size={22} color="#64748b" />
        </Pressable>
        <Text className="text-xl font-bold text-slate-900 dark:text-slate-100 ml-2">Orders</Text>
      </View>
      <View className="flex-row gap-2 px-4 mb-3">
        {(['buyer', 'seller'] as const).map((r) => (
          <Pressable
            key={r}
            onPress={() => setRole(r)}
            className={`px-4 py-2 rounded-full ${role === r ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'}`}
          >
            <Text className={role === r ? 'text-white font-semibold' : 'text-slate-600'}>
              {r === 'buyer' ? 'Buying' : 'Selling'}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <ActivityIndicator className="mt-8" />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListEmptyComponent={
            <Text className="text-center text-slate-500 mt-12">No orders yet</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
              className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            >
              <Text className="font-semibold text-slate-900 dark:text-slate-100" numberOfLines={1}>
                {item.listing?.title || 'Listing'}
              </Text>
              <Text className="text-sm text-slate-500 mt-1 capitalize">
                {item.status.replace(/_/g, ' ')}
              </Text>
              <Text className="text-indigo-600 font-bold mt-2">{formatPrice(Number(item.amount))}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

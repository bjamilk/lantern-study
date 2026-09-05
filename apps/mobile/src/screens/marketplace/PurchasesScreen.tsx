import React, { useCallback, useEffect, useState } from 'react';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import {
  fetchMarketplacePurchases,
  downloadStudyPack,
  downloadQuestionBank,
} from '../../services/api';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Purchase = Awaited<ReturnType<typeof fetchMarketplacePurchases>>[number];

const KIND_LABEL: Record<Purchase['kind'], string> = {
  study_pack: 'Study Pack',
  question_bank: 'Question Bank',
};

/**
 * The buyer's library of purchased digital products (question banks + study
 * packs) from GET /marketplace/purchases, with per-item update-pull.
 */
export function PurchasesScreen({ navigation }: { navigation: NavigationProp }) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // The bottom tab bar is an absolute overlay on this route; the old
  // paddingBottom: 24 buried the last purchase row under it.
  const bottomPadding = useScreenBottomPadding();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPurchases(await fetchMarketplacePurchases());
    } catch {
      setPurchases([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdate = async (p: Purchase) => {
    setUpdatingId(p.listingId);
    try {
      if (p.kind === 'study_pack') {
        await downloadStudyPack(p.listingId);
      } else {
        await downloadQuestionBank(p.listingId);
      }
      setPurchases((prev) =>
        prev.map((x) =>
          x.listingId === p.listingId
            ? { ...x, versionAtDownload: x.version, updateAvailable: false }
            : x
        )
      );
    } catch {
      // best-effort; the item stays marked as update-available for a retry
    } finally {
      setUpdatingId(null);
    }
  };

  const renderItem = ({ item }: { item: Purchase }) => {
    const isStudyPack = item.kind === 'study_pack';
    return (
      <View className="mx-4 mb-3 rounded-xl border border-lantern-border bg-lantern-surface p-4 flex-row items-start">
        <View className="w-9 h-9 rounded-lg bg-lantern-primary/10 items-center justify-center mr-3 mt-0.5">
          <AppIcon
            name={isStudyPack ? 'albums' : 'star'}
            size={18}
            color="#6366f1"
          />
        </View>
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
            <View className="rounded-full bg-lantern-background-secondary px-2 py-0.5">
              <Text className="text-[11px] font-semibold text-lantern-text-secondary">
                {KIND_LABEL[item.kind]}
              </Text>
            </View>
            {item.updateAvailable ? (
              <View className="rounded-full bg-lantern-primary/15 px-2 py-0.5">
                <Text className="text-[11px] font-semibold text-lantern-primary">
                  Update available
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable onPress={() => navigation.navigate('ListingDetail', { listingId: item.listingId })}>
            <Text className="mt-1 text-sm font-semibold text-lantern-text" numberOfLines={1}>
              {item.title}
            </Text>
          </Pressable>
          <Text className="text-xs text-lantern-text-tertiary mt-0.5" numberOfLines={1}>
            {item.sellerName} · v{item.version}
            {item.updateAvailable ? ` (you have v${item.versionAtDownload})` : ''}
          </Text>
        </View>
        {item.updateAvailable ? (
          <Pressable
            onPress={() => void handleUpdate(item)}
            disabled={updatingId === item.listingId}
            className="ml-2 self-center flex-row items-center rounded-lg bg-lantern-primary px-3 py-1.5"
            style={{ opacity: updatingId === item.listingId ? 0.5 : 1, gap: 5 }}
          >
            <AppIcon name="download" size={13} color="#fff" />
            <Text className="text-xs font-semibold text-white">
              {updatingId === item.listingId ? 'Updating…' : 'Update'}
            </Text>
          </Pressable>
        ) : (
          <Text className="ml-2 self-center text-[11px] text-lantern-text-tertiary">Up to date</Text>
        )}
      </View>
    );
  };

  return (
    <Screen bottom="none">
      <View className="flex-row items-center px-4 py-3 border-b border-lantern-border">
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} className="mr-2 -ml-1 p-1">
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-lantern-text">Your purchases</Text>
          <Text className="text-xs text-lantern-text-secondary">
            Study packs and question banks you own
          </Text>
        </View>
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} />
        <Pressable onPress={() => void load()} hitSlop={8} className="p-1">
          <AppIcon name="refresh" size={20} color="#64748b" />
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : purchases.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <AppIcon name="bag" size={40} color="#94a3b8" />
          <Text className="mt-3 text-base font-semibold text-lantern-text">No purchases yet</Text>
          <Text className="mt-1 text-sm text-lantern-text-secondary text-center">
            Study packs and question banks you buy or download show up here.
          </Text>
          <Pressable
            onPress={() => navigation.navigate('MarketplaceHome')}
            className="mt-4 rounded-lg bg-lantern-primary px-4 py-2"
          >
            <Text className="text-sm font-semibold text-white">Browse the marketplace</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={purchases}
          keyExtractor={(p) => p.listingId}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: bottomPadding }}
        />
      )}
    </Screen>
  );
}

export default PurchasesScreen;

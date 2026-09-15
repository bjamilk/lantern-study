/**
 * `ShopBrowse` route: the three-level department taxonomy a buyer drills
 * through, with "See everything in …" at every level.
 *
 * Exports: ShopBrowseScreen.
 * Touches: the taxonomy helpers in @lantern/shared/marketplace
 * (MARKETPLACE_DEPARTMENTS, getTaxonomyNode/Children/Path, isTaxonomyLeaf,
 * descendantLeaves); useMarketplaceStore.setTaxonomyNode, which is what
 * actually filters the results on `MarketplaceHome`.
 *
 * Gotchas: shopping a node sets the store's taxonomy node and navigates away —
 * the selection lives in the store, not in route params, so going Back does
 * not undo it. OTHER_TAXONOMY_NODE_ID is a seller escape hatch and is filtered
 * out of every browse level. A non-leaf node is shoppable directly, so a buyer
 * never has to guess which subcategory a seller filed under.
 */
import React, { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShopHeaderActions } from './components/ShopHeaderActions';
import {
  MARKETPLACE_DEPARTMENTS,
  OTHER_TAXONOMY_NODE_ID,
  descendantLeaves,
  getTaxonomyChildren,
  getTaxonomyNode,
  getTaxonomyPath,
  isTaxonomyLeaf,
  type TaxonomyNode,
} from '@lantern/shared/marketplace';
import { useMarketplaceStore } from '../../stores';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { taxonomyIcon } from './marketplaceHelpers';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  push?: (screen: string, params?: Record<string, unknown>) => void;
};

/**
 * Shop by department — the buyer's half of the taxonomy.
 *
 * Amazon's "All" menu in three levels: departments, then the categories inside
 * one, then the subcategories that actually filter results. Every level can be
 * shopped directly ("See everything in …"), because a buyer who knows they want
 * Electronics should not have to guess which subcategory a seller filed under.
 */
export function ShopBrowseScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: { nodeId?: string } };
}) {
  const tabBarClearance = useTabBarClearance(16);
  const setTaxonomyNode = useMarketplaceStore(state => state.setTaxonomyNode);

  const nodeId = route?.params?.nodeId;
  const node = nodeId ? getTaxonomyNode(nodeId) : undefined;

  const children = useMemo<TaxonomyNode[]>(() => {
    if (!node) {
      // Root level: the nine departments. 'Something else' is a seller escape
      // hatch, not a place to shop, so it never appears in browse.
      return MARKETPLACE_DEPARTMENTS.map(id => getTaxonomyNode(id)).filter(
        (row): row is TaxonomyNode => Boolean(row),
      );
    }
    return getTaxonomyChildren(node.id).filter(child => child.id !== OTHER_TAXONOMY_NODE_ID);
  }, [node]);

  const path = useMemo(() => (node ? getTaxonomyPath(node.id) : []), [node]);

  const shopNode = (target: TaxonomyNode) => {
    setTaxonomyNode(target.id);
    navigation.navigate('MarketplaceHome');
  };

  const openNode = (target: TaxonomyNode) => {
    // A leaf has nothing left to drill into, so tapping it shops it.
    if (isTaxonomyLeaf(target)) {
      shopNode(target);
      return;
    }
    const go = navigation.push ?? navigation.navigate;
    go('ShopBrowse', { nodeId: target.id });
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-2 flex-row items-center">
        <Pressable
          hitSlop={10}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="p-2 -ml-2 mr-1"
        >
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text numberOfLines={1} className="flex-1 text-xl font-bold text-lantern-text">
          {node ? node.label : 'Shop by department'}
        </Text>
        <ShopHeaderActions navigate={(screen, params) => navigation.navigate(screen, params)} />
      </View>

      {path.length > 1 ? (
        <View className="px-4 pb-2 flex-row flex-wrap items-center">
          {path.slice(0, -1).map(crumb => (
            <React.Fragment key={crumb.id}>
              <Pressable
                onPress={() => navigation.navigate('ShopBrowse', { nodeId: crumb.id })}
                accessibilityRole="link"
                accessibilityLabel={`Back to ${crumb.label}`}
                className="py-1"
              >
                <Text className="text-xs font-medium text-lantern-primary-text">{crumb.label}</Text>
              </Pressable>
              <Text className="px-1 text-xs text-lantern-text-tertiary">›</Text>
            </React.Fragment>
          ))}
          <Text className="py-1 text-xs text-lantern-text-secondary">{node?.label}</Text>
        </View>
      ) : null}

      <FlatList
        data={children}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingBottom: tabBarClearance }}
        ListHeaderComponent={
          node ? (
            <Pressable
              onPress={() => shopNode(node)}
              accessibilityRole="button"
              accessibilityLabel={`See everything in ${node.label}`}
              className="mx-4 mt-1 mb-3 px-4 py-3 rounded-xl bg-lantern-primary-background"
            >
              <Text className="text-sm font-semibold text-lantern-primary-text">
                See everything in {node.label}
              </Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => {
          const leaf = isTaxonomyLeaf(item);
          const count = leaf ? 0 : descendantLeaves(item.id).length;
          return (
            <Pressable
              onPress={() => openNode(item)}
              accessibilityRole="button"
              accessibilityLabel={leaf ? `Shop ${item.label}` : `Browse ${item.label}`}
              className="flex-row items-center px-4 py-3 border-b border-lantern-border"
              style={{ minHeight: 56 }}
            >
              <View className="w-9 h-9 mr-3 rounded-lg items-center justify-center bg-lantern-background-secondary dark:bg-lantern-surface-secondary">
                <AppIcon name={taxonomyIcon(item.icon)} size={18} color="#64748b" />
              </View>
              <View className="flex-1 pr-2">
                <Text numberOfLines={1} className="text-sm font-medium text-lantern-text">
                  {item.label}
                </Text>
                {count > 0 ? (
                  <Text className="text-[11px] text-lantern-text-tertiary">
                    {count} {count === 1 ? 'subcategory' : 'subcategories'}
                  </Text>
                ) : null}
              </View>
              <AppIcon
                name={leaf ? 'arrow-forward' : 'chevron-forward'}
                size={16}
                color="#94a3b8"
              />
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

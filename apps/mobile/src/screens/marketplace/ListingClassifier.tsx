import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  MARKETPLACE_DEPARTMENTS,
  OTHER_TAXONOMY_NODE_ID,
  classifyListing,
  descendantLeaves,
  getTaxonomyChildren,
  getTaxonomyNode,
  getTaxonomyPath,
  isTaxonomyLeaf,
  searchTaxonomy,
  taxonomyPathLabel,
  type MarketplaceDepartment,
  type TaxonomyNode,
} from '@lantern/shared/marketplace';
import { AppIcon } from '../../components/ui/AppIcon';
import { brand } from '../../theme';

interface Props {
  department?: MarketplaceDepartment;
  title: string;
  selectedNodeId: string;
  onSelect: (node: TaxonomyNode) => void;
}

/**
 * Where the seller files a listing.
 *
 * Amazon and Facebook Marketplace both make this a drill-down, not a menu: you
 * pick a department, then a category, then the thing itself. The old version
 * laid all 104 leaves out as chips, which is unreadable and pushes sellers onto
 * whichever chip they see first — the same misfiling that makes browse useless.
 * Search and the title hint stay, because they are the fast paths for a seller
 * who already knows what they are listing.
 */
export function ListingClassifier({ department, title, selectedNodeId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(!selectedNodeId);
  // The group currently being drilled into; null is the department list.
  const [browseId, setBrowseId] = useState<string | null>(department ?? null);

  const selected = getTaxonomyNode(selectedNodeId);
  const suggestions = useMemo(
    () => classifyListing({ title, department, limit: 3 }),
    [title, department],
  );
  const hits = useMemo(
    () => (query.trim().length >= 2 ? searchTaxonomy(query, { limit: 8 }) : []),
    [query],
  );

  const browseNode = browseId ? getTaxonomyNode(browseId) : undefined;
  const children = useMemo<TaxonomyNode[]>(() => {
    if (!browseNode) {
      const departments = MARKETPLACE_DEPARTMENTS.map((id) => getTaxonomyNode(id)).filter(
        (row): row is TaxonomyNode => Boolean(row),
      );
      // The escape hatch sits last at the top level, so a seller with something
      // genuinely unlisted has a way through instead of a dead tap.
      const other = getTaxonomyNode(OTHER_TAXONOMY_NODE_ID);
      return other ? [...departments, other] : departments;
    }
    return getTaxonomyChildren(browseNode.id).filter(
      (child) => child.id !== OTHER_TAXONOMY_NODE_ID,
    );
  }, [browseNode]);

  const crumbs = useMemo(
    () => (browseNode ? getTaxonomyPath(browseNode.id) : []),
    [browseNode],
  );

  const pick = (node: TaxonomyNode) => {
    onSelect(node);
    setOpen(false);
    setQuery('');
    setBrowseId(node.parentId);
  };

  const step = (node: TaxonomyNode) => {
    if (isTaxonomyLeaf(node)) {
      pick(node);
      return;
    }
    setBrowseId(node.id);
  };

  return (
    <View className="mb-4">
      <Text className="text-sm font-semibold text-lantern-text mb-1">Listing type *</Text>
      <Text className="text-xs text-lantern-text-secondary mb-2">
        Search, use the title hint, or pick your way down the catalog.
      </Text>
      {selected && !open ? (
        <Pressable
          onPress={() => {
            setOpen(true);
            setBrowseId(selected.parentId);
          }}
          className="p-3 rounded-xl border border-lantern-primary bg-lantern-surface mb-2"
        >
          <Text className="text-[11px] text-lantern-text-secondary">
            {taxonomyPathLabel(selected.id)}
          </Text>
          <Text className="text-sm font-semibold text-lantern-text mt-0.5">{selected.label}</Text>
          <Text className="text-xs text-lantern-primary-text mt-1">Change</Text>
        </Pressable>
      ) : null}
      {(open || !selected) && (
        <View className="rounded-xl border border-lantern-border bg-lantern-surface p-3">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search types — smartphone, past questions, hostel…"
            placeholderTextColor="#94a3b8"
            className="p-3 rounded-xl border border-lantern-border bg-lantern-background text-lantern-text mb-3"
          />
          {hits.length > 0
            ? hits.map((hit) => (
                <Pressable
                  key={hit.node.id}
                  onPress={() => pick(hit.node)}
                  className="py-2.5 border-b border-lantern-border"
                >
                  <Text className="text-sm font-medium text-lantern-text">{hit.node.label}</Text>
                  <Text className="text-[11px] text-lantern-text-secondary">{hit.pathLabel}</Text>
                </Pressable>
              ))
            : null}
          {title.trim().length >= 4 && query.trim().length < 2
            ? suggestions.map((row) => (
                <Pressable
                  key={row.node.id}
                  onPress={() => pick(row.node)}
                  className="py-2.5 border-b border-lantern-border"
                >
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-medium text-lantern-text flex-1">
                      {row.node.label}
                    </Text>
                    <AppIcon name="sparkles" size={14} color="#0f766e" />
                  </View>
                  <Text className="text-[11px] text-lantern-text-secondary">
                    {taxonomyPathLabel(row.node.id)}
                  </Text>
                </Pressable>
              ))
            : null}

          {query.trim().length < 2 ? (
            <View className="mt-2">
              <View className="flex-row items-center flex-wrap mb-1">
                <Pressable
                  onPress={() => setBrowseId(null)}
                  accessibilityRole="button"
                  accessibilityLabel="All departments"
                  className="py-1"
                >
                  <Text
                    className={`text-[11px] ${
                      browseNode ? 'text-lantern-primary-text' : 'font-semibold text-lantern-text'
                    }`}
                  >
                    All departments
                  </Text>
                </Pressable>
                {crumbs.map((crumb, index) => (
                  <React.Fragment key={crumb.id}>
                    <Text className="px-1 text-[11px] text-lantern-text-tertiary">›</Text>
                    <Pressable
                      onPress={() => setBrowseId(crumb.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Back to ${crumb.label}`}
                      className="py-1"
                    >
                      <Text
                        className={`text-[11px] ${
                          index === crumbs.length - 1
                            ? 'font-semibold text-lantern-text'
                            : 'text-lantern-primary-text'
                        }`}
                      >
                        {crumb.label}
                      </Text>
                    </Pressable>
                  </React.Fragment>
                ))}
              </View>

              {children.map((child) => {
                const leaf = isTaxonomyLeaf(child);
                const count = leaf ? 0 : descendantLeaves(child.id).length;
                const chosen = selectedNodeId === child.id;
                return (
                  <Pressable
                    key={child.id}
                    onPress={() => step(child)}
                    accessibilityRole="button"
                    accessibilityLabel={leaf ? `Choose ${child.label}` : `Open ${child.label}`}
                    className="flex-row items-center py-2.5 border-b border-lantern-border"
                    style={{ minHeight: 48 }}
                  >
                    <View className="flex-1 pr-2">
                      <Text
                        className={`text-sm ${
                          chosen
                            ? 'font-semibold text-lantern-primary-text'
                            : 'font-medium text-lantern-text'
                        }`}
                      >
                        {child.label}
                      </Text>
                      {count > 0 ? (
                        <Text className="text-[11px] text-lantern-text-tertiary">
                          {count} {count === 1 ? 'type' : 'types'}
                        </Text>
                      ) : null}
                    </View>
                    <AppIcon
                      name={leaf ? (chosen ? 'checkmark-circle' : 'ellipse') : 'chevron-forward'}
                      size={leaf ? 18 : 16}
                      color={chosen ? brand.text : '#94a3b8'}
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  classifyListing,
  getTaxonomyLeaves,
  getTaxonomyNode,
  searchTaxonomy,
  taxonomyPathLabel,
  type MarketplaceDepartment,
  type TaxonomyNode,
} from '@lantern/shared/marketplace';

interface Props {
  department?: MarketplaceDepartment;
  title: string;
  selectedNodeId: string;
  onSelect: (node: TaxonomyNode) => void;
}

function groupedLeaves(department?: MarketplaceDepartment) {
  const groups = new Map<string, TaxonomyNode[]>();
  for (const leaf of getTaxonomyLeaves()) {
    if (leaf.id === 'custom.other') continue;
    if (department && leaf.department !== department) continue;
    const parent = leaf.parentId ? getTaxonomyNode(leaf.parentId) : undefined;
    const group = parent?.label || leaf.department;
    const list = groups.get(group) || [];
    list.push(leaf);
    groups.set(group, list);
  }
  return Array.from(groups.entries());
}

export function ListingClassifier({ department, title, selectedNodeId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(!selectedNodeId);
  const selected = getTaxonomyNode(selectedNodeId);
  const suggestions = useMemo(
    () => classifyListing({ title, department, limit: 3 }),
    [title, department],
  );
  const hits = useMemo(
    () => (query.trim().length >= 2 ? searchTaxonomy(query, { limit: 8 }) : []),
    [query],
  );
  const groups = useMemo(() => groupedLeaves(department), [department]);
  const otherGroups = useMemo(
    () => groupedLeaves(department === 'academic' ? 'student-life' : 'academic'),
    [department],
  );

  const pick = (node: TaxonomyNode) => {
    onSelect(node);
    setOpen(false);
    setQuery('');
  };

  return (
    <View className="mb-4">
      <Text className="text-sm font-semibold text-lantern-text mb-1">Listing type *</Text>
      <Text className="text-xs text-lantern-text-secondary mb-2">
        Search, use the title hint, or browse the campus catalog.
      </Text>
      {selected && !open ? (
        <Pressable
          onPress={() => setOpen(true)}
          className="p-3 rounded-xl border border-lantern-primary bg-lantern-surface mb-2"
        >
          <Text className="text-[11px] text-lantern-text-secondary">{taxonomyPathLabel(selected.id)}</Text>
          <Text className="text-sm font-semibold text-lantern-text mt-0.5">{selected.label}</Text>
          <Text className="text-xs text-lantern-primary mt-1">Change</Text>
        </Pressable>
      ) : null}
      {(open || !selected) && (
        <View className="rounded-xl border border-lantern-border bg-lantern-surface p-3">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search types — past questions, hostel…"
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
                    <Text className="text-sm font-medium text-lantern-text flex-1">{row.node.label}</Text>
                    <Ionicons name="sparkles-outline" size={14} color="#0f766e" />
                  </View>
                  <Text className="text-[11px] text-lantern-text-secondary">
                    {taxonomyPathLabel(row.node.id)}
                  </Text>
                </Pressable>
              ))
            : null}
          {query.trim().length < 2
            ? [...groups, ...(department ? otherGroups : [])].map(([label, leaves]) => (
                <View key={label} className="mt-2">
                  <Text className="text-[11px] font-semibold uppercase text-lantern-text-secondary mb-1">
                    {label}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {leaves.map((leaf) => (
                      <Pressable
                        key={leaf.id}
                        onPress={() => pick(leaf)}
                        className={`px-3 py-1.5 rounded-full border ${
                          selectedNodeId === leaf.id
                            ? 'bg-lantern-primary border-lantern-primary'
                            : 'border-lantern-border'
                        }`}
                      >
                        <Text
                          className={`text-xs font-medium ${
                            selectedNodeId === leaf.id ? 'text-white' : 'text-lantern-text-secondary'
                          }`}
                        >
                          {leaf.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            : null}
        </View>
      )}
    </View>
  );
}

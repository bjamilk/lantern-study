import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  filterCampusesByQuery,
  formatCampusLabel,
  type MarketplaceCampus,
} from '@lantern/shared/marketplace';
import { AppIcon } from '../../components/ui/AppIcon';

export type MarketplaceCampusOption = Pick<
  MarketplaceCampus,
  'id' | 'name' | 'city' | 'state' | 'slug'
> & {
  country_code?: string;
};

interface CampusPickerProps {
  campuses: MarketplaceCampusOption[];
  value: string;
  onChange: (campusId: string) => void;
  emptyLabel: string;
  allowEmpty?: boolean;
  searchPlaceholder?: string;
}

export function CampusPicker({
  campuses,
  value,
  onChange,
  emptyLabel,
  allowEmpty = false,
  searchPlaceholder = 'Search universities, polytechnics, or cities…',
}: CampusPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedCampus = campuses.find(campus => campus.id === value);
  const filteredCampuses = useMemo(
    () => filterCampusesByQuery(campuses, query).slice(0, 40),
    [campuses, query]
  );

  const selectCampus = (campusId: string) => {
    onChange(campusId);
    setQuery('');
    setOpen(false);
  };

  return (
    <View>
      <Pressable
        onPress={() => setOpen(current => !current)}
        accessibilityRole="button"
        accessibilityLabel={selectedCampus ? formatCampusLabel(selectedCampus) : emptyLabel}
        accessibilityState={{ expanded: open }}
        className="min-h-[48px] p-3 rounded-xl border border-lantern-border bg-lantern-surface flex-row items-center justify-between"
      >
        <View className="flex-1 pr-2">
          <Text
            numberOfLines={2}
            className={selectedCampus ? 'text-lantern-text' : 'text-lantern-text-secondary'}
          >
            {selectedCampus ? formatCampusLabel(selectedCampus) : emptyLabel}
          </Text>
        </View>
        <AppIcon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#64748b"
        />
      </Pressable>

      {open ? (
        <View className="mt-2 border border-lantern-border rounded-xl bg-lantern-surface overflow-hidden">
          <View className="flex-row items-center border-b border-lantern-border px-3">
            <AppIcon name="search" size={16} color="#94a3b8" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor="#94a3b8"
              accessibilityLabel="Search campuses and cities"
              className="flex-1 min-h-[44px] ml-2 text-sm text-lantern-text"
            />
          </View>
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 256 }}
          >
            {allowEmpty ? (
              <Pressable
                onPress={() => selectCampus('')}
                accessibilityRole="button"
                className={`min-h-[44px] px-3 py-2.5 justify-center border-b border-lantern-border/50 ${
                  !value ? 'bg-lantern-primary-background' : ''
                }`}
              >
                <Text className={`text-sm ${!value ? 'font-semibold text-lantern-primary' : 'text-lantern-text'}`}>
                  {emptyLabel}
                </Text>
              </Pressable>
            ) : null}

            {campuses.length === 0 ? (
              <Text className="p-3 text-sm text-lantern-text-secondary">
                Loading campuses and cities…
              </Text>
            ) : filteredCampuses.length === 0 ? (
              <Text className="p-3 text-sm text-lantern-text-secondary">
                No matches. Try another spelling or choose Other (city in Nigeria).
              </Text>
            ) : (
              filteredCampuses.map(campus => {
                const selected = campus.id === value;
                return (
                  <Pressable
                    key={campus.id}
                    onPress={() => selectCampus(campus.id)}
                    accessibilityRole="button"
                    className={`min-h-[52px] px-3 py-2 border-b border-lantern-border/50 justify-center ${
                      selected ? 'bg-lantern-primary-background' : ''
                    }`}
                  >
                    <Text className={`text-sm ${selected ? 'font-semibold text-lantern-primary' : 'text-lantern-text'}`}>
                      {campus.name}
                    </Text>
                    <Text className="text-xs text-lantern-text-secondary mt-0.5">
                      {[campus.city, campus.state].filter(Boolean).join(', ')}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

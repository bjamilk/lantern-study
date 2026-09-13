import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { shopDepartmentDiscs, type MarketplaceDepartment } from '@lantern/shared/marketplace';
import { FeatureDisc } from '../../../components/ui';
import { AppIcon, type AppIconName } from '../../../components/ui/AppIcon';

const DEPARTMENT_ICONS: Record<MarketplaceDepartment, AppIconName> = {
  electronics: 'phone-portrait',
  'study-materials': 'school',
  housing: 'home',
  'fashion-beauty': 'shirt',
  'food-groceries': 'restaurant',
  services: 'briefcase',
  transport: 'car',
  'events-tickets': 'ticket',
  'campus-essentials': 'sparkle',
};

export function ShopDepartmentRow({
  selected,
  onSelect,
}: {
  selected?: string | null;
  onSelect: (id: MarketplaceDepartment) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="Shop departments"
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      className="py-2"
    >
      {shopDepartmentDiscs().map((dept) => {
        const active = selected === dept.id;
        return (
          <Pressable
            key={dept.id}
            onPress={() => onSelect(dept.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className="items-center min-w-[72px] min-h-[44px]"
          >
            <FeatureDisc
              feature={dept.feature}
              size={40}
              icon={DEPARTMENT_ICONS[dept.id]}
            />
            <Text
              className={`text-label text-center mt-1.5 ${
                active ? 'text-lantern-text' : 'text-lantern-text-secondary'
              }`}
            >
              {dept.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

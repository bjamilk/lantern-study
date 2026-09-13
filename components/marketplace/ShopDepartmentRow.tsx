import React from 'react';
import { shopDepartmentDiscs, type MarketplaceDepartment } from '@lantern/shared/marketplace';
import FeatureDisc from '../ui/FeatureDisc';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

const DEPARTMENT_ICONS: Record<MarketplaceDepartment, AppIconName> = {
  electronics: 'phone-portrait',
  'study-materials': 'school',
  housing: 'home',
  'fashion-beauty': 'bag',
  'food-groceries': 'bag',
  services: 'briefcase',
  transport: 'truck',
  'events-tickets': 'ticket',
  'campus-essentials': 'sparkles',
};

export function ShopDepartmentRow({
  selected,
  onSelect,
}: {
  selected?: string | null;
  onSelect: (id: MarketplaceDepartment) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" aria-label="Shop departments">
      {shopDepartmentDiscs().map((dept) => {
        const active = selected === dept.id;
        return (
          <button
            key={dept.id}
            type="button"
            onClick={() => onSelect(dept.id)}
            className={`shrink-0 flex flex-col items-center gap-1.5 min-w-[72px] min-h-[44px] px-1 ${
              active ? 'text-lantern-text' : 'text-lantern-text-secondary'
            }`}
          >
            <FeatureDisc
              feature={dept.feature}
              size={40}
              icon={<AppIcon name={DEPARTMENT_ICONS[dept.id]} size={18} />}
            />
            <span className="text-label text-center leading-tight">{dept.label}</span>
          </button>
        );
      })}
    </div>
  );
}

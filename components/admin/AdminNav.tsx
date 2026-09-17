import React from 'react';
import { AppIcon } from '../ui/AppIcon';
import { Label } from '../ui/Text';
import { ADMIN_TAB_GROUPS, AdminTab } from './types';

interface AdminNavProps {
  activeTab: AdminTab;
  onSelect: (tab: AdminTab) => void;
  badges?: Partial<Record<AdminTab, number>>;
  variant: 'rail' | 'strip';
}

export const AdminNav: React.FC<AdminNavProps> = ({ activeTab, onSelect, badges, variant }) => {
  if (variant === 'strip') {
    return (
      <nav aria-label="Admin sections" className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin">
        {ADMIN_TAB_GROUPS.map((group, index) => (
          <React.Fragment key={group.id}>
            {index > 0 ? (
              <span
                aria-hidden
                className="mx-1 h-6 w-px shrink-0 self-center bg-lantern-border"
              />
            ) : null}
            {group.tabs.map((tab) => (
              <NavButton
                key={tab.id}
                tab={tab}
                active={activeTab === tab.id}
                badge={badges?.[tab.id]}
                compact
                onSelect={onSelect}
              />
            ))}
          </React.Fragment>
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-5">
      {ADMIN_TAB_GROUPS.map((group) => (
        <div key={group.id} className="space-y-1">
          <Label className="uppercase tracking-wide text-lantern-text-muted px-3">{group.label}</Label>
          <div className="flex flex-col gap-0.5">
            {group.tabs.map((tab) => (
              <NavButton
                key={tab.id}
                tab={tab}
                active={activeTab === tab.id}
                badge={badges?.[tab.id]}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
};

function NavButton({
  tab,
  active,
  badge,
  compact,
  onSelect,
}: {
  tab: { id: AdminTab; label: string; icon: React.ComponentProps<typeof AppIcon>['name'] };
  active: boolean;
  badge?: number;
  compact?: boolean;
  onSelect: (tab: AdminTab) => void;
}) {
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <button
      type="button"
      title={tab.label}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(tab.id)}
      className={`inline-flex items-center gap-2 min-h-[44px] font-semibold transition-colors ${
        compact
          ? `shrink-0 rounded-full px-3 ${
              active
                ? 'bg-lantern-ink text-lantern-surface'
                : 'text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text'
            }`
          : `w-full rounded-lantern px-3 py-2 text-left ${
              active
                ? 'bg-lantern-ink text-lantern-surface'
                : 'text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text'
            }`
      }`}
    >
      <AppIcon name={tab.icon} size={18} className="shrink-0" />
      <span className={compact ? 'text-caption' : 'text-body truncate'}>{tab.label}</span>
      {showBadge ? (
        <span
          className={`${compact ? '' : 'ml-auto '}tabular-nums text-label rounded-full px-1.5 py-0.5 ${
            active ? 'bg-lantern-surface/20 text-lantern-surface' : 'bg-lantern-accent-background text-lantern-accent'
          }`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export default AdminNav;

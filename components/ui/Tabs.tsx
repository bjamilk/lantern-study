import React, { createContext, useContext, useId, useLayoutEffect, useMemo } from 'react';
import { useRovingTabIndex } from '../../hooks/useRovingTabIndex';

type TabsVariant = 'underline' | 'pills' | 'segmented';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  baseId: string;
  ariaLabel?: string;
  variant: TabsVariant;
  orientation: 'horizontal' | 'vertical';
  getTabIndex: (index: number) => number;
  registerItem: (index: number, el: HTMLButtonElement | null) => void;
  handleKeyDown: (event: React.KeyboardEvent, index: number) => void;
  registerTabIndex: (value: string, index: number) => void;
  getTabIndexForValue: (value: string) => number;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs components must be used within <Tabs>');
  return ctx;
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  'aria-label'?: string;
  orientation?: 'horizontal' | 'vertical';
  variant?: TabsVariant;
  className?: string;
}

export function Tabs({
  value,
  onValueChange,
  children,
  'aria-label': ariaLabel,
  orientation = 'horizontal',
  variant = 'underline',
  className = '',
}: TabsProps) {
  const baseId = useId();
  const indexByValue = React.useRef<Record<string, number>>({});
  const values = React.useRef<string[]>([]);
  const [itemCount, setItemCount] = React.useState(0);

  const registerTabIndex = React.useCallback((tabValue: string, index: number) => {
    indexByValue.current[tabValue] = index;
    values.current[index] = tabValue;
    setItemCount((prev) => Math.max(prev, index + 1));
  }, []);

  const getTabIndexForValue = React.useCallback((tabValue: string) => {
    return indexByValue.current[tabValue] ?? 0;
  }, []);

  const selectedIndex = getTabIndexForValue(value);
  const { getTabIndex, registerItem, handleKeyDown } = useRovingTabIndex({
    itemCount: itemCount || 1,
    selectedIndex,
    orientation,
    onSelect: (index) => {
      const next = values.current[index];
      if (next) onValueChange(next);
    },
  });

  const context = useMemo(
    () => ({
      value,
      onValueChange,
      baseId,
      ariaLabel,
      variant,
      orientation,
      getTabIndex,
      registerItem,
      handleKeyDown,
      registerTabIndex,
      getTabIndexForValue,
    }),
    [ariaLabel, baseId, getTabIndex, getTabIndexForValue, handleKeyDown, onValueChange, orientation, registerItem, registerTabIndex, value, variant]
  );

  return (
    <TabsContext.Provider value={context}>
      <div className={className} data-tabs-root>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabList({
  children,
  className = '',
  variant,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  variant?: TabsVariant;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ctx = useTabsContext();
  const listVariant = variant ?? ctx.variant;
  const variantClass =
    listVariant === 'pills'
      ? 'gap-1'
      : listVariant === 'segmented'
        ? 'gap-1 rounded-lantern bg-lantern-background-secondary p-1'
        : 'gap-1 border-b border-lantern-border';

  return (
    <div
      role="tablist"
      aria-label={ctx.ariaLabel}
      aria-orientation={ctx.orientation}
      className={`flex ${ctx.orientation === 'vertical' ? 'flex-col' : 'flex-row'} ${variantClass} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  value: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  index?: number;
}

export function Tab({ value, children, icon, badge, disabled, className = '', style, index = 0 }: TabProps) {
  const ctx = useTabsContext();
  useLayoutEffect(() => {
    ctx.registerTabIndex(value, index);
  }, [ctx, value, index]);
  const selected = ctx.value === value;
  const tabId = `${ctx.baseId}-tab-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;

  const variantClass =
    ctx.variant === 'pills'
      ? selected
        ? 'bg-lantern-primary text-white'
        : 'text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text'
      : ctx.variant === 'segmented'
        ? selected
          ? 'bg-lantern-surface text-lantern-text shadow-sm'
          : 'text-lantern-text-secondary hover:text-lantern-text'
        : selected
          ? 'text-lantern-primary bg-lantern-surface border border-b-0 border-lantern-border'
          : 'text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary';

  return (
    <button
      id={tabId}
      ref={(el) => ctx.registerItem(index, el)}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={ctx.getTabIndex(index)}
      disabled={disabled}
      onClick={() => ctx.onValueChange(value)}
      onKeyDown={(event) => ctx.handleKeyDown(event, index)}
      className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors min-h-[44px] ${variantClass} ${className}`}
      style={style}
    >
      {icon}
      {children}
      {badge}
    </button>
  );
}

export function TabPanel({
  value,
  children,
  className = '',
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = useTabsContext();
  const selected = ctx.value === value;
  if (!selected) return null;
  const tabId = `${ctx.baseId}-tab-${value}`;
  const panelId = `${ctx.baseId}-panel-${value}`;
  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={tabId}
      className={className}
    >
      {children}
    </div>
  );
}

import React, { createContext, useContext, useId, useRef, useState } from 'react';
import { useMenuKeyboard } from '../../hooks/useMenuKeyboard';
import { useDismissableLayer } from '../../hooks/useDismissableLayer';

interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  menuId: string;
  triggerId: string;
  registerItem: (index: number, el: HTMLButtonElement | null) => void;
  setTrigger: (el: HTMLButtonElement | null) => void;
  handleMenuKeyDown: (event: React.KeyboardEvent) => void;
  closeMenu: () => void;
  itemIndex: () => number;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext(): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error('Menu components must be used within <Menu>');
  return ctx;
}

export function Menu({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const baseId = useId();
  const menuId = `${baseId}-menu`;
  const triggerId = `${baseId}-trigger`;
  const itemCounter = useRef(0);
  itemCounter.current = 0;

  const { registerItem, setTrigger, handleMenuKeyDown, closeMenu } = useMenuKeyboard({
    open,
    itemCount: 32,
    onOpenChange: setOpen,
  });

  const itemIndex = () => itemCounter.current++;

  return (
    <MenuContext.Provider
      value={{
        open,
        setOpen,
        menuId,
        triggerId,
        registerItem,
        setTrigger,
        handleMenuKeyDown,
        closeMenu,
        itemIndex,
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}

export function MenuTrigger({
  children,
  'aria-label': ariaLabel,
  className = '',
}: {
  children: React.ReactNode;
  'aria-label'?: string;
  className?: string;
}) {
  const ctx = useMenuContext();
  return (
    <button
      id={ctx.triggerId}
      ref={ctx.setTrigger}
      type="button"
      aria-haspopup="menu"
      aria-expanded={ctx.open}
      aria-controls={ctx.menuId}
      aria-label={ariaLabel}
      onClick={() => ctx.setOpen(!ctx.open)}
      className={className}
    >
      {children}
    </button>
  );
}

export function MenuContent({
  children,
  align = 'end',
  placement = 'bottom',
  className = '',
}: {
  children: React.ReactNode;
  align?: 'start' | 'end';
  placement?: 'top' | 'bottom';
  className?: string;
}) {
  const ctx = useMenuContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  useDismissableLayer(ctx.open, containerRef, ctx.closeMenu);

  if (!ctx.open) return null;

  const alignClass = align === 'end' ? 'right-0' : 'left-0';
  const placementClass =
    placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';

  return (
    <div ref={containerRef} className="relative">
      <div
        id={ctx.menuId}
        role="menu"
        aria-labelledby={ctx.triggerId}
        onKeyDown={ctx.handleMenuKeyDown}
        className={`absolute ${alignClass} ${placementClass} min-w-[12rem] bg-lantern-surface rounded-lantern-xl shadow-xl ring-1 ring-lantern-border z-20 py-1 animate-in fade-in slide-in-from-top-2 duration-150 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  destructive,
  disabled,
  className = '',
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const ctx = useMenuContext();
  const index = ctx.itemIndex();

  return (
    <button
      ref={(el) => ctx.registerItem(index, el)}
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        ctx.closeMenu();
      }}
      className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 transition-colors ${
        destructive
          ? 'text-lantern-error hover:bg-lantern-error/10'
          : 'text-lantern-text hover:bg-lantern-background-secondary'
      } disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-lantern-border" />;
}

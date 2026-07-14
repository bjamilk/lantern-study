import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useMenuKeyboard } from '../../hooks/useMenuKeyboard';
import { useDismissableLayer } from '../../hooks/useDismissableLayer';

interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  menuId: string;
  triggerId: string;
  registerItem: (index: number, el: HTMLButtonElement | null) => void;
  setTrigger: (el: HTMLButtonElement | null) => void;
  getTrigger: () => HTMLButtonElement | null;
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

  const { registerItem, setTrigger, getTrigger, handleMenuKeyDown, closeMenu } = useMenuKeyboard({
    open,
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
        getTrigger,
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
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  useDismissableLayer(ctx.open, containerRef, ctx.closeMenu);

  const updatePosition = () => {
    const trigger = ctx.getTrigger();
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.max(containerRef.current?.offsetWidth || 192, 192);
    let left = align === 'end' ? rect.right - menuWidth : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    const top =
      placement === 'top'
        ? Math.max(8, rect.top - 8)
        : Math.min(window.innerHeight - 8, rect.bottom + 8);
    setCoords({ top, left, width: menuWidth });
  };

  useLayoutEffect(() => {
    if (!ctx.open) {
      setCoords(null);
      return;
    }
    updatePosition();
  }, [ctx.open, align, placement]);

  useEffect(() => {
    if (!ctx.open) return;
    const onReposition = () => updatePosition();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [ctx.open, align, placement]);

  if (!ctx.open || typeof document === 'undefined') return null;

  const style: React.CSSProperties =
    placement === 'top'
      ? {
          position: 'fixed',
          left: coords?.left ?? 0,
          bottom: coords ? window.innerHeight - coords.top + 8 : 72,
          width: coords?.width,
          zIndex: 100,
        }
      : {
          position: 'fixed',
          left: coords?.left ?? 0,
          top: coords?.top ?? 0,
          width: coords?.width,
          zIndex: 100,
        };

  return createPortal(
    <div
      ref={containerRef}
      id={ctx.menuId}
      role="menu"
      aria-labelledby={ctx.triggerId}
      onKeyDown={ctx.handleMenuKeyDown}
      style={style}
      className={`min-w-[12rem] bg-lantern-surface rounded-lantern-xl shadow-xl ring-1 ring-lantern-border py-1 animate-in fade-in duration-150 ${className}`}
    >
      {children}
    </div>,
    document.body
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
      className={`w-full text-left px-4 py-2.5 min-h-[44px] text-sm flex items-center gap-2.5 transition-colors ${
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

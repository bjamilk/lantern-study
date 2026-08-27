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
import { ChevronRightIcon } from '@heroicons/react/24/outline';
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
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  'aria-label'?: string;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
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
      className={className}
      {...rest}
      onClick={(event) => {
        // Parent screens often close menus on bubble; keep the toggle local.
        event.stopPropagation();
        onClick?.(event);
        if (event.defaultPrevented) return;
        ctx.setOpen(!ctx.open);
      }}
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
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    resolvedPlacement: 'top' | 'bottom';
  } | null>(null);
  useDismissableLayer(ctx.open, containerRef, ctx.closeMenu);

  const updatePosition = () => {
    const trigger = ctx.getTrigger();
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.max(containerRef.current?.offsetWidth || 192, 192);
    let left = align === 'end' ? rect.right - menuWidth : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

    const gutter = 8;
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gutter * 2);
    const spaceAbove = Math.max(0, rect.top - gutter * 2);
    const preferTop =
      placement === 'top' ||
      (placement === 'bottom' && spaceBelow < 240 && spaceAbove > spaceBelow);
    const resolvedPlacement: 'top' | 'bottom' = preferTop ? 'top' : 'bottom';
    const available = preferTop ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(160, Math.min(available, Math.floor(window.innerHeight * 0.7)));
    const top = preferTop ? Math.max(gutter, rect.top - gutter) : rect.bottom + gutter;

    setCoords({ top, left, width: menuWidth, maxHeight, resolvedPlacement });
  };

  useLayoutEffect(() => {
    if (!ctx.open) {
      setCoords(null);
      return;
    }
    updatePosition();
    // Remeasure after paint so maxHeight matches actual content width/height needs.
    const raf = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(raf);
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

  const resolvedPlacement = coords?.resolvedPlacement ?? placement;
  const style: React.CSSProperties =
    resolvedPlacement === 'top'
      ? {
          position: 'fixed',
          left: coords?.left ?? 0,
          bottom: coords ? window.innerHeight - coords.top : 72,
          width: coords?.width,
          maxHeight: coords?.maxHeight,
          zIndex: 100,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        }
      : {
          position: 'fixed',
          left: coords?.left ?? 0,
          top: coords?.top ?? 0,
          width: coords?.width,
          maxHeight: coords?.maxHeight ?? '70vh',
          zIndex: 100,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
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
  closeOnSelect = true,
  className = '',
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /** When false, keep the parent menu open (used by nested submenu triggers). */
  closeOnSelect?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useMenuContext();
  const index = ctx.itemIndex();

  return (
    <button
      ref={(el) => ctx.registerItem(index, el)}
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={`w-full text-left px-4 py-2.5 min-h-[44px] text-sm flex items-center gap-2.5 transition-colors ${
        destructive
          ? 'text-lantern-error hover:bg-lantern-error/10'
          : 'text-lantern-text hover:bg-lantern-background-secondary'
      } disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...rest}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
        if (disabled || event.defaultPrevented) return;
        onSelect?.();
        if (closeOnSelect) ctx.closeMenu();
      }}
    >
      {icon}
      {children}
    </button>
  );
}

export function MenuSubmenu({
  label,
  icon,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className = '',
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const ctx = useMenuContext();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const index = ctx.itemIndex();
  const submenuId = useId();

  return (
    <div>
      <button
        ref={(el) => ctx.registerItem(index, el)}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={submenuId}
        className={`w-full text-left px-4 py-2.5 min-h-[44px] text-sm flex items-center gap-2.5 text-lantern-text hover:bg-lantern-background-secondary transition-colors ${className}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        {icon}
        <span className="flex-1 min-w-0">{label}</span>
        <ChevronRightIcon
          className={`w-4 h-4 flex-shrink-0 text-lantern-text-tertiary transition-transform ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={submenuId} role="group" className="pb-0.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-lantern-border" />;
}

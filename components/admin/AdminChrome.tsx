import React from 'react';
import { Body, Caption, Heading, Label } from '../ui/Text';

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Label className="uppercase text-lantern-text-muted">{eyebrow}</Label>
        <Heading className="text-lantern-text mt-1">{title}</Heading>
        {description ? (
          <Caption className="text-lantern-text-secondary mt-1 max-w-2xl">{description}</Caption>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AdminSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ id: T; label: string; badge?: number }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-1 rounded-lantern border border-lantern-border bg-lantern-surface p-1"
    >
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`inline-flex items-center gap-1.5 rounded-lantern px-3 min-h-[40px] font-semibold text-caption transition-colors ${
              active
                ? 'bg-lantern-ink text-lantern-surface'
                : 'text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text'
            }`}
          >
            {opt.label}
            {typeof opt.badge === 'number' && opt.badge > 0 ? (
              <span
                className={`tabular-nums text-label rounded-full px-1.5 py-0.5 ${
                  active ? 'bg-lantern-surface/20 text-lantern-surface' : 'bg-lantern-accent-background text-lantern-accent'
                }`}
              >
                {opt.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export type AdminTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

const TONE: Record<AdminTone, string> = {
  success: 'bg-emerald-50 text-lantern-success dark:bg-emerald-950/30',
  warning: 'bg-lantern-accent-background text-lantern-accent',
  danger: 'bg-red-50 text-lantern-error dark:bg-red-950/30',
  neutral: 'bg-lantern-background-secondary text-lantern-text-secondary',
  accent: 'bg-lantern-feature-campus-tint text-lantern-feature-campus-ink',
};

export function AdminStatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: AdminTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-label font-semibold uppercase tracking-wide ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function AdminEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lantern border border-dashed border-lantern-border px-4 py-8 text-center">
      <Caption className="text-lantern-text-muted">{children}</Caption>
    </div>
  );
}

export function AdminTable({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lantern border border-lantern-border">
      <table className="w-full">
        <thead>
          <tr className="border-b border-lantern-border bg-lantern-background-secondary/60">
            {headers.map((header) => (
              <th key={header} className="px-3 py-2.5 text-left">
                <Label className="uppercase text-lantern-text-muted">{header}</Label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function AdminKpi({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string | number;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-lantern border border-lantern-border bg-lantern-surface ${
        compact ? 'px-3 py-2.5' : 'p-4'
      }`}
    >
      <Caption className="text-lantern-text-secondary">{label}</Caption>
      {compact ? (
        <Body as="p" numeral className="font-semibold text-lantern-text mt-0.5">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </Body>
      ) : (
        <Heading as="p" numeral className="text-lantern-text mt-1">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </Heading>
      )}
    </div>
  );
}

export function AdminToolbar({
  children,
  actions,
}: {
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children ? <div className="flex flex-wrap items-center gap-2 min-w-0">{children}</div> : null}
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AdminRowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-nowrap items-center justify-end gap-1">{children}</div>;
}

export function AdminActionDivider() {
  return <span aria-hidden className="hidden sm:block w-px self-stretch min-h-[32px] bg-lantern-border" />;
}

export function AdminSectionTitle({
  title,
  description,
  meta,
}: {
  title: string;
  description?: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading className="text-lantern-text">{title}</Heading>
        {meta}
      </div>
      {description ? (
        <Caption className="text-lantern-text-muted mt-1">{description}</Caption>
      ) : null}
    </div>
  );
}

export function AdminMetricRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Caption className="text-lantern-text-muted min-w-0 truncate">{label}</Caption>
      <Body as="span" numeral className="font-semibold text-lantern-text shrink-0">
        {value}
      </Body>
    </div>
  );
}

export function AdminColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label as="p" className="uppercase text-lantern-text-muted mb-2">
      {children}
    </Label>
  );
}

export const adminRowClass =
  'border-b border-lantern-border last:border-0 hover:bg-lantern-background-secondary/70 transition-colors';

export const adminCellClass = 'px-3 py-3 text-body text-lantern-text align-middle';

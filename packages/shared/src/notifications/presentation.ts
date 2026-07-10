import type { AppNotification } from '../types';

export type NotificationLinkType =
  | 'challenge'
  | 'offer'
  | 'inquiry'
  | 'listing'
  | 'dm'
  | 'generic';

export interface ParsedNotificationLink {
  type: NotificationLinkType;
  id?: string;
  threadId?: string;
}

export type NotificationIconKey =
  | 'bell'
  | 'currency'
  | 'chat'
  | 'shopping'
  | 'envelope';

export interface NotificationMeta {
  iconKey: NotificationIconKey;
  label: string | null;
  /** Tailwind classes for web icon badge */
  webColorClass: string;
  /** Hex color for mobile Ionicons */
  mobileIconColor: string;
  /** Tailwind bg class for mobile icon container */
  mobileBgClass: string;
}

export function formatRelativeTime(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (Number.isNaN(seconds)) return '';

  let interval = seconds / 31536000;
  if (interval > 1) return `${Math.floor(interval)}y ago`;
  interval = seconds / 2592000;
  if (interval > 1) return `${Math.floor(interval)}mo ago`;
  interval = seconds / 86400;
  if (interval > 1) return `${Math.floor(interval)}d ago`;
  interval = seconds / 3600;
  if (interval > 1) return `${Math.floor(interval)}h ago`;
  interval = seconds / 60;
  if (interval > 1) return `${Math.floor(interval)}m ago`;
  return 'Just now';
}

export function parseNotificationLink(
  link?: string,
  n?: Pick<AppNotification, 'type' | 'data' | 'link'>
): ParsedNotificationLink | null {
  if (link?.startsWith('challenge:')) {
    return { type: 'challenge', id: link.replace('challenge:', '') };
  }
  if (n?.type?.startsWith('challenge')) {
    const challengeId =
      (n.data?.challengeId as string) ||
      (typeof n.data?.data === 'object'
        ? ((n.data?.data as Record<string, unknown>)?.challengeId as string)
        : undefined) ||
      link?.replace('challenge:', '');
    if (challengeId) return { type: 'challenge', id: challengeId };
  }
  if (link?.startsWith('dm:')) {
    const rest = link.slice(3);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon > 0) {
      return {
        type: 'dm',
        threadId: rest.slice(0, lastColon),
        id: rest.slice(lastColon + 1),
      };
    }
  }
  if (n?.type === 'dm_message' && n.data?.senderId) {
    return {
      type: 'dm',
      threadId: n.data.threadId as string | undefined,
      id: n.data.senderId as string,
    };
  }
  if (!link) return null;
  const parts = link.split(':');
  if (parts[0] !== 'marketplace' || parts.length < 3) return null;
  const subType = parts[1];
  if (subType === 'offer' || subType === 'inquiry' || subType === 'listing') {
    return { type: subType, id: parts[2] };
  }
  return { type: 'generic', id: parts[2] };
}

export function getNotificationMeta(
  link?: string,
  n?: Pick<AppNotification, 'type' | 'data' | 'link'>
): NotificationMeta {
  const parsed = parseNotificationLink(link, n);
  if (!parsed) {
    return {
      iconKey: 'bell',
      label: null,
      webColorClass: 'text-lantern-primary bg-lantern-primary-background',
      mobileIconColor: '#4f46e5',
      mobileBgClass: 'bg-lantern-primary-background',
    };
  }
  switch (parsed.type) {
    case 'challenge':
      return {
        iconKey: 'bell',
        label: 'Duel',
        webColorClass: 'text-lantern-error bg-lantern-error/10',
        mobileIconColor: '#dc2626',
        mobileBgClass: 'bg-red-50 dark:bg-red-950/30',
      };
    case 'offer':
      return {
        iconKey: 'currency',
        label: 'Offer',
        webColorClass: 'text-lantern-success bg-lantern-success/10',
        mobileIconColor: '#059669',
        mobileBgClass: 'bg-emerald-50 dark:bg-emerald-950/30',
      };
    case 'inquiry':
      return {
        iconKey: 'chat',
        label: 'Inquiry',
        webColorClass: 'text-lantern-accent bg-lantern-accent-background',
        mobileIconColor: '#d97706',
        mobileBgClass: 'bg-amber-50 dark:bg-amber-950/30',
      };
    case 'listing':
      return {
        iconKey: 'shopping',
        label: 'Listing',
        webColorClass: 'text-lantern-primary-light bg-lantern-primary-background',
        mobileIconColor: '#6366f1',
        mobileBgClass: 'bg-indigo-50 dark:bg-indigo-950/30',
      };
    case 'dm':
      return {
        iconKey: 'chat',
        label: 'Message',
        webColorClass: 'text-sky-600 bg-sky-50 dark:bg-sky-900/30',
        mobileIconColor: '#0ea5e9',
        mobileBgClass: 'bg-sky-50 dark:bg-sky-950/30',
      };
    default:
      return {
        iconKey: 'bell',
        label: null,
        webColorClass: 'text-lantern-primary bg-lantern-primary-background',
        mobileIconColor: '#4f46e5',
        mobileBgClass: 'bg-lantern-primary-background',
      };
  }
}

export function getNotificationMessage(n: {
  message?: string;
  body?: string;
  title?: string;
}): string {
  return n.message || n.body || n.title || '';
}

export function isNotificationRead(n: {
  read?: boolean;
  is_read?: boolean;
}): boolean {
  return Boolean(n.read ?? n.is_read);
}

export function getNotificationDate(n: {
  date?: string;
  created_at?: string;
}): string {
  return n.date || n.created_at || new Date().toISOString();
}

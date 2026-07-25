export type ChatMuteScope = 'group' | 'dm';

export type ChatMuteDurationId = '1h' | '8h' | '24h' | '7d';

export interface ChatMuteDurationOption {
  id: ChatMuteDurationId;
  label: string;
  /** Relative minutes from now. */
  minutes: number;
}

export const CHAT_MUTE_DURATIONS: readonly ChatMuteDurationOption[] = [
  { id: '1h', label: '1 hour', minutes: 60 },
  { id: '8h', label: '8 hours', minutes: 8 * 60 },
  { id: '24h', label: '24 hours', minutes: 24 * 60 },
  { id: '7d', label: '1 week', minutes: 7 * 24 * 60 },
] as const;

export const CHAT_MUTEABLE_NOTIFICATION_TYPES = new Set([
  'group_message',
  'dm_message',
  'dm_message_request',
  'mention',
  'reply',
]);

export function resolveChatMuteDurationMinutes(
  durationId: string | null | undefined,
  durationMinutes?: number | null
): number | null {
  if (typeof durationMinutes === 'number' && Number.isFinite(durationMinutes)) {
    const rounded = Math.round(durationMinutes);
    if (rounded >= 1 && rounded <= 60 * 24 * 30) return rounded;
  }
  const match = CHAT_MUTE_DURATIONS.find((d) => d.id === durationId);
  return match ? match.minutes : null;
}

export function mutedUntilFromMinutes(minutes: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

export function formatMuteUntilLabel(mutedUntil: string | Date | null | undefined): string | null {
  if (!mutedUntil) return null;
  const date = typeof mutedUntil === 'string' ? new Date(mutedUntil) : mutedUntil;
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

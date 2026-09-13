export type ChatInboxFilter = 'all' | 'unread';

export function chatMatchesInboxFilter(
  unreadCount: number | null | undefined,
  filter: ChatInboxFilter,
): boolean {
  if (filter === 'all') return true;
  return (unreadCount || 0) > 0;
}

export type ChatRowKind = 'dm' | 'request' | 'study_group' | 'lounge' | 'listing';

export function chatRowSubtitle(input: {
  kind: ChatRowKind;
  preview?: string | null;
  communityName?: string | null;
  listingTitle?: string | null;
}): string {
  if (input.kind === 'request') return 'Message request';
  if (input.kind === 'listing' && input.listingTitle) {
    return input.preview ? input.preview : input.listingTitle;
  }
  if (input.kind === 'lounge' && input.communityName) {
    return input.preview
      ? `in ${input.communityName} · ${input.preview}`
      : `in ${input.communityName}`;
  }
  return (input.preview || '').trim();
}

/** Canonical web invite URL for a group. */
export function buildGroupInviteLink(inviteId: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://lanternstudy.com';
  return `${origin}/invite/${inviteId}`;
}

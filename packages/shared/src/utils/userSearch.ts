/** Normalize people-search input: trim, lowercase, strip leading @ for username queries. */
export function normalizeUserSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/^@+/, '');
}

/** True when the typed query looks like an @username search. */
export function isUsernameSearchQuery(query: string): boolean {
  return /^@+/.test(query.trim());
}

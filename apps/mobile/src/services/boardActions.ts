// Subpath imports only: mobile's jest `moduleNameMapper` resolves
// `@lantern/shared/<sub>` and nothing else, so the bare specifier makes the
// first test that touches this file die on an unresolvable module.
import { RateLimitError, VersionConflictError } from '@lantern/shared/api';
import {
  BOARD_BOOKMARKS_PAGE_SIZE,
  type BoardBookmarkEntry,
  type BoardRepostRefusal,
} from '@lantern/shared/network';
import { apiClient } from './api';

/** The raw `messages` row the API answers with; `mapApiMessage` normalises it. */
type BoardMessageRow = Record<string, unknown>;

/**
 * The four board-action endpoints (§6 Repost, §7 Bookmark).
 *
 * They are declared here rather than in `packages/shared/src/api/endpoints.ts`
 * only because this slice is scoped to `apps/mobile`; they go through
 * `apiClient` (the same configured transport the shared endpoint set uses) so
 * the 401 refresh, the sign-out on a dead session and the ACCOUNT_SUSPENDED
 * probe all still apply.
 *
 * TODO(shared): fold these into `createApiEndpoints` so web calls the exact
 * same paths and bodies (§9.3 parity rule 4).
 */

const path = (segments: TemplateStringsArray, ...values: string[]) =>
  segments.reduce(
    (acc, part, i) => acc + part + (i < values.length ? encodeURIComponent(values[i]!) : ''),
    '',
  );

/**
 * A refusal the server named, or null when this was something else entirely.
 *
 * The shared client turns a 409 into `VersionConflictError` and a 429 into
 * `RateLimitError` BEFORE either reaches here, and neither carries `.status` —
 * so matching on the status code alone would misread "you already reposted
 * this" (409) and the hourly cap (429) as unknown failures and show the
 * generic "not available yet" copy for both.
 */
export function repostRefusalFrom(error: unknown): BoardRepostRefusal | null {
  if (error instanceof VersionConflictError) return 'already';
  if (error instanceof RateLimitError) return 'tooMany';
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : '';
  if (status === 503) return 'unavailable';
  if (status !== 400) return null;
  // The server answers every 400 with the copy from `COMMUNITY_BOARD_COPY`, so
  // the string it sends IS the string to show. Mapping it back to a typed
  // reason lets the caller decide (e.g. drop the control) instead of only
  // echoing words.
  if (/another board|own board/i.test(message)) return 'notSameBoard';
  if (/original post instead/i.test(message)) return 'isRepost';
  if (/after a day/i.test(message)) return 'ownTooSoon';
  if (/was removed/i.test(message)) return 'removed';
  return null;
}

/** POST /messages/:originalId/repost — the repost lands on the SAME board. */
export async function createBoardRepost(
  originalId: string,
  quote?: string | null,
): Promise<BoardMessageRow> {
  return apiClient.request<BoardMessageRow>(
    path`/messages/${originalId}/repost`,
    { method: 'POST', body: JSON.stringify({ quote: quote?.trim() || '' }) },
    15000,
  );
}

/**
 * DELETE /messages/:originalId/repost — `:messageId` is the ORIGINAL's id on
 * the undo route too, so no client ever has to hold the repost row's id.
 */
export async function undoBoardRepost(
  originalId: string,
): Promise<{ removed: boolean; repostId?: string }> {
  return apiClient.request<{ removed: boolean; repostId?: string }>(
    path`/messages/${originalId}/repost`,
    { method: 'DELETE' },
    15000,
  );
}

/** PUT /messages/:messageId/bookmark. 503 before the migration is applied. */
export async function setMessageBookmark(
  messageId: string,
  bookmarked: boolean,
): Promise<{ bookmarked: boolean }> {
  return apiClient.request<{ bookmarked: boolean }>(
    path`/messages/${messageId}/bookmark`,
    { method: 'PUT', body: JSON.stringify({ bookmarked }) },
    15000,
  );
}

/**
 * GET /messages/group/:groupId/bookmarks — the viewer's saved ids on ONE
 * board, so the icon paints filled on the first frame instead of flipping.
 * `serverBacked: false` means the table is absent and the control must hide.
 */
export async function fetchGroupBookmarks(
  groupId: string,
): Promise<{ messageIds: string[]; serverBacked: boolean }> {
  return apiClient.request<{ messageIds: string[]; serverBacked: boolean }>(
    path`/messages/group/${groupId}/bookmarks`,
    { method: 'GET' },
    10000,
  );
}

/** GET /messages/bookmarks — "Saved posts", every board, newest saved first. */
export async function fetchBookmarkedPosts(options?: {
  limit?: number;
  before?: string | null;
}): Promise<{
  entries: BoardBookmarkEntry[];
  nextCursor: string | null;
  serverBacked: boolean;
}> {
  const params = new URLSearchParams({
    limit: String(options?.limit ?? BOARD_BOOKMARKS_PAGE_SIZE),
  });
  if (options?.before) params.set('before', options.before);
  return apiClient.request<{
    entries: BoardBookmarkEntry[];
    nextCursor: string | null;
    serverBacked: boolean;
  }>(`/messages/bookmarks?${params.toString()}`, { method: 'GET' }, 15000);
}

/**
 * PUT /messages/bookmarks/import — the one-time migration of the device-local
 * saves. Idempotent, so the local key is only deleted after a 2xx.
 */
export async function importBookmarks(
  messageIds: string[],
): Promise<{ imported: number }> {
  return apiClient.request<{ imported: number }>(
    '/messages/bookmarks/import',
    { method: 'PUT', body: JSON.stringify({ messageIds }) },
    20000,
  );
}

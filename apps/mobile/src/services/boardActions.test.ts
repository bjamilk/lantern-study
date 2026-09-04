/**
 * Board action refusals, and the shape of the requests behind them.
 *
 * The interesting bug here is invisible from the route: the shared API client
 * turns a 409 into `VersionConflictError` and a 429 into `RateLimitError`
 * BEFORE either reaches this module, and neither of those carries `.status`.
 * A refusal mapper written against status codes alone would therefore read
 * "you already reposted this" (409) and the hourly cap (429) as unknown
 * failures and show the generic "Reposting is not available yet" for both.
 */
const request = jest.fn();

jest.mock('./api', () => ({
  apiClient: {
    request: (...args: unknown[]) => (request as any)(...args),
    requestRaw: jest.fn(),
    requestText: jest.fn(),
    getBaseUrl: () => 'https://api.test',
  },
}));

import { RateLimitError, VersionConflictError } from '@lantern/shared/api';
import { COMMUNITY_BOARD_COPY, boardRepostRefusalCopy } from '@lantern/shared/network';
import {
  createBoardRepost,
  fetchBookmarkedPosts,
  fetchGroupBookmarks,
  importBookmarks,
  repostRefusalFrom,
  setMessageBookmark,
  undoBoardRepost,
} from './boardActions';

const httpError = (status: number, message: string) => {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
};

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({});
});

describe('repostRefusalFrom', () => {
  it('reads a 409 that arrived as a VersionConflictError', () => {
    // Not `status === 409`: the client already swallowed the status.
    expect(repostRefusalFrom(new VersionConflictError('already', null))).toBe('already');
    expect(boardRepostRefusalCopy('already')).toBe(COMMUNITY_BOARD_COPY.repostAlready);
  });

  it('reads a 429 that arrived as a RateLimitError', () => {
    expect(repostRefusalFrom(new RateLimitError('slow down', 1000))).toBe('tooMany');
    expect(boardRepostRefusalCopy('tooMany')).toBe(COMMUNITY_BOARD_COPY.repostTooMany);
  });

  it('maps every 400 the server can answer with, by its own copy', () => {
    const cases: Array<[string, string]> = [
      [COMMUNITY_BOARD_COPY.repostNotSameBoard, 'notSameBoard'],
      [COMMUNITY_BOARD_COPY.repostOfRepost, 'isRepost'],
      [COMMUNITY_BOARD_COPY.repostOwnTooSoon, 'ownTooSoon'],
      [COMMUNITY_BOARD_COPY.repostRemoved, 'removed'],
    ];
    for (const [message, reason] of cases) {
      expect(repostRefusalFrom(httpError(400, message))).toBe(reason);
    }
  });

  it('treats a 503 as the migration not being applied', () => {
    expect(repostRefusalFrom(httpError(503, 'nope'))).toBe('unavailable');
  });

  it('returns null for anything it does not recognise, so the caller shows the server words', () => {
    expect(repostRefusalFrom(httpError(500, 'boom'))).toBeNull();
    expect(repostRefusalFrom(httpError(404, 'Post not found or access denied'))).toBeNull();
    expect(repostRefusalFrom(new Error('offline'))).toBeNull();
    expect(repostRefusalFrom(null)).toBeNull();
  });
});

describe('request shapes', () => {
  it('posts a repost to the ORIGINAL id and trims the quote', () => {
    void createBoardRepost('orig-1', '  still the best timetable  ');
    const [path, init] = request.mock.calls[0]!;
    expect(path).toBe('/messages/orig-1/repost');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ quote: 'still the best timetable' });
  });

  it('sends an empty quote rather than null for a bare repost', () => {
    void createBoardRepost('orig-1');
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({ quote: '' });
  });

  it('undoes against the ORIGINAL id too, so no client holds the repost row id', () => {
    void undoBoardRepost('orig-1');
    const [path, init] = request.mock.calls[0]!;
    expect(path).toBe('/messages/orig-1/repost');
    expect(init.method).toBe('DELETE');
  });

  it('encodes ids into the path', () => {
    void setMessageBookmark('a/b?c', true);
    expect(request.mock.calls[0]![0]).toBe('/messages/a%2Fb%3Fc/bookmark');
  });

  it('puts the bookmark flag in the body, not in the path', () => {
    void setMessageBookmark('m1', false);
    const [path, init] = request.mock.calls[0]!;
    expect(path).toBe('/messages/m1/bookmark');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ bookmarked: false });
  });

  it('reads one board’s saved ids from the per-group endpoint', () => {
    void fetchGroupBookmarks('g1');
    expect(request.mock.calls[0]![0]).toBe('/messages/group/g1/bookmarks');
  });

  it('pages Saved posts with a keyset cursor, never an offset', () => {
    void fetchBookmarkedPosts({ limit: 20, before: '2026-09-01T00:00:00.000Z' });
    expect(request.mock.calls[0]![0]).toBe(
      '/messages/bookmarks?limit=20&before=2026-09-01T00%3A00%3A00.000Z'
    );
  });

  it('omits the cursor on the first page', () => {
    void fetchBookmarkedPosts();
    expect(request.mock.calls[0]![0]).toBe('/messages/bookmarks?limit=20');
  });

  it('imports through the idempotent bulk route', () => {
    void importBookmarks(['a', 'b']);
    const [path, init] = request.mock.calls[0]!;
    expect(path).toBe('/messages/bookmarks/import');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ messageIds: ['a', 'b'] });
  });
});

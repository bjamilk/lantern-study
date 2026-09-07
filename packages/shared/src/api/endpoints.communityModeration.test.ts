/**
 * Community moderation wrappers (Wave 8 · lane E).
 *
 * These tests pin the CONTRACT the two clients build against: the exact path
 * and body each wrapper sends, and the typed NOT_ENABLED failure a
 * pre-migration 503 becomes. A wrapper that silently changed its body would
 * otherwise only be caught by a moderator in production.
 */
import {
  COMMUNITY_NOT_ENABLED_CODE,
  COMMUNITY_NOT_ENABLED_COPY,
  createApiEndpoints,
  isNotEnabledError,
} from './endpoints';
import type { ApiClient } from './client';

function createClient(request: jest.Mock): ApiClient {
  return {
    request,
    requestRaw: jest.fn(),
    requestText: jest.fn(),
    getBaseUrl: () => 'https://example.test',
  };
}

/** The shape `client.request` throws for a non-ok response. */
function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function lastCall(request: jest.Mock): { path: string; init: RequestInit } {
  const call = request.mock.calls[request.mock.calls.length - 1];
  return { path: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

function body(request: jest.Mock): Record<string, unknown> {
  const { init } = lastCall(request);
  return JSON.parse(String(init.body ?? '{}'));
}

describe('community roles', () => {
  it('posts the role to the member role route', async () => {
    const request = jest.fn().mockResolvedValue({ userId: 'u-2', role: 'moderator' });
    const api = createApiEndpoints(createClient(request));

    await expect(
      api.setCommunityMemberRole('c-1', 'u-2', 'moderator'),
    ).resolves.toEqual({ userId: 'u-2', role: 'moderator' });

    expect(lastCall(request).path).toBe('/communities/c-1/members/u-2/role');
    expect(lastCall(request).init.method).toBe('POST');
    expect(body(request)).toEqual({ role: 'moderator' });
  });

  it('leaves a 403 refusal alone — a permission failure is not a missing migration', async () => {
    const request = jest.fn().mockRejectedValue(httpError(403, 'Only the community owner can change roles'));
    const api = createApiEndpoints(createClient(request));

    await expect(api.setCommunityMemberRole('c-1', 'u-2', 'admin')).rejects.toMatchObject({
      status: 403,
      message: 'Only the community owner can change roles',
    });
  });
});

describe('community mutes', () => {
  it('sends the duration, and the reason only when there is one', async () => {
    const request = jest.fn().mockResolvedValue({ userId: 'u-2', mutedUntil: '2026-09-08T00:00:00.000Z' });
    const api = createApiEndpoints(createClient(request));

    await api.muteCommunityMember('c-1', 'u-2', { duration: '24h' });
    expect(lastCall(request).path).toBe('/communities/c-1/members/u-2/mute');
    expect(body(request)).toEqual({ duration: '24h' });

    await api.muteCommunityMember('c-1', 'u-2', { duration: '7d', reason: 'Spam' });
    expect(body(request)).toEqual({ duration: '7d', reason: 'Spam' });
  });

  it('unmutes through the same route with no duration', async () => {
    const request = jest.fn().mockResolvedValue({ userId: 'u-2', mutedUntil: null });
    const api = createApiEndpoints(createClient(request));

    await expect(api.unmuteCommunityMember('c-1', 'u-2')).resolves.toEqual({
      userId: 'u-2',
      mutedUntil: null,
    });
    expect(lastCall(request).path).toBe('/communities/c-1/members/u-2/mute');
    expect(lastCall(request).init.method).toBe('POST');
    expect(body(request)).toEqual({});
  });

  it('maps the pre-migration 503 to the typed NOT_ENABLED failure', async () => {
    const request = jest.fn().mockRejectedValue(httpError(503, 'Muting is not available yet'));
    const api = createApiEndpoints(createClient(request));

    const error = await api.muteCommunityMember('c-1', 'u-2', { duration: '1h' }).catch((e) => e);

    expect(isNotEnabledError(error)).toBe(true);
    expect(error.code).toBe(COMMUNITY_NOT_ENABLED_CODE);
    expect(error.status).toBe(503);
    // The student-facing string is ours; the server's wording is kept for logs.
    expect(error.message).toBe(COMMUNITY_NOT_ENABLED_COPY);
    expect(error.serverMessage).toBe('Muting is not available yet');
  });

  it('does not treat a 500 as a missing migration', async () => {
    const request = jest.fn().mockRejectedValue(httpError(500, 'Internal server error'));
    const api = createApiEndpoints(createClient(request));

    const error = await api.unmuteCommunityMember('c-1', 'u-2').catch((e) => e);
    expect(isNotEnabledError(error)).toBe(false);
    expect(error.status).toBe(500);
  });
});

describe('community post removal', () => {
  it('deletes through the community-scoped route with a reason', async () => {
    const request = jest.fn().mockResolvedValue({ id: 'p-1', removedAt: '2026-09-07T10:00:00.000Z' });
    const api = createApiEndpoints(createClient(request));

    await api.removeCommunityPost('c-1', 'p-1', { reason: 'Off topic' });
    expect(lastCall(request).path).toBe('/communities/c-1/posts/p-1');
    expect(lastCall(request).init.method).toBe('DELETE');
    expect(body(request)).toEqual({ reason: 'Off topic' });
  });

  it('sends an empty body when no reason is given', async () => {
    const request = jest.fn().mockResolvedValue({ id: 'p-1', removedAt: '2026-09-07T10:00:00.000Z' });
    const api = createApiEndpoints(createClient(request));

    await api.removeCommunityPost('c-1', 'p-1');
    expect(body(request)).toEqual({});
  });
});

describe('community invites', () => {
  it('converts expiresInHours to the milliseconds the API takes', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ code: 'ABCD2345', expiresAt: '2026-09-14T00:00:00.000Z', maxUses: 25, uses: 0 });
    const api = createApiEndpoints(createClient(request));

    await api.createCommunityInvite('c-1', { expiresInHours: 48, maxUses: 10 });
    expect(lastCall(request).path).toBe('/communities/c-1/invites');
    expect(body(request)).toEqual({ expiresInMs: 48 * 60 * 60 * 1000, maxUses: 10 });
  });

  it('omits both fields so the server applies its own defaults', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ code: 'ABCD2345', expiresAt: '2026-09-14T00:00:00.000Z', maxUses: 25, uses: 0 });
    const api = createApiEndpoints(createClient(request));

    await api.createCommunityInvite('c-1');
    expect(body(request)).toEqual({});

    await api.createCommunityInvite('c-1', { expiresInHours: 0, maxUses: -3 });
    expect(body(request)).toEqual({});
  });

  it('lists live invites and revokes one by code', async () => {
    const request = jest.fn().mockResolvedValue([]);
    const api = createApiEndpoints(createClient(request));

    await api.listCommunityInvites('c-1');
    expect(lastCall(request).path).toBe('/communities/c-1/invites');

    request.mockResolvedValue({ revoked: true });
    await api.revokeCommunityInvite('c-1', 'ABCD2345');
    expect(lastCall(request).path).toBe('/communities/c-1/invites/ABCD2345');
    expect(lastCall(request).init.method).toBe('DELETE');
  });

  it('maps a pre-migration invite 503 to NOT_ENABLED on every invite wrapper', async () => {
    const request = jest.fn().mockRejectedValue(httpError(503, 'Invite links is not available yet'));
    const api = createApiEndpoints(createClient(request));

    for (const call of [
      () => api.createCommunityInvite('c-1'),
      () => api.listCommunityInvites('c-1'),
      () => api.revokeCommunityInvite('c-1', 'ABCD2345'),
      () => api.joinCommunityByCode('ABCD2345'),
    ]) {
      const error = await call().catch((e) => e);
      expect(isNotEnabledError(error)).toBe(true);
      expect(error.message).toBe(COMMUNITY_NOT_ENABLED_COPY);
    }
  });

  it('redeems a code through the fixed join-by-code route', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ joined: true, communityId: 'c-1', slug: 'ui-med', name: 'UI Medicine' });
    const api = createApiEndpoints(createClient(request));

    await expect(api.joinCommunityByCode('ABCD2345')).resolves.toEqual({
      joined: true,
      communityId: 'c-1',
      slug: 'ui-med',
      name: 'UI Medicine',
    });
    expect(lastCall(request).path).toBe('/communities/join-by-code');
    expect(body(request)).toEqual({ code: 'ABCD2345' });
  });

  it('keeps the single refusal string — a 404 is never rewritten into a reason', async () => {
    const request = jest
      .fn()
      .mockRejectedValue(httpError(404, 'That invite link is not valid any more. Ask for a new one.'));
    const api = createApiEndpoints(createClient(request));

    const error = await api.joinCommunityByCode('ABCD2345').catch((e) => e);
    expect(isNotEnabledError(error)).toBe(false);
    expect(error.message).toBe('That invite link is not valid any more. Ask for a new one.');
  });
});

describe('board posts and discovery', () => {
  it('carries postKind on a board post create', async () => {
    const request = jest.fn().mockResolvedValue({ id: 'm-1' });
    const api = createApiEndpoints(createClient(request));

    await api.sendMessage('g-1', 'u-1', {
      content: 'Exam moved to Friday',
      subject: 'Exam moved',
      postKind: 'announcement',
    });

    expect(lastCall(request).path).toBe('/messages/group/g-1');
    expect(body(request)).toMatchObject({
      content: 'Exam moved to Friday',
      subject: 'Exam moved',
      postKind: 'announcement',
      userId: 'u-1',
    });
  });

  it('passes kind and q through to the discover route', async () => {
    const request = jest.fn().mockResolvedValue([]);
    const api = createApiEndpoints(createClient(request));

    await api.discoverCommunities({ kind: 'club', q: 'chess' });
    expect(lastCall(request).path).toBe('/discover/communities?q=chess&kind=club');

    await api.discoverCommunities();
    expect(lastCall(request).path).toBe('/discover/communities');
  });
});

/**
 * The two group-list refreshes on web — the bootstrap load and the
 * membership-change realtime refresh — both run `mergeFetchedGroups`. Before
 * refactor R2 they were two inline copies, and NEITHER carried
 * `communitySurface`: a community study group re-rendered as a board after
 * every refresh, because absent means 'board'.
 */

import { describe, expect, it } from 'vitest';
import { mergeFetchedGroups } from './groupListMerge';
import type { Group } from '../types';

const existingGroup = (over: Partial<Group> = {}): Group =>
  ({
    id: 'g1',
    name: 'Bio 101',
    members: [{ id: 'u1', name: 'Ada' }],
    adminIds: ['u1'],
    communityId: 'comm-1',
    communitySurface: 'study_group',
    courseId: 'course-1',
    visibility: 'community',
    memberCount: 12,
    unreadCount: 3,
    ...over,
  }) as unknown as Group;

describe('mergeFetchedGroups', () => {
  it('keeps communitySurface and communityId the server did send', () => {
    const merged = mergeFetchedGroups(
      [{ id: 'g1', name: 'Bio 101', communityId: 'comm-1', communitySurface: 'study_group' }],
      [],
    );
    expect(merged[0].communitySurface).toBe('study_group');
    expect(merged[0].communityId).toBe('comm-1');
  });

  it('carries communitySurface over when the refresh row omits it (bootstrap)', () => {
    // A compact list row, or a pre-migration server, answers without the column.
    const merged = mergeFetchedGroups([{ id: 'g1', name: 'Bio 101' }], [existingGroup()]);
    expect(merged[0].communitySurface).toBe('study_group');
    expect(merged[0].communityId).toBe('comm-1');
    expect(merged[0].courseId).toBe('course-1');
    expect(merged[0].visibility).toBe('community');
  });

  it('carries them over on a membership-change refresh too', () => {
    const afterJoin = mergeFetchedGroups(
      [{ id: 'g1', name: 'Bio 101', member_count: 13 }],
      [existingGroup()],
      { g1: 0 },
    );
    expect(afterJoin[0].communitySurface).toBe('study_group');
    expect(afterJoin[0].communityId).toBe('comm-1');
    expect(afterJoin[0].memberCount).toBe(13);
  });

  it('lets a real server value win over the carried-over one', () => {
    const merged = mergeFetchedGroups(
      [{ id: 'g1', name: 'Bio 101', communitySurface: 'board', communityId: 'comm-2' }],
      [existingGroup()],
    );
    expect(merged[0].communitySurface).toBe('board');
    expect(merged[0].communityId).toBe('comm-2');
  });

  it('lets an explicit null detach the group instead of resurrecting the old value', () => {
    // The API puts these columns on the wire as literal `null`. Before review
    // H0 the `?? fallback` chain read that as "absent" and refilled it from the
    // previous UI state, so a detached group kept rendering in the community.
    const merged = mergeFetchedGroups(
      [
        {
          id: 'g1',
          name: 'Bio 101',
          community_id: null,
          community_surface: null,
          course_id: null,
        },
      ],
      [existingGroup()],
    );
    expect(merged[0].communityId).toBeNull();
    expect(merged[0].communitySurface).toBeNull();
    expect(merged[0].courseId).toBeNull();
  });

  it('still carries the omitted fields over on the same refresh shape', () => {
    // Guard against "fix by never falling back": a row with none of the keys
    // must behave exactly as before.
    const merged = mergeFetchedGroups([{ id: 'g1', name: 'Bio 101' }], [existingGroup()]);
    expect(merged[0].communityId).toBe('comm-1');
    expect(merged[0].communitySurface).toBe('study_group');
    expect(merged[0].courseId).toBe('course-1');
  });

  it('keeps the member emails and moderator ids the list endpoint omits', () => {
    const merged = mergeFetchedGroups(
      [{ id: 'g1', name: 'Bio 101' }],
      [
        existingGroup({
          memberEmails: ['ada@campus.edu'],
          moderatorIds: ['u2'],
        } as Partial<Group>),
      ],
    );
    expect(merged[0].memberEmails).toEqual(['ada@campus.edu']);
    expect(merged[0].moderatorIds).toEqual(['u2']);
  });

  it('preserves the loaded roster and pending members the list endpoint omits', () => {
    const merged = mergeFetchedGroups([{ id: 'g1', name: 'Bio 101' }], [
      existingGroup({ members: [{ id: 'u1', name: 'Ada' }] as unknown as Group['members'] }),
    ]);
    expect(merged[0].members).toHaveLength(1);
    expect((merged[0] as Group & { pendingMembers: unknown[] }).pendingMembers).toEqual([]);
  });

  it('takes unread counts only from the freshly fetched map', () => {
    const merged = mergeFetchedGroups(
      [{ id: 'g1', name: 'Bio 101', unread_count: 99 }],
      [existingGroup({ unreadCount: 3 })],
      { g1: 5 },
    );
    expect(merged[0].unreadCount).toBe(5);
    expect(
      mergeFetchedGroups([{ id: 'g1', name: 'Bio 101', unread_count: 99 }], [existingGroup()], {})[0]
        .unreadCount,
    ).toBe(0);
  });

  it('drops a group the refresh no longer returns, and tolerates empty input', () => {
    expect(mergeFetchedGroups([], [existingGroup()])).toEqual([]);
    expect(mergeFetchedGroups(null, [])).toEqual([]);
  });
});

import {
  formatChatSenderLabel,
  getDashboardFirstName,
  resolveGroupChatAvatarUrl,
  resolveGroupChatMentionUsername,
  resolveGroupChatSenderLabel,
} from './displayNames';

describe('getDashboardFirstName', () => {
  it('prefers firstName over display name', () => {
    expect(
      getDashboardFirstName({
        firstName: 'Jane',
        name: 'Jane Doe',
        username: 'janedoe',
      })
    ).toBe('Jane');
  });

  it('uses first word of full name when firstName is missing', () => {
    expect(
      getDashboardFirstName({
        name: 'Alex Smith',
        username: 'alexsmith',
      })
    ).toBe('Alex');
  });

  it('does not use username when name matches username', () => {
    expect(
      getDashboardFirstName({
        name: 'janedoe',
        username: 'janedoe',
      })
    ).toBe('Student');
  });

  it('supports snake_case first_name from API profiles', () => {
    expect(
      getDashboardFirstName({
        first_name: 'Mindi',
        name: 'Mindi Caron',
      })
    ).toBe('Mindi');
  });

  it('does not use long email-like local parts as a greeting name', () => {
    expect(
      getDashboardFirstName({
        name: 'responsive.audit.1784645242',
      })
    ).toBe('Student');
  });
});

describe('formatChatSenderLabel', () => {
  it('prefers real name over @username', () => {
    expect(formatChatSenderLabel({ username: 'dayveedo', name: 'David' })).toBe('David');
  });

  it('falls back to @username when name is missing', () => {
    expect(formatChatSenderLabel({ username: 'dayveedo' })).toBe('@dayveedo');
  });

  it('never returns an empty author label', () => {
    expect(formatChatSenderLabel({})).toBe('Member');
    expect(formatChatSenderLabel({ username: '   ' })).toBe('Member');
  });
});

describe('resolveGroupChatSenderLabel', () => {
  it('resolves display name from roster by userId', () => {
    expect(
      resolveGroupChatSenderLabel(
        { id: 'user-1' },
        [{ id: 'membership-1', userId: 'user-1', username: 'amara', name: 'Amara' }]
      )
    ).toBe('Amara');
  });

  it('falls back to roster @username when display name is unavailable', () => {
    expect(
      resolveGroupChatSenderLabel(
        { id: 'user-1' },
        [{ id: 'user-1', username: 'amara' }]
      )
    ).toBe('@amara');
  });
});

describe('resolveGroupChatMentionUsername', () => {
  it('returns the bare username for composer inserts', () => {
    expect(
      resolveGroupChatMentionUsername(
        { id: 'user-1' },
        [{ id: 'user-1', username: 'amara', name: 'Amara' }]
      )
    ).toBe('amara');
  });
});

describe('resolveGroupChatAvatarUrl', () => {
  it('prefers the current roster avatar over a stale message snapshot', () => {
    expect(
      resolveGroupChatAvatarUrl(
        { id: 'user-1', avatarUrl: 'https://cdn.example/old-avatar.webp' },
        [{ id: 'user-1', avatarUrl: 'https://cdn.example/new-avatar.webp' }]
      )
    ).toBe('https://cdn.example/new-avatar.webp');
  });

  it('supports mobile rosters keyed by userId', () => {
    expect(
      resolveGroupChatAvatarUrl(
        { id: 'user-1', avatarUrl: 'https://cdn.example/old-avatar.webp' },
        [{ id: 'membership-1', userId: 'user-1', avatarUrl: 'https://cdn.example/new-avatar.webp' }]
      )
    ).toBe('https://cdn.example/new-avatar.webp');
  });

  it('does not resurrect a stale message avatar after the roster avatar is removed', () => {
    expect(
      resolveGroupChatAvatarUrl(
        { id: 'user-1', avatarUrl: 'https://cdn.example/old-avatar.webp' },
        [{ id: 'user-1', avatarUrl: undefined }]
      )
    ).toBeUndefined();
  });

  it('falls back to the message avatar when the roster is unavailable', () => {
    expect(
      resolveGroupChatAvatarUrl(
        { id: 'user-1', avatarUrl: 'https://cdn.example/message-avatar.webp' },
        []
      )
    ).toBe('https://cdn.example/message-avatar.webp');
  });
});

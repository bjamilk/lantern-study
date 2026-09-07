import {
  canRecipientReceiveDirectMessage,
  resolveDirectMessageAccess,
  shouldCreateInAppNotification,
  shouldSendExpoPush,
  parseUserSettings,
  buildDmThreadId,
} from './userSettingsPolicy';

describe('userSettingsPolicy', () => {
  const baseSettings = parseUserSettings(null);

  it('blocks in-app notifications when preference is disabled', () => {
    const settings = {
      ...baseSettings,
      notifications: {
        ...baseSettings.notifications,
        marketplaceUpdates: false,
      },
    };
    expect(shouldCreateInAppNotification(settings, 'marketplace_inquiry')).toBe(false);
    expect(shouldCreateInAppNotification(settings, 'warning')).toBe(true);
  });

  it('honours the exam reminders toggle for exam_reminder notifications', () => {
    expect(shouldCreateInAppNotification(baseSettings, 'exam_reminder')).toBe(true);
    const settings = {
      ...baseSettings,
      notifications: {
        ...baseSettings.notifications,
        examReminders: false,
      },
    };
    expect(shouldCreateInAppNotification(settings, 'exam_reminder')).toBe(false);
    expect(shouldSendExpoPush(settings, 'exam_reminder')).toBe(false);
  });

  it('blocks push when pushEnabled is false', () => {
    const settings = {
      ...baseSettings,
      notifications: {
        ...baseSettings.notifications,
        pushEnabled: false,
      },
    };
    expect(shouldSendExpoPush(settings, 'challenge_invite')).toBe(false);
  });

  it('allows push when enabled and type is allowed', () => {
    const settings = {
      ...baseSettings,
      notifications: {
        ...baseSettings.notifications,
        pushEnabled: true,
        groupActivity: true,
      },
    };
    expect(shouldSendExpoPush(settings, 'challenge_invite')).toBe(true);
  });
});

describe('resolveDirectMessageAccess', () => {
  const supabase = {
    from: jest.fn(),
  };

  function mockThreadState(
    state: null | { status: string; requested_by: string | null }
  ) {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.maybeSingle = jest
      .fn()
      .mockResolvedValue(
        state
          ? { data: { id: 'thread', status: state.status, requested_by: state.requested_by }, error: null }
          : { data: null, error: null }
      );
    return chain;
  }

  /** user_blocks is queried twice (forward + reverse). */
  function mockBlockLookup(blocked: boolean) {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.maybeSingle = jest.fn().mockResolvedValue(
      blocked
        ? { data: { blocker_id: 'blocker' }, error: null }
        : { data: null, error: null }
    );
    return chain;
  }

  beforeEach(() => {
    supabase.from.mockReset();
  });

  it('creates a message request when recipient policy is none (not deny)', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') return mockThreadState(null);
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'sender',
      'recipient',
      parseUserSettings({ privacy: { allowDirectMessages: 'none' } })
    );
    expect(result).toEqual({ mode: 'request' });
    expect(supabase.from).not.toHaveBeenCalledWith('group_members');
  });

  it('creates a message request for private profiles even when DMs are everyone', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') return mockThreadState(null);
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'sender',
      'recipient',
      parseUserSettings({
        privacy: { profileVisibility: 'private', allowDirectMessages: 'everyone' },
      })
    );
    expect(result).toEqual({ mode: 'request' });
    expect(supabase.from).not.toHaveBeenCalledWith('group_members');
  });

  it('keeps open threads open for private profiles', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') {
        return mockThreadState({ status: 'open', requested_by: null });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'sender',
      'recipient',
      parseUserSettings({
        privacy: { profileVisibility: 'private', allowDirectMessages: 'none' },
      })
    );
    expect(result).toEqual({ mode: 'allow' });
  });

  it('allows everyone policy without group lookup', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') return mockThreadState(null);
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'sender',
      'recipient',
      parseUserSettings({ privacy: { allowDirectMessages: 'everyone' } })
    );
    expect(result).toEqual({ mode: 'allow' });
  });

  it('allows open marketplace / established threads despite groups-only policy', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') {
        return mockThreadState({ status: 'open', requested_by: null });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'seller-id',
      'buyer-id',
      parseUserSettings({ privacy: { allowDirectMessages: 'groups' } })
    );
    expect(result).toEqual({ mode: 'allow' });
    expect(supabase.from).not.toHaveBeenCalledWith('group_members');
  });

  it('creates a message request for cold DMs under groups policy', async () => {
    let groupMembersCalls = 0;
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') return mockThreadState(null);

      groupMembersCalls += 1;
      const isSenderLookup = groupMembersCalls === 1;
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.eq = jest.fn().mockImplementation((col: string) => {
        if (isSenderLookup && col === 'pending') {
          return Promise.resolve({ data: [{ group_id: 'group-a' }], error: null });
        }
        return chain;
      });
      chain.in = jest.fn().mockResolvedValue({ count: 0, error: null });
      return chain;
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'sender-id',
      'recipient-id',
      parseUserSettings({ privacy: { allowDirectMessages: 'groups' } })
    );
    expect(result).toEqual({ mode: 'request' });
  });

  it('allows groups policy when users share a confirmed group', async () => {
    const sharedGroupId = 'group-abc';
    let groupMembersCalls = 0;
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') return mockThreadState(null);

      groupMembersCalls += 1;
      const isSenderLookup = groupMembersCalls === 1;
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.eq = jest.fn().mockImplementation((col: string) => {
        if (isSenderLookup && col === 'pending') {
          return Promise.resolve({ data: [{ group_id: sharedGroupId }], error: null });
        }
        return chain;
      });
      chain.in = jest.fn().mockResolvedValue({ count: 1, error: null });
      return chain;
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'sender-id',
      'recipient-id',
      parseUserSettings({ privacy: { allowDirectMessages: 'groups' } })
    );
    expect(result).toEqual({ mode: 'allow' });
  });

  it('lets the requester keep messaging a pending request one-way', async () => {
    const sellerId = 'requester';
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') {
        return mockThreadState({ status: 'pending', requested_by: sellerId });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      sellerId,
      'recipient',
      parseUserSettings({ privacy: { allowDirectMessages: 'groups' } })
    );
    expect(result).toEqual({ mode: 'request' });
  });

  it('treats recipient reply on a pending request as allow (opens two-way)', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') {
        return mockThreadState({ status: 'pending', requested_by: 'requester' });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'recipient',
      'requester',
      parseUserSettings({ privacy: { allowDirectMessages: 'groups' } })
    );
    expect(result).toEqual({ mode: 'allow' });
  });

  it('denies cold DMs when either user has blocked the other', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(true);
      if (table === 'dm_threads') return mockThreadState(null);
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'sender',
      'recipient',
      parseUserSettings({ privacy: { allowDirectMessages: 'everyone' } })
    );
    expect(result).toEqual({
      mode: 'deny',
      reason: 'You cannot message this user',
    });
    expect(supabase.from).not.toHaveBeenCalledWith('dm_threads');
  });

  it('denies open-thread continuation when users are blocked', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(true);
      if (table === 'dm_threads') {
        return mockThreadState({ status: 'open', requested_by: null });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'seller-id',
      'buyer-id',
      parseUserSettings({ privacy: { allowDirectMessages: 'groups' } })
    );
    expect(result).toEqual({
      mode: 'deny',
      reason: 'You cannot message this user',
    });
  });

  it('denies blocked pairs before marketplace-style open-thread allow', async () => {
    // Same fixture as open marketplace threads, but block wins first.
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(true);
      if (table === 'dm_threads') {
        return mockThreadState({ status: 'open', requested_by: null });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await resolveDirectMessageAccess(
      supabase as any,
      'buyer-id',
      'seller-id',
      parseUserSettings({ privacy: { allowDirectMessages: 'everyone' } })
    );
    expect(result).toEqual({
      mode: 'deny',
      reason: 'You cannot message this user',
    });
    expect(supabase.from).not.toHaveBeenCalledWith('dm_threads');
  });

  it('compat wrapper reports asRequest for cold groups DMs', async () => {
    let groupMembersCalls = 0;
    supabase.from.mockImplementation((table: string) => {
      if (table === 'user_blocks') return mockBlockLookup(false);
      if (table === 'dm_threads') return mockThreadState(null);
      groupMembersCalls += 1;
      const isSenderLookup = groupMembersCalls === 1;
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.eq = jest.fn().mockImplementation((col: string) => {
        if (isSenderLookup && col === 'pending') {
          return Promise.resolve({ data: [{ group_id: 'g1' }], error: null });
        }
        return chain;
      });
      chain.in = jest.fn().mockResolvedValue({ count: 0, error: null });
      return chain;
    });

    const result = await canRecipientReceiveDirectMessage(
      supabase as any,
      'a',
      'b',
      parseUserSettings({ privacy: { allowDirectMessages: 'groups' } })
    );
    expect(result).toEqual({ allowed: true, asRequest: true });
    expect(buildDmThreadId('b', 'a')).toBe(buildDmThreadId('a', 'b'));
  });
});

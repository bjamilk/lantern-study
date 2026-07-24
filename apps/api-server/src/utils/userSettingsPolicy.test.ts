import {
  canRecipientReceiveDirectMessage,
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

describe('canRecipientReceiveDirectMessage', () => {
  const supabase = {
    from: jest.fn(),
  };

  function mockNoExistingThread() {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    return chain;
  }

  function mockExistingThread(threadId: string) {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.maybeSingle = jest.fn().mockResolvedValue({ data: { id: threadId }, error: null });
    return chain;
  }

  beforeEach(() => {
    supabase.from.mockReset();
  });

  it('rejects when recipient policy is none and no thread exists', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'dm_threads') return mockNoExistingThread();
      throw new Error(`unexpected table ${table}`);
    });

    const result = await canRecipientReceiveDirectMessage(
      supabase as any,
      'sender',
      'recipient',
      parseUserSettings({
        privacy: { allowDirectMessages: 'none' },
      })
    );
    expect(result.allowed).toBe(false);
  });

  it('allows everyone policy without group or thread lookup', async () => {
    const result = await canRecipientReceiveDirectMessage(
      supabase as any,
      'sender',
      'recipient',
      parseUserSettings({
        privacy: { allowDirectMessages: 'everyone' },
      })
    );
    expect(result.allowed).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('allows groups policy when users share a confirmed group', async () => {
    const sharedGroupId = 'group-abc';
    let groupMembersCalls = 0;
    supabase.from.mockImplementation((table: string) => {
      if (table === 'dm_threads') return mockNoExistingThread();

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

    const result = await canRecipientReceiveDirectMessage(
      supabase as any,
      'sender-id',
      'recipient-id',
      parseUserSettings({
        privacy: { allowDirectMessages: 'groups' },
      })
    );
    expect(result.allowed).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('group_members');
  });

  it('rejects groups policy when users do not share a confirmed group and no thread exists', async () => {
    let groupMembersCalls = 0;
    supabase.from.mockImplementation((table: string) => {
      if (table === 'dm_threads') return mockNoExistingThread();

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

    const result = await canRecipientReceiveDirectMessage(
      supabase as any,
      'sender-id',
      'recipient-id',
      parseUserSettings({
        privacy: { allowDirectMessages: 'groups' },
      })
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('This user only accepts direct messages from shared group members');
  });

  it('allows seller reply on an existing marketplace DM thread despite groups-only buyer policy', async () => {
    const sellerId = 'seller-id';
    const buyerId = 'buyer-id';
    const threadId = buildDmThreadId(sellerId, buyerId);

    supabase.from.mockImplementation((table: string) => {
      if (table === 'dm_threads') return mockExistingThread(threadId);
      throw new Error(`unexpected table ${table}`);
    });

    const result = await canRecipientReceiveDirectMessage(
      supabase as any,
      sellerId,
      buyerId,
      parseUserSettings({
        privacy: { allowDirectMessages: 'groups' },
      })
    );
    expect(result.allowed).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('dm_threads');
    expect(supabase.from).not.toHaveBeenCalledWith('group_members');
  });

  it('allows continuing an existing thread even when recipient policy is none', async () => {
    const sellerId = 'seller-id';
    const buyerId = 'buyer-id';
    const threadId = buildDmThreadId(sellerId, buyerId);

    supabase.from.mockImplementation((table: string) => {
      if (table === 'dm_threads') return mockExistingThread(threadId);
      throw new Error(`unexpected table ${table}`);
    });

    const result = await canRecipientReceiveDirectMessage(
      supabase as any,
      sellerId,
      buyerId,
      parseUserSettings({
        privacy: { allowDirectMessages: 'none' },
      })
    );
    expect(result.allowed).toBe(true);
  });
});

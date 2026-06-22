import {
  canRecipientReceiveDirectMessage,
  shouldCreateInAppNotification,
  shouldSendExpoPush,
  parseUserSettings,
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

  beforeEach(() => {
    supabase.from.mockReset();
  });

  it('rejects when recipient policy is none', async () => {
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

  it('allows everyone policy without group lookup', async () => {
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
    let callIndex = 0;
    supabase.from.mockImplementation(() => {
      callIndex += 1;
      const isSenderLookup = callIndex === 1;
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

  it('rejects groups policy when users do not share a confirmed group', async () => {
    let callIndex = 0;
    supabase.from.mockImplementation(() => {
      callIndex += 1;
      const isSenderLookup = callIndex === 1;
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
});

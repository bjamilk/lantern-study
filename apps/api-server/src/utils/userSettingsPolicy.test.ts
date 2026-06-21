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
});

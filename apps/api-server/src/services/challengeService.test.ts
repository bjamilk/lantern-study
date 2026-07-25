import { ChallengeService } from './challengeService';

jest.mock('./cache', () => ({
  cacheService: {
    delete: jest.fn().mockResolvedValue(undefined),
    deletePattern: jest.fn().mockResolvedValue(undefined),
  },
}));

import { cacheService } from './cache';

function createHarness(options: { enforceUniquePending?: boolean } = {}) {
  const rows: any[] = [];
  const notifications: any[] = [];
  const createNotification = jest.fn(async (userId: string, notification: any) => {
    if (
      notifications.some(
        (row) =>
          row.user_id === userId &&
          row.type === notification.type &&
          row.data?.challengeId === notification.data?.challengeId
      )
    ) {
      throw { code: '23505', message: 'duplicate challenge notification' };
    }
    const row = {
      id: `notification-${notifications.length + 1}`,
      user_id: userId,
      type: notification.type,
      data: notification.data,
    };
    notifications.push(row);
    return row;
  });
  const candidateQuestions = [
    {
      id: 'question-1',
      groupId: 'group-1',
      type: 'QUESTION',
      questionType: 'MULTIPLE_CHOICE_SINGLE',
      questionStem: 'What is 2 + 2?',
      options: [{ id: 'four', text: '4' }],
      correctAnswerIds: ['four'],
      questionStatus: 'VERIFIED',
      upvotes: 1,
      downvotes: 0,
      isArchived: false,
    },
  ];

  const db = {
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { id: 'challenger-1', name: 'Challenger', avatar_url: null },
                { id: 'opponent-1', name: 'Opponent', avatar_url: null },
              ],
              error: null,
            }),
          }),
        };
      }

      if (table === 'notifications') {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            let containedData: Record<string, unknown> = {};
            const query = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return query;
              },
              contains(_column: string, value: Record<string, unknown>) {
                containedData = value;
                return query;
              },
              limit() {
                return query;
              },
              maybeSingle: async () => ({
                data:
                  notifications.find(
                    (row) =>
                      Object.entries(filters).every(([key, value]) => row[key] === value) &&
                      Object.entries(containedData).every(
                        ([key, value]) => row.data?.[key] === value
                      )
                  ) || null,
                error: null,
              }),
            };
            return query;
          },
        };
      }

      if (table !== 'group_challenges') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (
                options.enforceUniquePending &&
                rows.some(
                  (row) =>
                    row.group_id === payload.group_id &&
                    row.challenger_id === payload.challenger_id &&
                    row.opponent_id === payload.opponent_id &&
                    row.status === 'pending'
                )
              ) {
                return {
                  data: null,
                  error: { code: '23505', message: 'duplicate pending challenge' },
                };
              }
              const row = {
                id: `challenge-${rows.length + 1}`,
                ...payload,
                created_at: new Date().toISOString(),
              };
              rows.push(row);
              return { data: row, error: null };
            },
          }),
        }),
        select: () => {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return query;
            },
            maybeSingle: async () => ({
              data:
                rows.find((row) =>
                  Object.entries(filters).every(([key, value]) => row[key] === value)
                ) || null,
              error: null,
            }),
          };
          return query;
        },
      };
    }),
  };

  const supabaseService = {
    getClient: () => db,
    createNotification,
    getUserById: jest.fn().mockResolvedValue({ id: 'challenger-1', name: 'Challenger' }),
  } as any;

  const service = new ChallengeService(supabaseService);
  jest.spyOn(service as any, 'expireStalePending').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'ensureGroupMember').mockResolvedValue(true);
  jest.spyOn(service as any, 'loadCandidateQuestions').mockResolvedValue(candidateQuestions);
  jest.spyOn(service as any, 'invalidateChallengeCaches').mockResolvedValue(undefined);
  jest
    .spyOn(service as any, 'mapChallenge')
    .mockImplementation(async (row: any) => ({ id: row.id }));

  return { service, rows, notifications, createNotification };
}

describe('ChallengeService cache invalidation (PERF-01)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scopes invalidation to per-user list keys and never uses challenges:*', async () => {
    // Fresh service without harness spies that stub invalidateChallengeCaches.
    const service = new ChallengeService({ getClient: () => ({}) } as any);
    await (service as any).invalidateChallengeCaches('challenger-1', 'opponent-1');

    const patterns = (cacheService.deletePattern as jest.Mock).mock.calls.map((c) => c[0]);
    expect(patterns).toEqual(
      expect.arrayContaining([
        'challenges:list:challenger-1:*',
        'challenges:list:opponent-1:*',
      ])
    );
    expect(patterns.some((p: string) => p === 'challenges:*')).toBe(false);
    expect(patterns.some((p: string) => /^challenges:[^:]+:\*$/.test(p) && !p.includes('list'))).toBe(
      false
    );

    const exactKeys = (cacheService.delete as jest.Mock).mock.calls.map((c) => c[0]);
    expect(exactKeys).toEqual(
      expect.arrayContaining([
        'challenges:list:challenger-1:all',
        'challenges:list:challenger-1:pending',
        'challenges:list:opponent-1:all',
      ])
    );
  });
});

describe('ChallengeService.createChallenge delivery integrity', () => {
  it('replays the existing pending invite instead of creating and notifying twice', async () => {
    const { service, rows, createNotification } = createHarness();
    const payload = {
      groupId: 'group-1',
      opponentId: 'opponent-1',
      config: { numberOfQuestions: 1 },
    };

    const first = await service.createChallenge('challenger-1', payload);
    const replay = await service.createChallenge('challenger-1', payload);

    expect(replay.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('recovers the winning row when concurrent inserts meet the unique boundary', async () => {
    const { service, rows, notifications } = createHarness({
      enforceUniquePending: true,
    });
    const payload = {
      groupId: 'group-1',
      opponentId: 'opponent-1',
      config: { numberOfQuestions: 1 },
    };

    const [first, replay] = await Promise.all([
      service.createChallenge('challenger-1', payload),
      service.createChallenge('challenger-1', payload),
    ]);

    expect(replay.id).toBe(first.id);
    expect(rows).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });
});

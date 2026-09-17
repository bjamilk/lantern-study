/**
 * The study services' discarded write errors (#108, tail batch 2).
 *
 * Thirteen sites across six files, and one of them is not best-effort at all.
 *
 * ## `studySets.replacePlan` — MUST SUCCEED
 *
 * Replacing a plan is delete-topics, delete-units, then insert the new ones.
 * Both deletes are bare awaits, and the inserts run regardless:
 *
 *  - a failed UNIT delete leaves the old units in place while the new ones are
 *    inserted, so the student's plan is DUPLICATED — and the response lists
 *    only the new half, so nothing looks wrong until they reload;
 *  - a failed TOPIC delete leaves topics belonging to units that are about to
 *    be deleted, which either dangles them or is masked by a cascade that then
 *    makes the first failure invisible.
 *
 * Nothing external has happened at that point — it is our own two tables — so
 * stopping before the inserts leaves the plan exactly as it was. This one gets
 * the full pin-then-flip treatment below.
 *
 * ## The rest
 *
 * Error, with a fingerprint, where a person has to repair something: a study
 * pack draft that never links to its job, or never leaves `generating` — the
 * student's credits were spent on it either way.
 *
 * Warn for the self-healing ones: the `generating` stamp (the `ready` write
 * overwrites it anyway), the room sweep and the last-participant room close
 * (the sweep re-runs), both challenge expiries (re-derived from `expires_at`
 * on the next read), the companion conversation touch, and — after reading it
 * rather than guessing — BOTH presence deletes. The row carries
 * `expires_at = now + PRESENCE_TTL_MINUTES`, so someone who opted out drops off
 * "who is studying now" within ten minutes without anyone repairing anything.
 */
import { scriptedDb, writePayload, type Call } from '../testSupport/scriptedDb';

jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), http: jest.fn() },
}));
jest.mock('../utils/sentry', () => ({
  captureException: jest.fn(),
  captureScopedException: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { logger } = require('../utils/logger') as { logger: { error: jest.Mock; warn: jest.Mock } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { captureScopedException } = require('../utils/sentry') as {
  captureScopedException: jest.Mock;
};

const WRITE_ERROR = { message: 'could not serialize access', code: '40001' };

const isDelete = (call: Call, table: string) =>
  call.table === table && call.ops.some((op) => op.fn === 'delete');
const isInsert = (call: Call, table: string) =>
  call.table === table && call.ops.some((op) => op.fn === 'insert');

beforeEach(() => jest.clearAllMocks());

describe('replacing a study set plan', () => {
  const PLAN = {
    units: [{ title: 'Unit one', position: 0 }],
    topics: [{ unitIndex: 0, title: 'Topic one', position: 0 }],
  };

  const replacePlan = async (failing: 'none' | 'topics' | 'units') => {
    const { StudySetsService } = await import('./studySets');
    const { client, calls } = scriptedDb((call) => {
      if (failing === 'topics' && isDelete(call, 'study_set_topics')) {
        return { data: null, error: WRITE_ERROR };
      }
      if (failing === 'units' && isDelete(call, 'study_set_units')) {
        return { data: null, error: WRITE_ERROR };
      }
      if (isInsert(call, 'study_set_units')) {
        // The inserts come back through `.select()` without a terminal, so the
        // service reads them as ARRAYS.
        return call.terminal === 'then'
          ? { data: [{ id: 'unit_new', title: 'Unit one', position: 0 }], error: null }
          : { data: { id: 'unit_new', title: 'Unit one', position: 0 }, error: null };
      }
      if (isInsert(call, 'study_set_topics')) {
        return call.terminal === 'then'
          ? { data: [{ id: 'topic_new', title: 'Topic one', position: 0 }], error: null }
          : { data: { id: 'topic_new', title: 'Topic one', position: 0 }, error: null };
      }
      // Any other read: a list where the service expects rows, a row where it
      // expects one.
      return call.terminal === 'then'
        ? { data: [], error: null }
        : { data: { id: 'set_1', user_id: 'user_1', title: 'Set' }, error: null };
    });
    const service: any = Object.create(StudySetsService.prototype);
    service.host = { getClient: () => client };
    Object.defineProperty(service, 'db', { get: () => client, configurable: true });
    service.get = jest.fn(async () => ({ id: 'set_1', user_id: 'user_1' }));
    const run = () => service.replacePlan('user_1', 'set_1', PLAN);
    return { run, calls };
  };

  it('clears the old plan before inserting the new one', async () => {
    const { run, calls } = await replacePlan('none');
    await run();
    const topicDelete = calls.findIndex((call) => isDelete(call, 'study_set_topics'));
    const unitDelete = calls.findIndex((call) => isDelete(call, 'study_set_units'));
    const unitInsert = calls.findIndex((call) => isInsert(call, 'study_set_units'));
    expect(topicDelete).toBeGreaterThanOrEqual(0);
    expect(unitDelete).toBeGreaterThan(topicDelete);
    expect(unitInsert).toBeGreaterThan(unitDelete);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does NOT insert the new units when the old ones were not deleted', async () => {
    // The plan would otherwise silently DOUBLE, with the response listing only
    // the new half.
    const { run, calls } = await replacePlan('units');
    await expect(run()).rejects.toThrow(/study_set_units/);
    expect(calls.some((call) => isInsert(call, 'study_set_units'))).toBe(false);
  });

  it('stops at the FIRST delete, so the second one is never attempted', async () => {
    const { run, calls } = await replacePlan('topics');
    await expect(run()).rejects.toThrow(/study_set_topics/);
    expect(calls.some((call) => isDelete(call, 'study_set_units'))).toBe(false);
    expect(calls.some((call) => isInsert(call, 'study_set_units'))).toBe(false);
  });

  it('names the set and what it was clearing', async () => {
    const { WriteFailedError } = await import('./data/writeResult');
    const { run } = await replacePlan('units');
    const error = await run().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WriteFailedError);
    expect((error as InstanceType<typeof WriteFailedError>).context).toEqual(
      expect.objectContaining({ userId: 'user_1', setId: 'set_1', reason: 'replace_plan_clear' }),
    );
  });
});

describe('the study-pack draft status writes', () => {
  const attach = async (fails: boolean) => {
    const { StudyPackFactoryService } = await import('./studyPackFactory');
    const { client } = scriptedDb((call) =>
      fails && call.table === 'study_pack_drafts' ? { data: null, error: WRITE_ERROR } : undefined,
    );
    const service: any = Object.create(StudyPackFactoryService.prototype);
    Object.defineProperty(service, 'db', { get: () => client, configurable: true });
    await service.attachJobId('draft_1', 'job_1');
  };

  it('links the draft to its job and says nothing when it succeeds', async () => {
    await attach(false);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reports an unlinked draft at ERROR level and to Sentry', async () => {
    // The student's credits were spent; a draft that never names its job is one
    // nobody can follow to a refund.
    await attach(true);
    expect(logger.error).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'study_pack_drafts', draftId: 'draft_1', reason: 'link_job' }),
    );
    expect(captureScopedException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ fingerprint: ['studypack-draft-job-link-failed'] }),
    );
  });
});

describe('the presence row of someone who opted out', () => {
  const heartbeat = async (fails: boolean) => {
    const { StudyPresenceService } = await import('./studyPresence');
    const { client, calls } = scriptedDb((call) =>
      fails && isDelete(call, 'study_presence') ? { data: null, error: WRITE_ERROR } : undefined,
    );
    const service: any = Object.create(StudyPresenceService.prototype);
    Object.defineProperty(service, 'db', { get: () => client, configurable: true });
    service.sharesActivity = jest.fn(async () => ({ shares: false, institutionId: null }));
    const result = await service.heartbeat('user_1', { context: 'course' });
    return { result, calls };
  };

  it('removes the row and reports nothing when it succeeds', async () => {
    const { result, calls } = await heartbeat(false);
    expect(result).toEqual({ shared: false });
    expect(calls.some((call) => isDelete(call, 'study_presence'))).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('still answers "not shared" when the delete fails, and only warns', async () => {
    // Warn, not error: the row expires on its own within PRESENCE_TTL_MINUTES.
    const { result } = await heartbeat(true);
    expect(result).toEqual({ shared: false });
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'study_presence', reason: 'opted_out' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(captureScopedException).not.toHaveBeenCalled();
  });
});

describe('the self-healing stamps', () => {
  it('warns when a stale challenge expiry fails', async () => {
    const { ChallengeService } = await import('./challengeService');
    const { client } = scriptedDb((call) =>
      call.table === 'group_challenges' && call.ops.some((op) => op.fn === 'update')
        ? { data: null, error: WRITE_ERROR }
        : { data: null, error: null },
    );
    const service: any = Object.create(ChallengeService.prototype);
    service.data = { getClient: () => client };
    Object.defineProperty(service, 'db', { get: () => client, configurable: true });
    await expect((service as any).expireStalePending()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'group_challenges', reason: 'expire_stale_pending' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('warns when a companion conversation touch fails', async () => {
    const { touchConversation } = await import('./companionConversations');
    const { client } = scriptedDb(() => ({ data: null, error: WRITE_ERROR }));
    await expect(
      touchConversation(client as never, 'user_1', 'conv_1'),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'Database write failed (best-effort)',
      expect.objectContaining({ table: 'ai_companion_conversations', conversationId: 'conv_1' }),
    );
  });
});

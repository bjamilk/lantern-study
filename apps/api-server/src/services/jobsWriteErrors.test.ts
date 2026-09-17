/**
 * The jobs board's discarded write errors (#108, tail batch 1).
 *
 * Nine sites, and reading them splits them cleanly in two.
 *
 * ## Cosmetic (warn)
 *
 *  - `savedSearchMatches` and `processJobSavedSearchAlerts` both advance the
 *    `last_checked_at` watermark on a saved search. A lost one costs a wider
 *    scan next run; the next run also repairs it.
 *  - the external-apply CLICK row, which is analytics.
 *  - stamping a lapsed offer `expired`, which the next attempt re-detects and
 *    re-stamps from the offer's own timestamp.
 *
 * ## State a person has to repair (error, with a fingerprint)
 *
 *  - the `job_applications` row created when someone applies through an
 *    external link. Lose it and the candidate applied and no application
 *    exists — for either side.
 *  - the pipeline advances to `interview` and to `offer`, each written AFTER
 *    the interview or offer row it belongs to. Lose one and the interview is
 *    scheduled or the offer sent while the candidate still reads `new`.
 *  - the final `hired` / `withdrawn` stamp after an offer response.
 *  - the OWNER membership row after a company is created. This one is the
 *    closest to must-succeed in the batch and is handled separately below.
 *
 * None of the nine can usefully throw: each runs after the row it belongs to
 * already exists, so failing the request would report failure for work that
 * partly happened, and a retry would collide with it.
 */
import { JobsBoardService } from './jobsBoard';

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

type Op = { fn: string; args: unknown[] };
type Call = { table: string; ops: Op[] };

/**
 * A chain stub that records the table and every builder call, and asks
 * `resolve` what awaiting it should produce. Shaped like the marketplace
 * suites' `scriptedDb`, but local because the jobs service's `count` queries
 * need `count` in the result.
 */
function jobsDb(resolve: (call: Call) => { data?: unknown; error?: unknown; count?: number } | undefined) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        const ops: Op[] = [];
        const api: any = {};
        for (const fn of [
          'select', 'eq', 'neq', 'in', 'or', 'not', 'is', 'gt', 'gte', 'lt', 'lte',
          'contains', 'textSearch', 'order', 'range', 'limit', 'insert', 'update',
          'upsert', 'delete',
        ]) {
          api[fn] = (...args: unknown[]) => {
            ops.push({ fn, args });
            return api;
          };
        }
        const settle = () => {
          const call: Call = { table, ops };
          calls.push(call);
          return Promise.resolve({ data: null, error: null, count: 0, ...resolve(call) });
        };
        api.single = settle;
        api.maybeSingle = settle;
        api.then = (ok: any, err: any) => settle().then(ok, err);
        return api;
      },
      rpc: async () => ({ data: null, error: null }),
    },
  };
}

function writePayload(call: Call, fn: 'insert' | 'update'): Record<string, unknown> | undefined {
  const op = call.ops.find((candidate) => candidate.fn === fn);
  return op ? (op.args[0] as Record<string, unknown>) : undefined;
}

function serviceFor(resolve: (call: Call) => any) {
  const { client, calls } = jobsDb(resolve);
  const data: any = {
    getClient: () => client,
    notifications: { createNotification: jest.fn(async () => null) },
  };
  return { service: new JobsBoardService(data), calls, data };
}

beforeEach(() => jest.clearAllMocks());

describe('the company owner membership row', () => {
  const createCompany = async (membershipFails: boolean) => {
    const { service, calls } = serviceFor((call) => {
      if (membershipFails && call.table === 'job_company_members') {
        return { data: null, error: WRITE_ERROR };
      }
      if (call.table === 'job_companies') return { data: { id: 'co_1', name: 'Acme' }, error: null };
      return { data: null, error: null };
    });
    const company = await (service as any).createCompany('user_1', {
      legalName: 'Acme Limited',
      displayName: 'Acme',
    });
    return { company, calls };
  };

  it('makes the creator the owner, and says nothing, when it succeeds', async () => {
    const { company, calls } = await createCompany(false);
    expect(company).toEqual(expect.objectContaining({ id: 'co_1' }));
    const membership = calls.find((call) => call.table === 'job_company_members');
    expect(writePayload(membership as Call, 'insert')).toEqual(
      expect.objectContaining({ company_id: 'co_1', user_id: 'user_1', role: 'owner' }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('TODAY: returns the company with nobody owning it, silently', async () => {
    // The creator gets their company back and cannot administer it: there is no
    // membership row naming them owner, and nothing was said.
    const { company } = await createCompany(true);
    expect(company).toEqual(expect.objectContaining({ id: 'co_1' }));
    expect(logger.error).not.toHaveBeenCalled();
    expect(captureScopedException).not.toHaveBeenCalled();
  });
});

describe('the external-apply records', () => {
  const track = async (writesFail: boolean) => {
    const { service, calls } = serviceFor((call) => {
      if (
        writesFail &&
        (call.table === 'job_external_apply_clicks' || call.table === 'job_applications') &&
        call.ops.some((op) => op.fn === 'insert')
      ) {
        return { data: null, error: WRITE_ERROR };
      }
      return { data: null, error: null };
    });
    // `getPosting` and the duplicate check are the service's own reads; stubbing
    // them keeps this test about the two writes rather than about posting
    // validation.
    (service as any).getPosting = jest.fn(async () => ({
      id: 'post_1',
      status: 'active',
      externalUrl: 'https://employer.example/apply',
      deadline: null,
      title: 'Barista',
    }));
    (service as any).getApplicationByPostingAndApplicant = jest.fn(async () => null);
    await (service as any).trackExternalApply('post_1', 'user_2');
    return calls;
  };

  it('records the click and the application when both succeed', async () => {
    const calls = await track(false);
    expect(calls.some((call) => call.table === 'job_external_apply_clicks')).toBe(true);
    const application = calls.find(
      (call) => call.table === 'job_applications' && call.ops.some((op) => op.fn === 'insert'),
    );
    expect(writePayload(application as Call, 'insert')).toEqual(
      expect.objectContaining({ posting_id: 'post_1', applicant_id: 'user_2', source: 'external_click' }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('TODAY: the candidate applied and no application exists, silently', async () => {
    await track(true);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('the saved-search watermark', () => {
  it('TODAY: answers the match count and says nothing when the stamp fails', async () => {
    const { service } = serviceFor((call) => {
      if (call.table === 'job_saved_searches' && call.ops.some((op) => op.fn === 'update')) {
        return { data: null, error: WRITE_ERROR };
      }
      if (call.table === 'job_saved_searches') {
        return { data: { id: 'search_1', user_id: 'user_1', filters: {} }, error: null };
      }
      return { data: null, error: null, count: 3 };
    });
    await expect((service as any).savedSearchMatches('user_1', 'search_1')).resolves.toEqual({
      count: 3,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('the alerts job’s watermark', () => {
  // `processJobSavedSearchAlerts` advances `last_checked_at` even when nothing
  // matched, so the next run scans a smaller window. It is the twin of
  // `savedSearchMatches` above and the same class: a lost stamp costs a wider
  // scan, and the next run repairs it.
  const runAlerts = async (stampFails: boolean) => {
    const { processJobSavedSearchAlerts } = await import('./jobAlerts');
    const client = {
      from(table: string) {
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          gt: () => builder,
          order: () => builder,
          limit: async () => ({ data: [], error: null }),
          update: () => ({
            eq: async () =>
              stampFails ? { data: null, error: WRITE_ERROR } : { data: null, error: null },
          }),
          then: (resolve: (value: unknown) => unknown) =>
            resolve(
              table === 'job_saved_searches'
                ? { data: [{ id: 'search_1', user_id: 'user_1', filters: {}, last_checked_at: null }], error: null }
                : { data: [], error: null },
            ),
        };
        return builder;
      },
    };
    return processJobSavedSearchAlerts({ getClient: () => client } as never);
  };

  it('returns its send count and says nothing when the stamp succeeds', async () => {
    await expect(runAlerts(false)).resolves.toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('TODAY: returns the same count and says nothing when the stamp fails', async () => {
    await expect(runAlerts(true)).resolves.toBe(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

/**
 * The 20260903120000 capability probe (spec §3.1).
 *
 * This repo hand-applies migrations and they lag, so the API ships BEFORE the
 * columns exist and must answer every board request without a 500. The probe
 * is the cheap half; the `mark…Missing()` retry is the correct half. Pinned
 * here:
 *
 *  - a 42703 (read) or PGRST204 (write) means "absent", and the answer is
 *    cached — one probe, not one per query — but only for
 *    CAPABILITY_RECHECK_MS, so hand-applying the migration takes effect
 *    without a redeploy. "Present" is cached for the process;
 *  - concurrent callers share one probe rather than issuing N;
 *  - an UNRELATED failure (network, auth) assumes present and is NOT cached:
 *    caching "absent" off a transient blip would disable pinning until the
 *    next deploy, and the per-query retry already covers being wrong;
 *  - the column lists are appended, never rebuilt, so a caller cannot lose a
 *    column by going through the helper.
 */
import {
  CAPABILITY_RECHECK_MS,
  groupColumns,
  hasGroupCommunitySurface,
  hasMessageBoardColumns,
  isMissingColumnError,
  markGroupCommunitySurfaceMissing,
  messageColumns,
  setSchemaCapabilities,
} from './schemaCapabilities';

function probeDb(result: { error?: unknown }) {
  const probes: string[] = [];
  const db = {
    from: (table: string) => ({
      select: (columns: string) => ({
        limit: async () => {
          probes.push(`${table}:${columns}`);
          return result;
        },
      }),
    }),
  };
  return { db, probes };
}

beforeEach(() => {
  setSchemaCapabilities({ groupCommunitySurface: null, messageBoardColumns: null });
});

describe('isMissingColumnError', () => {
  it('recognises the read and the write code, and nothing else', () => {
    expect(isMissingColumnError({ code: '42703' })).toBe(true);
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true);
    expect(isMissingColumnError({ code: '23505' })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError(new Error('boom'))).toBe(false);
  });
});

describe('capability probes', () => {
  it('probes once and caches the answer', async () => {
    const { db, probes } = probeDb({ error: null });
    await expect(hasGroupCommunitySurface(db)).resolves.toBe(true);
    await expect(hasGroupCommunitySurface(db)).resolves.toBe(true);
    expect(probes).toEqual(['groups:community_surface']);
  });

  it('concurrent callers share one probe', async () => {
    const { db, probes } = probeDb({ error: null });
    await Promise.all([
      hasMessageBoardColumns(db),
      hasMessageBoardColumns(db),
      hasMessageBoardColumns(db),
    ]);
    expect(probes).toEqual(['messages:subject, pinned_at, pinned_by']);
  });

  it('a 42703 means absent, and is cached', async () => {
    const { db, probes } = probeDb({ error: { code: '42703' } });
    await expect(hasGroupCommunitySurface(db)).resolves.toBe(false);
    await expect(hasGroupCommunitySurface(db)).resolves.toBe(false);
    expect(probes).toHaveLength(1);
  });

  it('re-probes after the recheck window, so a hand-applied migration lands without a redeploy', async () => {
    // The ship order deploys this process against a pre-migration database, so
    // the first probe is guaranteed to answer "absent". If that never expired,
    // the API would keep degrading on a fully migrated database.
    const probes: string[] = [];
    let migrated = false;
    const db = {
      from: (table: string) => ({
        select: (columns: string) => ({
          limit: async () => {
            probes.push(`${table}:${columns}`);
            return migrated ? { error: null } : { error: { code: '42703' } };
          },
        }),
      }),
    };

    const start = Date.now();
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(start);
      await expect(hasGroupCommunitySurface(db)).resolves.toBe(false);

      now.mockReturnValue(start + CAPABILITY_RECHECK_MS - 1);
      await expect(hasGroupCommunitySurface(db)).resolves.toBe(false);
      expect(probes).toHaveLength(1);

      migrated = true;
      now.mockReturnValue(start + CAPABILITY_RECHECK_MS);
      await expect(hasGroupCommunitySurface(db)).resolves.toBe(true);
      expect(probes).toHaveLength(2);

      // "Present" does not expire: a column does not disappear, and the
      // per-query retry covers being wrong.
      now.mockReturnValue(start + CAPABILITY_RECHECK_MS * 10);
      await expect(hasGroupCommunitySurface(db)).resolves.toBe(true);
      expect(probes).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it('an unrelated failure assumes present and re-probes next time', async () => {
    const { db, probes } = probeDb({ error: { code: '08006', message: 'connection lost' } });
    await expect(hasGroupCommunitySurface(db)).resolves.toBe(true);
    await expect(hasGroupCommunitySurface(db)).resolves.toBe(true);
    expect(probes).toHaveLength(2);
  });

  it('a throwing client assumes present rather than taking the request down', async () => {
    const db = {
      from: () => ({
        select: () => ({
          limit: () => {
            throw new Error('client exploded');
          },
        }),
      }),
    };
    await expect(hasMessageBoardColumns(db)).resolves.toBe(true);
  });

  it('mark…Missing() flips the cached answer without another probe', async () => {
    const { db, probes } = probeDb({ error: null });
    await expect(hasGroupCommunitySurface(db)).resolves.toBe(true);
    markGroupCommunitySurfaceMissing();
    await expect(hasGroupCommunitySurface(db)).resolves.toBe(false);
    expect(probes).toHaveLength(1);
  });
});

describe('column list helpers', () => {
  it('append rather than rebuild, and are a no-op when the columns are absent', async () => {
    setSchemaCapabilities({ groupCommunitySurface: true, messageBoardColumns: true });
    const db = {};
    await expect(groupColumns(db, 'id, name, community_id')).resolves.toBe(
      'id, name, community_id, community_surface',
    );
    await expect(messageColumns(db, 'id, text')).resolves.toBe(
      'id, text, subject, pinned_at, pinned_by',
    );

    setSchemaCapabilities({ groupCommunitySurface: false, messageBoardColumns: false });
    await expect(groupColumns(db, 'id, name, community_id')).resolves.toBe('id, name, community_id');
    await expect(messageColumns(db, 'id, text')).resolves.toBe('id, text');
  });

  it('tolerates the multi-line select strings the message queries use', async () => {
    setSchemaCapabilities({ messageBoardColumns: true });
    const base = `
      id,
      text,
      profiles!sender_id (
        id,
        name
      )
    `;
    const resolvedColumns = await messageColumns({}, base);
    expect(resolvedColumns.endsWith(') , subject, pinned_at, pinned_by')).toBe(false);
    expect(resolvedColumns.endsWith('), subject, pinned_at, pinned_by')).toBe(true);
  });
});

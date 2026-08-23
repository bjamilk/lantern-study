/**
 * Learning connections (Phase 3 · O): the two invariants that make the
 * north-star metric mean anything — actor <> beneficiary, and one row per
 * (actor, beneficiary, kind) per ISO week — plus the week boundary itself.
 *
 * `isoWeekStart` MUST agree with the SQL trigger
 * (`date_trunc('week', created_at AT TIME ZONE 'UTC')`). If they disagree,
 * per-user counts silently query a week the rows were never written into, and
 * nothing fails loudly. That is what these boundary cases are guarding.
 */
import { LearningConnectionsService, isoWeekStart, CONNECTION_KINDS } from './learningConnections';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function makeService() {
  const inserts: Array<Record<string, unknown>> = [];
  let nextError: { code?: string } | null = null;
  const db: any = {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        inserts.push(payload);
        return Promise.resolve({ error: nextError });
      },
    }),
  };
  const service = new LearningConnectionsService({ getClient: () => db } as any);
  return {
    service,
    inserts,
    failNextWith(error: { code?: string } | null) {
      nextError = error;
    },
  };
}

describe('isoWeekStart', () => {
  it('returns the Monday of the containing week', () => {
    // 2026-08-23 is a Sunday; Postgres puts it in the week starting Mon 17th.
    expect(isoWeekStart(new Date('2026-08-23T12:00:00Z'))).toBe('2026-08-17');
    expect(isoWeekStart(new Date('2026-08-17T00:00:00Z'))).toBe('2026-08-17');
    expect(isoWeekStart(new Date('2026-08-22T23:59:59Z'))).toBe('2026-08-17');
  });

  it('rolls to the next week on Monday 00:00 UTC exactly', () => {
    expect(isoWeekStart(new Date('2026-08-24T00:00:00Z'))).toBe('2026-08-24');
  });

  it('uses UTC, not the host timezone', () => {
    // Late Sunday UTC is already Monday in +02:00. A local-time implementation
    // would report the next week here and miss every row written just before.
    expect(isoWeekStart(new Date('2026-08-23T23:30:00Z'))).toBe('2026-08-17');
  });

  it('handles a year boundary', () => {
    // 2027-01-01 is a Friday — its week starts in the previous year.
    expect(isoWeekStart(new Date('2027-01-01T09:00:00Z'))).toBe('2026-12-28');
  });
});

describe('LearningConnectionsService.record', () => {
  it('writes a valid connection', async () => {
    const { service, inserts } = makeService();
    await service.record({
      actorId: ACTOR,
      beneficiaryId: OTHER,
      kind: 'order_completed',
      objectType: 'order',
      objectId: 'order-1',
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      actor_id: ACTOR,
      beneficiary_id: OTHER,
      kind: 'order_completed',
    });
  });

  it('refuses a self-connection', async () => {
    const { service, inserts } = makeService();
    await service.record({ actorId: ACTOR, beneficiaryId: ACTOR, kind: 'followed' });
    expect(inserts).toHaveLength(0);
  });

  it('refuses non-uuid ids rather than letting them reach the database', async () => {
    const { service, inserts } = makeService();
    await service.record({ actorId: 'not-a-uuid', beneficiaryId: OTHER, kind: 'followed' });
    await service.record({ actorId: ACTOR, beneficiaryId: '', kind: 'followed' });
    expect(inserts).toHaveLength(0);
  });

  it('refuses an unknown kind', async () => {
    const { service, inserts } = makeService();
    await service.record({
      actorId: ACTOR,
      beneficiaryId: OTHER,
      kind: 'not_a_kind' as never,
    });
    expect(inserts).toHaveLength(0);
  });

  it('drops a non-uuid courseId instead of failing the write', async () => {
    const { service, inserts } = makeService();
    await service.record({
      actorId: ACTOR,
      beneficiaryId: OTHER,
      kind: 'pack_entitled',
      courseId: 'null',
    });
    expect(inserts[0]).toMatchObject({ course_id: null });
  });

  it('swallows the weekly-dedupe unique violation', async () => {
    const { service, failNextWith } = makeService();
    failNextWith({ code: '23505' });
    // 23505 is the expected path for an already-counted pair this week.
    await expect(
      service.record({ actorId: ACTOR, beneficiaryId: OTHER, kind: 'followed' })
    ).resolves.toBeUndefined();
  });

  it('never throws on a real database error — the source action already committed', async () => {
    const { service, failNextWith } = makeService();
    failNextWith({ code: '42P01' });
    await expect(
      service.record({ actorId: ACTOR, beneficiaryId: OTHER, kind: 'followed' })
    ).resolves.toBeUndefined();
  });

  it('keeps the kind list in sync with the migration CHECK', () => {
    // These strings are duplicated in 20260824123000_learning_connections.sql.
    expect([...CONNECTION_KINDS].sort()).toEqual(
      [
        'challenge_completed',
        'deck_collaborated',
        'dm_accepted',
        'followed',
        'group_question_answered',
        'note_redeemed',
        'order_completed',
        'pack_entitled',
        'pack_scored',
        'question_verified',
        'question_voted',
        'review_left',
      ].sort()
    );
  });
});

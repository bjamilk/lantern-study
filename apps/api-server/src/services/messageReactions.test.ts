/**
 * The reaction write layer, at the layer that owns it.
 *
 * The route test (`routes/messages.reactions.test.ts`) proves the Favorite
 * payload gets a 200. This file pins the two things that test cannot see: the
 * DM scope writes the OTHER parent column, and each Postgres error class maps
 * to the status the client is built to handle.
 */
import {
  addMessageReaction,
  isDuplicateReaction,
  isMissingReactionSchema,
  reactionParentColumn,
  removeMessageReaction,
  REACTION_REMOVE_FAILED,
  REACTION_SAVE_FAILED,
  REACTIONS_UNAVAILABLE,
} from './messageReactions';

const MESSAGE = '66666666-6666-4666-8666-666666666666';
const USER = '11111111-1111-4111-8111-111111111111';
const HEART = '❤️';

function service(options: {
  insertError?: unknown;
  deleteError?: unknown;
  reactions?: Record<string, number>;
}) {
  const inserted: any[] = [];
  const filters: Array<[string, unknown]> = [];
  const client = {
    from: () => {
      const deleteChain: any = {
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return deleteChain;
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve({ error: options.deleteError ?? null }).then(resolve, reject),
      };
      return {
        insert: (row: any) => {
          inserted.push(row);
          return Promise.resolve({ error: options.insertError ?? null });
        },
        // `message_reactions` carries only PARTIAL unique indexes, which
        // Postgres will not infer for an ON CONFLICT target, so an upsert here
        // is 42P10 in production and must never come back.
        upsert: () => {
          throw new Error('upsert cannot infer a partial unique index');
        },
        delete: () => deleteChain,
      };
    },
  };
  const stub = {
    getClient: () => client,
    groupMessages: {
      readMessageReactions: async () => ({ reactions: options.reactions ?? { [HEART]: 1 } }),
    },
  } as any;
  return { stub, inserted, filters };
}

describe('message reaction writes', () => {
  it('names the parent column per scope', () => {
    expect(reactionParentColumn('group')).toBe('group_message_id');
    expect(reactionParentColumn('dm')).toBe('dm_message_id');
  });

  it('inserts against the DM parent when the scope is a DM', async () => {
    const { stub, inserted } = service({});
    await addMessageReaction(stub, MESSAGE, USER, HEART, 'dm');
    expect(inserted).toEqual([{ dm_message_id: MESSAGE, user_id: USER, emoji: HEART }]);
  });

  it('returns the authoritative counts, not the optimistic guess', async () => {
    const { stub } = service({ reactions: { [HEART]: 4 } });
    const result = await addMessageReaction(stub, MESSAGE, USER, HEART);
    expect(result).toEqual({ reactions: { [HEART]: 4 } });
  });

  it('swallows the duplicate the partial unique index raises', async () => {
    const { stub } = service({ insertError: { code: '23505' } });
    await expect(addMessageReaction(stub, MESSAGE, USER, HEART)).resolves.toEqual({
      reactions: { [HEART]: 1 },
    });
  });

  it('maps a missing table to 503 and everything else to a named 500', async () => {
    for (const code of ['42P01', 'PGRST205', '42703']) {
      const { stub } = service({ insertError: { code } });
      await expect(addMessageReaction(stub, MESSAGE, USER, HEART)).rejects.toMatchObject({
        statusCode: 503,
        message: REACTIONS_UNAVAILABLE,
      });
    }
    const { stub } = service({ insertError: { code: '42P10' } });
    await expect(addMessageReaction(stub, MESSAGE, USER, HEART)).rejects.toMatchObject({
      statusCode: 500,
      message: REACTION_SAVE_FAILED,
    });
  });

  it('deletes by (parent, user, emoji) and names its own failure', async () => {
    const { stub, filters } = service({ reactions: {} });
    await expect(removeMessageReaction(stub, MESSAGE, USER, HEART)).resolves.toEqual({
      reactions: {},
    });
    expect(filters).toEqual([
      ['group_message_id', MESSAGE],
      ['user_id', USER],
      ['emoji', HEART],
    ]);

    const failing = service({ deleteError: { code: '23503' } });
    await expect(removeMessageReaction(failing.stub, MESSAGE, USER, HEART)).rejects.toMatchObject({
      statusCode: 500,
      message: REACTION_REMOVE_FAILED,
    });
  });

  it('classifies the Postgres codes it keys on', () => {
    expect(isDuplicateReaction({ code: '23505' })).toBe(true);
    expect(isDuplicateReaction({ code: '42P10' })).toBe(false);
    expect(isMissingReactionSchema({ code: '42P01' })).toBe(true);
    expect(isMissingReactionSchema({ code: '23505' })).toBe(false);
    expect(isMissingReactionSchema(null)).toBe(false);
  });
});

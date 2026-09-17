/**
 * Concept links label another user's artefact and are globally readable, so
 * linkConcept must refuse targets the caller neither owns nor can access.
 * (Review finding H.)
 */
import { ConceptsService } from './concepts';

function makeDb(rows: Record<string, any>) {
  // rows keyed by table → the single row (or null) a maybeSingle() returns.
  const from = (table: string) => {
    const api: any = {};
    api.select = () => api;
    api.eq = () => api;
    api.limit = () => api;
    api.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    api.upsert = () => ({
      select: () => ({
        single: async () => ({
          data: { concept_id: 'c1', target_type: 'note', target_id: rows.__targetId, confidence: 1, source: 'user', created_at: 'now' },
          error: null,
        }),
      }),
    });
    return api;
  };
  return { from };
}

function service(rows: Record<string, any>) {
  const db = makeDb(rows);
  const self: any = Object.create(ConceptsService.prototype);
  self.data = {
    getClient: () => db,
    groups: { isGroupMember: async () => rows.__isGroupMember === true },
  };
  return self;
}

const CONCEPT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOTE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const link = (self: any, input: any) =>
  ConceptsService.prototype.linkConcept.call(self, 'user-1', CONCEPT, input);

describe('linkConcept access control', () => {
  it("refuses a note the caller doesn't own or collaborate on", async () => {
    const self = service({ notes: { id: NOTE, user_id: 'someone-else' }, note_collaborators: null });
    await expect(link(self, { targetType: 'note', targetId: NOTE })).rejects.toThrow(/do not have access/);
  });

  it('allows the note owner', async () => {
    const self = service({ notes: { id: NOTE, user_id: 'user-1' }, __targetId: NOTE });
    await expect(link(self, { targetType: 'note', targetId: NOTE })).resolves.toMatchObject({ targetId: NOTE });
  });

  it('allows a note collaborator', async () => {
    const self = service({ notes: { id: NOTE, user_id: 'other' }, note_collaborators: { note_id: NOTE }, __targetId: NOTE });
    await expect(link(self, { targetType: 'note', targetId: NOTE })).resolves.toMatchObject({ targetId: NOTE });
  });

  it('refuses a group question when the caller is not a member', async () => {
    const self = service({ messages: { id: NOTE, group_id: 'g1', sender_id: 'other' }, __isGroupMember: false });
    await expect(link(self, { targetType: 'question', targetId: NOTE })).rejects.toThrow(/do not have access/);
  });

  it('allows a group question for a member', async () => {
    const self = service({ messages: { id: NOTE, group_id: 'g1', sender_id: 'other' }, __isGroupMember: true, __targetId: NOTE });
    await expect(link(self, { targetType: 'question', targetId: NOTE })).resolves.toBeTruthy();
  });

  it('rejects a non-uuid target before any access lookup', async () => {
    const self = service({});
    await expect(link(self, { targetType: 'note', targetId: 'not-a-uuid' })).rejects.toThrow(/valid id/);
  });
});

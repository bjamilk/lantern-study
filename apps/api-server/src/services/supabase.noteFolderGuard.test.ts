/**
 * updateNote owner-only folder placement.
 *
 * folder_id is a single global column that belongs to the note's OWNER. A
 * non-owner editor writing folderId would pull the note out of the owner's
 * folder into an id that means nothing to them, so the note vanishes from the
 * owner's folder view. updateNote now drops folderId/groupId from a non-owner's
 * update while still saving their content edits.
 */
import * as academicData from './data/academic';
/**
 * HARNESS (monolith lane M3, Phase B): this suite used to drive
 * `SupabaseService.prototype.<m>.call(self, …)`. It now calls the data module
 * that owns the body. Nothing else moved: the same stand-in is built the same
 * way, and it is passed as the `deps` literal, which is what the facade's
 * inline `deps` arrows read off `this` anyway. Every `it` title, every
 * `expect` and every fixture is byte-identical.
 */
import * as notesData from './data/notes';

type Op = { fn: string; args: any[] };
type Call = { table: string; ops: Op[]; terminal: string };
type ChainResult = { data: unknown; error?: unknown };

function fakeDb(resolve: (call: Call) => ChainResult) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const ops: Op[] = [];
      const chain: any = {};
      for (const fn of ["select", "eq", "update", "insert", "order", "limit", "in"]) {
        chain[fn] = (...args: any[]) => {
          ops.push({ fn, args });
          return chain;
        };
      }
      const settle = (terminal: string) => {
        const call: Call = { table, ops, terminal };
        calls.push(call);
        return Promise.resolve(resolve(call));
      };
      chain.single = () => settle("single");
      chain.maybeSingle = () => settle("maybeSingle");
      chain.then = (onOk: any, onErr: any) => settle("then").then(onOk, onErr);
      return chain;
    },
  };
  return { client, calls };
}

const updatedRow = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  user_id: "owner",
  title: "x",
  body: "",
  folder_id: "owner-folder",
  version: 2,
  is_pinned: false,
  is_archived: false,
  source_type: "typed",
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-20T00:01:00.000Z",
  ...over,
});

function runUpdate(
  access: { canEdit: boolean; isOwner: boolean },
  updates: Record<string, unknown>,
  updatedRowOverride: Record<string, unknown> = {},
) {
  const resolve = (call: Call): ChainResult => {
    // The guarded UPDATE (…update().eq('version').select())
    if (call.ops.some((op) => op.fn === "update")) {
      return { data: updatedRow(updatedRowOverride), error: null };
    }
    // The pre-update read of the current updated_at/version.
    return { data: { updated_at: "2026-08-20T00:00:00.000Z", version: 1 }, error: null };
  };
  const { client, calls } = fakeDb(resolve);
  const self = {
    supabase: client,
    resolveNoteAccess: jest.fn(async () => ({
      noteId: "n1",
      ownerId: "owner",
      accessRole: access.isOwner ? "owner" : "editor",
      canEdit: access.canEdit,
      isOwner: access.isOwner,
    })),
    mapNote: notesData.mapNote,
    // No update here names a topic or a course, so the real resolver
    // short-circuits and never reaches `resolveTopicForArtefact`.
    resolveArtefactTopicPatch: function (
      this: any,
      table: any,
      id: string,
      patch: any,
    ) {
      return academicData.resolveArtefactTopicPatch(
        this.supabase,
        async () => null,
        table,
        id,
        patch,
      );
    },
  };
  return {
    calls,
    result: notesData.updateNote((self as any).supabase, self as any, access.isOwner ? "owner" : "editor-user", "n1", updates, {}),
  };
}

const updatePayload = (calls: Call[]) =>
  calls
    .find((c) => c.ops.some((op) => op.fn === "update"))!
    .ops.find((op) => op.fn === "update")!.args[0] as Record<string, unknown>;

describe("updateNote owner-only folder placement", () => {
  it("drops folderId from a non-owner editor's update but still saves the content", async () => {
    const { calls, result } = runUpdate(
      { canEdit: true, isOwner: false },
      { title: "x", body: "edited by collaborator", folderId: "editor-folder" },
    );
    await result;

    const payload = updatePayload(calls);
    expect(payload).not.toHaveProperty("folder_id");
    expect(payload.title).toBe("x");
    expect(payload.body).toBe("edited by collaborator");
  });

  it("also drops groupId from a non-owner's update", async () => {
    const { calls, result } = runUpdate(
      { canEdit: true, isOwner: false },
      { body: "hi", groupId: "some-group" },
    );
    await result;
    expect(updatePayload(calls)).not.toHaveProperty("group_id");
  });

  it("applies folderId when the owner moves their own note", async () => {
    const { calls, result } = runUpdate(
      { canEdit: true, isOwner: true },
      { folderId: "new-folder" },
      { folder_id: "new-folder" },
    );
    const note: any = await result;

    expect(updatePayload(calls).folder_id).toBe("new-folder");
    expect(note.folderId).toBe("new-folder");
  });

  it("still 403s a user without edit access", async () => {
    const { result } = runUpdate(
      { canEdit: false, isOwner: false },
      { folderId: "editor-folder" },
    );
    await expect(result).rejects.toMatchObject({ status: 403 });
  });
});

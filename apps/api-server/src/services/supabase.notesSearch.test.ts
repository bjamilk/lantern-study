/**
 * getNotes searchable-attachment-text projection.
 *
 * Imported notes (PDF/slides/photos/YouTube/audio) store their content in an
 * attachment's extracted_text, not in the note body — so the client's
 * title+body search never matched them. getNotes now attaches a capped
 * `searchText` (concatenated attachment text) for notes whose body is empty, so
 * the client filter can find them. Typed notes (non-empty body) are left alone
 * to keep both the DB read and the payload small.
 */
import { SupabaseService } from "./supabase";

type Op = { fn: string; args: any[] };
type Call = { table: string; ops: Op[]; terminal: string };
type ChainResult = { data: unknown; error?: unknown };

/** Minimal postgrest chain: records every builder call, defers the result. */
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

const noteRow = (over: Record<string, unknown> = {}) => ({
  id: "note-x",
  user_id: "u1",
  title: "Untitled",
  body: "",
  source_type: "typed",
  version: 1,
  is_pinned: false,
  is_archived: false,
  created_at: "2026-08-19T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  ...over,
});

function runGetNotes(
  ownedRows: any[],
  attachmentRows: any[],
  options?: { folderId?: string },
) {
  const resolve = (call: Call): ChainResult => {
    if (call.table === "notes") return { data: ownedRows, error: null };
    if (call.table === "note_collaborators") return { data: [], error: null };
    if (call.table === "note_attachments")
      return { data: attachmentRows, error: null };
    return { data: null, error: null };
  };
  const { client, calls } = fakeDb(resolve);
  const self = {
    supabase: client,
    mapNote: (SupabaseService.prototype as any).mapNote,
    getNoteOwnerPresentation: jest.fn(),
    attachNoteSearchText: (SupabaseService.prototype as any).attachNoteSearchText,
  };
  return {
    calls,
    result: SupabaseService.prototype.getNotes.call(self as any, "u1", options),
  };
}

describe("getNotes searchText projection", () => {
  it("makes an imported note (empty body) findable by a word from its extracted text", async () => {
    const pdf = noteRow({ id: "note-pdf", title: "Lecture 3", body: "", source_type: "pdf" });
    const typed = noteRow({ id: "note-typed", title: "My notes", body: "some typed body", source_type: "typed" });
    const { calls, result } = runGetNotes(
      [pdf, typed],
      [
        {
          note_id: "note-pdf",
          extracted_text: "Photosynthesis converts light energy into chemical energy.",
        },
      ],
    );

    const notes: any[] = await result;
    const importedNote = notes.find((n) => n.id === "note-pdf");
    const typedNote = notes.find((n) => n.id === "note-typed");

    // The whole point: the extracted word is now searchable on the list payload.
    expect(importedNote.searchText.toLowerCase()).toContain("photosynthesis");
    // Typed notes are already searchable by body and get no extra payload.
    expect(typedNote.searchText).toBeUndefined();

    // Only the empty-body note is read from note_attachments (keeps it cheap).
    const attachmentCall = calls.find((c) => c.table === "note_attachments");
    const inArgs = attachmentCall!.ops.find((op) => op.fn === "in")!.args;
    expect(inArgs).toEqual(["note_id", ["note-pdf"]]);
  });

  it("caps the concatenated attachment text at 2000 characters", async () => {
    const pdf = noteRow({ id: "note-pdf", body: "", source_type: "pdf" });
    const { result } = runGetNotes(
      [pdf],
      [
        { note_id: "note-pdf", extracted_text: "A".repeat(1500) },
        { note_id: "note-pdf", extracted_text: "B".repeat(1500) },
      ],
    );
    const notes: any[] = await result;
    const importedNote = notes.find((n) => n.id === "note-pdf");
    expect(importedNote.searchText.length).toBe(2000);
  });

  it("also attaches searchText inside a folder-filtered list", async () => {
    const pdf = noteRow({ id: "note-pdf", body: "", source_type: "pdf", folder_id: "f1" });
    const { result } = runGetNotes(
      [pdf],
      [{ note_id: "note-pdf", extracted_text: "Mitochondria are the powerhouse." }],
      { folderId: "f1" },
    );
    const notes: any[] = await result;
    expect(notes[0].searchText.toLowerCase()).toContain("mitochondria");
  });
});

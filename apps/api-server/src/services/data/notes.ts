/**
 * data/notes.ts — notes, folders, collaborators, share links, attachments.
 *
 * ## Purpose
 *
 * Extracted verbatim from `services/supabase.ts` (monolith lane M1g, step 18),
 * the NOTES section: the last section in that file that still held bodies.
 * Folder CRUD, the note list and its course/topic filters, note CRUD with
 * optimistic concurrency, the two independent sharing mechanisms, file
 * attachments over the `note-files` bucket, comments, and the per-note quiz.
 *
 * ## What it touches
 *
 * Tables: `notes`, `note_folders`, `note_collaborators`, `note_attachments`,
 * `note_share_links`, `note_comments`, `note_quizzes`, plus `profiles` and
 * `group_members` for the access gate. One storage bucket: `note-files`.
 *
 * ## The gotchas
 *
 * 1. `resolveNoteAccess(noteId, userId)` IS THE ONE GATE, and it returns the
 *    LEVEL, not a boolean — owner, collaborator role, or the grant a share link
 *    carries. `isNoteOwner` and `canEditNote` are its narrower forms. The
 *    storage ACL (`data/storageAcl.ts`) calls it for note covers, so widening
 *    it widens image access. It is injected into the moved bodies through
 *    `deps` for the same reason every other sibling is: the harnesses stub it.
 *
 * 2. SHARING HAS TWO INDEPENDENT MECHANISMS AND THEY MUST NOT BE CONFLATED.
 *    `note_collaborators` are named users with a role, added/removed/
 *    role-changed explicitly, with `leaveNoteCollaboration` for self-removal.
 *    `note_share_links` are revocable tokens: `previewNoteShareLink` shows what
 *    a link grants BEFORE it is accepted, `acceptNoteShareLink` converts it,
 *    and `copyNoteForUser` forks the content instead. A change to one is not
 *    automatically right for the other.
 *
 * 3. ATTACHMENT READS ARE ALWAYS FRESHLY SIGNED, never a stored URL — a frozen
 *    signed URL is exactly how chat and board photos died after 24 hours.
 *    Uploads go through `uploadNoteFile` or a signed upload URL
 *    (`createSignedNoteFileUploadUrl`) so a large file bypasses the API
 *    process, and `resolveNoteAttachmentStoragePath` is what maps a stored
 *    attachment row back to the object the storage ACL will be asked about.
 *
 * 4. CONCURRENT EDITS RAISE `VersionConflictError` RATHER THAN LAST-WRITE-WINS.
 *    `updateNote` compares the caller's `expectedVersion` against the row and
 *    refuses instead of silently overwriting somebody else's paragraph.
 *
 * 5. THE POSTGREST EMBED TRAP BIT HERE ONCE. A second FK between
 *    `note_collaborators` and `profiles` made the bare embed ambiguous
 *    (PGRST201) and broke the roster, which is why the collaborator select
 *    names `profiles!note_collaborators_user_id_fkey(...)`. That named form is
 *    pinned directly by `services/postgrestEmbedDisambiguation.test.ts`, which
 *    now reads this file for it — the pin moved with the code.
 *
 * ## Why the cross-method calls go back through `deps`
 *
 * Every sibling in this module and every reach into another section goes
 * through `deps`. `supabase.notesSearch.test.ts`, `supabase.noteQuiz.test.ts`,
 * `supabase.noteFolderGuard.test.ts`, `supabase.notePages.test.ts` and the
 * `routes/notes.*` suites build a bare `self = { supabase, resolveNoteAccess:
 * …, getNote: …, mapNote: …, … }` and drive the entry point through
 * `SupabaseService.prototype.<m>.call(self, …)`. A local sibling call would
 * step around exactly the stubs those harnesses install — including the access
 * gate, which is the last thing that should be able to go missing quietly. The
 * facade builds the `deps` literal INLINE at each call site, as arrows that
 * read `this.<method>` at CALL time — an instance field holding the deps reads
 * as `undefined` there, and would bypass every `jest.spyOn` on the class.
 *
 * `deps.service` is the `SupabaseService` instance itself, for the three
 * collaborators that take it whole (`recordLearningEvent`, the activity feed
 * and learning connections) — the same shape `data/offlineBundles.ts` uses.
 */
import { logger } from "../../utils/logger";
import { detectImageMime } from "../../utils/fileValidation";
import { VersionConflictError } from "../../utils/versionConflict";
import { normalizeCoverRef } from "@lantern/shared/utils/storageUrl";
import type { LearningSurface } from "@lantern/shared/learning";

import {
  applyCourseFilter,
  courseFilterKey,
  isMissingStudySetColumn,
  isMissingTopicColumn,
  type CourseFilter,
} from "../academicCourses";
import { IMMUTABLE_IMAGE_CACHE_CONTROL } from "../imageProcessing";
// Append-only learning log (Phase 1 · C). Value import of a leaf module
// (learningEvents only type-imports the facade), so no runtime import cycle.
import { recordLearningEvent } from "../learningEvents";
import { mapNoteCommentRow, NOTE_COMMENT_SELECT } from "../noteCommentMapping";
import { buildNoteStoragePath } from "../noteFiles";
import { topicFilterApplies, writeWithTopicFallback } from "./academic";
import { topicIdOf } from "./testMappers";

import type { DataClient } from "./client";
import type { SupabaseService } from "../supabase";

/**
 * Everything a moved body used to reach through `this`.
 *
 * Build this literal INLINE at each delegating call site, with arrows that
 * read `this.<method>` at CALL time. Hoisting it to an instance field compiles
 * and passes the surface freeze, but breaks every suite that invokes these
 * methods on a bare `{ supabase }` stand-in that never ran a constructor, and
 * bypasses every `jest.spyOn` on a gate method.
 */
/** The row shape `attachNoteSearchText` needs; named so the generic fits one line. */
type NoteSearchTextRow = { id: string; body?: string; searchText?: string };

export type NotesDeps = {
  /** The `SupabaseService` instance itself, for the collaborators that take it whole. */
  service: SupabaseService;

  /** Siblings in this module — dispatched dynamically, see the banner. */
  addNoteAttachment: (
    noteId: string,
    payload: {
      type: string;
      fileUrl?: string;
      fileName?: string;
      extractedText?: string;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<any>;
  attachNoteSearchText: <T extends NoteSearchTextRow>(
    notes: T[],
  ) => Promise<T[]>;
  canEditNote: (userId: string, noteId: string) => Promise<boolean>;
  createNote: (
    userId: string,
    payload: Record<string, any>,
    options?: { surface?: LearningSurface },
  ) => Promise<any>;
  downloadNoteFile: (
    storagePath: string,
  ) => Promise<{ buffer: Buffer; contentType: string }>;
  getNote: (noteId: string, userId: string) => Promise<any>;
  getNoteAttachments: (noteId: string) => Promise<any[]>;
  getNoteOwnerPresentation: (ownerId: string) => Promise<any>;
  getNoteQuiz: (userId: string, noteId: string) => Promise<any>;
  isNoteOwner: (userId: string, noteId: string) => Promise<boolean>;
  isNoteQuizProtected: (...args: any[]) => boolean;
  mapNote: (row: any, extras?: Record<string, any>) => any;
  mapNoteFolder: (row: any) => any;
  mapNoteQuiz: (row: any) => any;
  resolveNoteAccess: (noteId: string, userId: string) => Promise<any>;
  resolveNoteAttachmentStoragePath: (attachment: {
    fileUrl?: string;
    metadata?: Record<string, unknown>;
    type?: string;
  }) => string | null;
  updateNote: (
    userId: string,
    noteId: string,
    updates: Record<string, any>,
  ) => Promise<any>;
  uploadNoteFile: (params: {
    storagePath: string;
    buffer: Buffer;
    contentType: string;
    upsert?: boolean;
  }) => Promise<{ path: string }>;

  /** Still in the monolith, or in a section another lane owns. */
  createNotification: (
    userId: string,
    notification: {
      message: string;
      link?: string;
      type?: string;
      data?: Record<string, unknown>;
      force?: boolean;
    },
  ) => Promise<any>;
  createSignedStorageUrlWithVariant: (
    bucket: string,
    path: string,
    expiresInSeconds?: number,
    variant?: "thumb" | "original",
  ) => Promise<string>;
  normalizeStorageUrl: (url: string) => string;
  resolveArtefactTopic: (input: {
    topicId?: unknown;
    courseId?: unknown;
    currentCourseId?: string | null;
  }) => Promise<string | null | undefined>;
  resolveArtefactTopicPatch: (
    table: string,
    id: string,
    updates: { topicId?: unknown; courseId?: unknown },
  ) => Promise<string | null | undefined>;
  resolveCollaboratorUserId: (identifier: string) => Promise<string>;
};

export function mapNote(
  row: any,
  extras?: {
    accessRole?: "owner" | "editor" | "viewer" | "group_member";
    owner?: {
      id: string;
      name?: string;
      username?: string;
      avatarUrl?: string;
    };
  },
) {
  return {
    id: row.id,
    userId: row.user_id,
    folderId: row.folder_id || undefined,
    groupId: row.group_id || undefined,
    courseId: row.course_id ?? null,
    studySetId: row.study_set_id ?? null,
    ...topicIdOf(row),
    title: row.title,
    body: row.body || "",
    summary: row.summary || undefined,
    sourceType: row.source_type || "typed",
    youtubeUrl: row.youtube_url || undefined,
    youtubeVideoId: row.youtube_video_id || undefined,
    isShared: row.is_shared || false,
    // Intentionally omit dormant plaintext share_token (secure links use note_share_links).
    copiedFromNoteId: row.copied_from_note_id || undefined,
    isArchived: Boolean(row.is_archived),
    isPinned: Boolean(row.is_pinned),
    pinnedAt: row.pinned_at || undefined,
    // Raw storage path — the client re-signs it. Undefined (not null) before
    // the cover_path migration is applied, so nothing renders a broken image.
    coverPath: normalizeCoverRef(row.cover_path ?? null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version:
      typeof row.version === "number"
        ? row.version
        : Number(row.version) || 1,
    accessRole: extras?.accessRole,
    owner: extras?.owner,
  };
}


/**
 * Canonical note access resolver for read/list/mutation gates.
 * Roles: owner > editor > viewer > group_member.
 */
export async function resolveNoteAccess(
  db: DataClient,
  noteId: string,
  userId: string,
): Promise<{
  noteId: string;
  ownerId: string;
  accessRole: "owner" | "editor" | "viewer" | "group_member";
  canEdit: boolean;
  isOwner: boolean;
  groupId?: string;
} | null> {
  const { data, error } = await db
    .from("notes")
    .select("id, user_id, group_id")
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  if (data.user_id === userId) {
    return {
      noteId: data.id,
      ownerId: data.user_id,
      accessRole: "owner",
      canEdit: true,
      isOwner: true,
      groupId: data.group_id || undefined,
    };
  }

  const { data: collab } = await db
    .from("note_collaborators")
    .select("role")
    .eq("note_id", noteId)
    .eq("user_id", userId)
    .maybeSingle();

  if (collab?.role === "editor" || collab?.role === "owner") {
    return {
      noteId: data.id,
      ownerId: data.user_id,
      accessRole: "editor",
      canEdit: true,
      isOwner: false,
      groupId: data.group_id || undefined,
    };
  }
  if (collab?.role === "viewer") {
    return {
      noteId: data.id,
      ownerId: data.user_id,
      accessRole: "viewer",
      canEdit: false,
      isOwner: false,
      groupId: data.group_id || undefined,
    };
  }

  if (data.group_id) {
    const { data: member } = await db
      .from("group_members")
      .select("user_id, pending")
      .eq("group_id", data.group_id)
      .eq("user_id", userId)
      .eq("pending", false)
      .maybeSingle();
    if (member) {
      return {
        noteId: data.id,
        ownerId: data.user_id,
        accessRole: "group_member",
        canEdit: false,
        isOwner: false,
        groupId: data.group_id,
      };
    }
  }

  return null;
}


export async function isNoteOwner(
  db: DataClient,
  userId: string, noteId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("notes")
    .select("user_id")
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && data.user_id === userId);
}


export async function getNoteOwnerPresentation(
  db: DataClient,
  ownerId: string,
) {
  const { data } = await db
    .from("profiles")
    .select("id, name, username, avatar_url")
    .eq("id", ownerId)
    .maybeSingle();
  if (!data) return { id: ownerId };
  return {
    id: data.id,
    name: data.name || undefined,
    username: data.username || undefined,
    avatarUrl: data.avatar_url || undefined,
  };
}


export function mapNoteFolder(
  row: any,
) {
  return {
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id || undefined,
    parentId: row.parent_id || undefined,
    courseId: row.course_id ?? null,
    name: row.name,
    color: row.color || "#6366f1",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


export async function getNoteFolders(
  db: DataClient,
  deps: Pick<NotesDeps, "mapNoteFolder">,
  userId: string,
) {
  const { data, error } = await db
    .from("note_folders")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => deps.mapNoteFolder(row));
}


// A folder carries no topic: notes/decks/test sessions are what get filed
// under a syllabus topic, and nothing reads note_folders.topic_id.
export async function createNoteFolder(
  db: DataClient,
  deps: Pick<NotesDeps, "mapNoteFolder">,
  userId: string,
  payload: {
    name: string;
    color?: string;
    groupId?: string;
    parentId?: string;
    courseId?: string | null;
  },
) {
  const { data, error } = await db
    .from("note_folders")
    .insert({
      user_id: userId,
      name: payload.name,
      color: payload.color || "#6366f1",
      group_id: payload.groupId || null,
      parent_id: payload.parentId || null,
      course_id: payload.courseId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return deps.mapNoteFolder(data);
}


export async function updateNoteFolder(
  db: DataClient,
  deps: Pick<NotesDeps, "mapNoteFolder">,
  userId: string,
  folderId: string,
  updates: {
    name?: string;
    color?: string;
    courseId?: string | null;
  },
) {
  const { courseId, ...rest } = updates;
  const dbUpdates: Record<string, unknown> = {
    ...rest,
    updated_at: new Date().toISOString(),
  };
  if (courseId !== undefined) dbUpdates.course_id = courseId || null;
  const { data, error } = await db
    .from("note_folders")
    .update(dbUpdates)
    .eq("id", folderId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return deps.mapNoteFolder(data);
}


export async function deleteNoteFolder(
  db: DataClient,
  userId: string, folderId: string,
) {
  const { error } = await db
    .from("note_folders")
    .delete()
    .eq("id", folderId)
    .eq("user_id", userId);
  if (error) throw error;
  return true;
}


export async function getNotes(
  db: DataClient,
  deps: Pick<
    NotesDeps,
    | "attachNoteSearchText"
    | "getNoteOwnerPresentation"
    | "mapNote"
  >,
  userId: string,
  options?: {
    folderId?: string;
    groupId?: string;
    archived?: boolean;
    /** Academic archive filter (notes.course_id): unfiled → IS NULL, course → eq. */
    courseFilter?: CourseFilter;
    /** Same, one level down (notes.topic_id): unfiled → no topic in that course. */
    topicFilter?: CourseFilter;
    studySetId?: string;
  },
) {
  const buildOwnedQuery = (withTopic: boolean) => {
    let query = db
      .from("notes")
      .select("*")
      .eq("user_id", userId)
      .order("is_pinned", { ascending: false })
      .order("updated_at", { ascending: false });

    if (options?.folderId) query = query.eq("folder_id", options.folderId);
    if (options?.groupId) query = query.eq("group_id", options.groupId);
    if (options?.studySetId) query = query.eq("study_set_id", options.studySetId);
    query = applyCourseFilter(query, "course_id", options?.courseFilter);
    if (withTopic) {
      query = applyCourseFilter(query, "topic_id", options?.topicFilter);
    }
    if (options?.archived === true) query = query.eq("is_archived", true);
    else if (options?.archived === false) query = query.eq("is_archived", false);
    return query;
  };

  // A topic filter narrows to one course's shelf just like a course filter.
  const courseFiltered =
    options?.courseFilter?.kind === "course" ||
    options?.courseFilter?.kind === "unfiled" ||
    topicFilterApplies(options?.topicFilter);

  // Annotated because the two builds project different columns; keep it an
  // array type so the mapped rows below stay inferable.
  let { data: ownedRows, error: ownedError }: { data: any[] | null; error: any } =
    await buildOwnedQuery(true);
  if (ownedError && options?.studySetId && isMissingStudySetColumn(ownedError)) {
    return [];
  }
  if (
    ownedError &&
    topicFilterApplies(options?.topicFilter) &&
    isMissingTopicColumn(ownedError)
  ) {
    // No note can carry a topic before the migration: a named topic matches
    // nothing, and "no topic" matches every note.
    if (options?.topicFilter?.kind === "course") return [];
    ({ data: ownedRows, error: ownedError } = await buildOwnedQuery(false));
  }
  if (ownedError) throw ownedError;

  // Notes moderation removed (notes.removed_by_admin_at, migration
  // 20260822140000) disappear from the list for everyone but admins. Filtered
  // in JS rather than .is(...) so the query still works before the column
  // exists.
  const owned = (ownedRows || [])
    .filter((row: any) => !row?.removed_by_admin_at)
    .map((row: any) => deps.mapNote(row, { accessRole: "owner" }));

  // Folder/group/course filtered lists stay owned-only (shared notes keep owner's placement).
  if (options?.folderId || options?.groupId || options?.studySetId || courseFiltered) {
    return deps.attachNoteSearchText(owned);
  }

  const { data: collabRows, error: collabError } = await db
    .from("note_collaborators")
    .select("note_id, role, notes(*)")
    .eq("user_id", userId);
  if (collabError) throw collabError;

  const ownedIds = new Set(owned.map((n) => n.id));
  const ownerIds = Array.from(
    new Set(
      (collabRows || [])
        .map((row: any) => row.notes?.user_id)
        .filter(
          (id: unknown): id is string =>
            typeof id === "string" && id !== userId,
        ),
    ),
  );
  const ownerMap = new Map<
    string,
    { id: string; name?: string; username?: string; avatarUrl?: string }
  >();
  await Promise.all(
    ownerIds.map(async (ownerId) => {
      ownerMap.set(ownerId, await deps.getNoteOwnerPresentation(ownerId));
    }),
  );

  const shared = (collabRows || [])
    .filter((row: any) => {
      if (!row.notes || ownedIds.has(row.notes.id)) return false;
      if (row.notes.removed_by_admin_at) return false;
      if (options?.archived === true) return Boolean(row.notes.is_archived);
      if (options?.archived === false) return !row.notes.is_archived;
      return true;
    })
    .map((row: any) => {
      const role =
        row.role === "editor" || row.role === "owner"
          ? ("editor" as const)
          : ("viewer" as const);
      return deps.mapNote(row.notes, {
        accessRole: role,
        owner: ownerMap.get(row.notes.user_id) || { id: row.notes.user_id },
      });
    });

  const sorted = [...owned, ...shared].sort((a, b) => {
    const pinDelta = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
    if (pinDelta !== 0) return pinDelta;
    return (
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  });
  return deps.attachNoteSearchText(sorted);
}


/**
 * Imported notes (PDF/slides/photos/YouTube/audio) store their content in
 * attachment `extracted_text`, not in `body` — so the client's title+body
 * search never matches them. Attach a capped, concatenated copy of that text
 * as `searchText` for notes whose body is empty (the unsearchable set), so the
 * client filter can match on it. Only empty-body notes are read here to keep
 * both the DB read and the list payload small: notes with a typed body are
 * already searchable by that body and gain no coverage worth the bloat.
 */
export async function attachNoteSearchText<T extends NoteSearchTextRow>(
  db: DataClient,
  notes: T[],
): Promise<T[]> {
  const NOTE_SEARCH_TEXT_MAX_CHARS = 2000;
  const importedIds = notes
    .filter((n) => !n.body || !n.body.trim())
    .map((n) => n.id);
  if (importedIds.length === 0) return notes;

  const { data, error } = await db
    .from("note_attachments")
    .select("note_id, extracted_text")
    .in("note_id", importedIds);
  if (error) throw error;
  if (!data || data.length === 0) return notes;

  const textByNote = new Map<string, string>();
  for (const row of data as Array<{
    note_id: string;
    extracted_text: string | null;
  }>) {
    const text =
      typeof row.extracted_text === "string" ? row.extracted_text.trim() : "";
    if (!text) continue;
    const existing = textByNote.get(row.note_id);
    if (existing && existing.length >= NOTE_SEARCH_TEXT_MAX_CHARS) continue;
    const combined = existing ? `${existing} ${text}` : text;
    textByNote.set(row.note_id, combined.slice(0, NOTE_SEARCH_TEXT_MAX_CHARS));
  }
  if (textByNote.size === 0) return notes;

  return notes.map((note) => {
    const searchText = textByNote.get(note.id);
    return searchText ? { ...note, searchText } : note;
  });
}


export async function getNote(
  db: DataClient,
  deps: Pick<
    NotesDeps,
    | "getNoteOwnerPresentation"
    | "mapNote"
    | "resolveNoteAccess"
  >,
  noteId: string, userId: string,
) {
  const access = await deps.resolveNoteAccess(noteId, userId);
  if (!access) {
    // 404, matching the sibling write paths below. Status-less, this read
    // surfaced to callers as a 500 "Something went wrong" and was reported
    // to Sentry as a server crash.
    const err = new Error("Note not found or access denied") as Error & {
      status?: number;
    };
    err.status = 404;
    throw err;
  }

  const { data, error } = await db
    .from("notes")
    .select("*")
    .eq("id", noteId)
    .single();
  if (error) throw error;

  const owner = access.isOwner
    ? undefined
    : await deps.getNoteOwnerPresentation(access.ownerId);

  return deps.mapNote(data, {
    accessRole: access.accessRole,
    owner,
  });
}


export async function createNote(
  db: DataClient,
  deps: Pick<NotesDeps, "mapNote" | "resolveArtefactTopic" | "service">,
  userId: string,
  payload: {
    title?: string;
    body?: string;
    folderId?: string;
    groupId?: string;
    sourceType?: string;
    youtubeUrl?: string;
    youtubeVideoId?: string;
    summary?: string;
    copiedFromNoteId?: string;
    courseId?: string | null;
    studySetId?: string | null;
    topicId?: string | null;
  },
  options: {
    /** 'web' | 'mobile' from x-lantern-surface (learning_events.surface); default 'api'. */
    surface?: LearningSurface;
  } = {},
) {
  const topicId = await deps.resolveArtefactTopic({
    topicId: payload.topicId,
    courseId: payload.courseId,
  });
  const { data, error } = await writeWithTopicFallback(
    (row) => db.from("notes").insert(row).select().single(),
    {
      user_id: userId,
      title: payload.title || "Untitled Note",
      body: payload.body || "",
      folder_id: payload.folderId || null,
      group_id: payload.groupId || null,
      course_id: payload.courseId || null,
      ...(payload.studySetId !== undefined ? { study_set_id: payload.studySetId || null } : {}),
      ...(topicId !== undefined ? { topic_id: topicId } : {}),
      source_type: payload.sourceType || "typed",
      youtube_url: payload.youtubeUrl || null,
      youtube_video_id: payload.youtubeVideoId || null,
      summary: payload.summary || null,
      copied_from_note_id: payload.copiedFromNoteId || null,
    },
  );
  if (error) throw error;
  // learning_events: note_created — every creation path (typed, PDF/slides/
  // image/audio/YouTube imports) lands here; only POST /notes knows the
  // surface header, the rest default to 'api'. Never throws.
  await recordLearningEvent(deps.service, {
    userId,
    eventType: "note_created",
    targetType: "note",
    targetId: data?.id,
    noteId: data?.id,
    groupId: data?.group_id ?? null,
    courseId: data?.course_id ?? null,
    surface: options.surface ?? "api",
    occurredAt: data?.created_at ?? null,
  });
  return deps.mapNote(data, { accessRole: "owner" });
}


export async function canEditNote(
  deps: Pick<NotesDeps, "resolveNoteAccess">,
  userId: string, noteId: string,
): Promise<boolean> {
  const access = await deps.resolveNoteAccess(noteId, userId);
  return Boolean(access?.canEdit);
}


export async function updateNote(
  db: DataClient,
  deps: Pick<
    NotesDeps,
    | "getNote"
    | "mapNote"
    | "resolveArtefactTopicPatch"
    | "resolveNoteAccess"
  >,
  userId: string,
  noteId: string,
  updates: Record<string, unknown>,
  options: {
    expectedVersion?: number;
    expectedUpdatedAt?: string;
    /** AI/system writers may retry once after a concurrent user edit. */
    allowRetryOnConflict?: boolean;
  } = {},
) {
  const access = await deps.resolveNoteAccess(noteId, userId);
  if (!access?.canEdit) {
    const err = new Error("Note not found or access denied") as Error & {
      code?: string;
      status?: number;
    };
    err.code = "PGRST116";
    err.status = 403;
    throw err;
  }

  // Folder/group placement lives in a single global column that belongs to the
  // note's owner. A non-owner editor writing folderId/groupId would pull the
  // note out of the OWNER's folder into an id that means nothing to them, so it
  // vanishes from the owner's folder view. Drop placement changes from
  // non-owners — their title/body edits still save, and the client hides the
  // "Move to folder" control for shared notes anyway.
  if (!access.isOwner) {
    delete (updates as Record<string, unknown>).folderId;
    delete (updates as Record<string, unknown>).groupId;
    // Course is the owner's archive taxonomy, same as folder placement —
    // and so is the topic inside it.
    delete (updates as Record<string, unknown>).courseId;
    delete (updates as Record<string, unknown>).studySetId;
    delete (updates as Record<string, unknown>).topicId;
    // The cover is the owner's presentation choice, like folder placement.
    delete (updates as Record<string, unknown>).coverPath;
  }

  const dbUpdates: Record<string, unknown> = {};
  if (updates.title !== undefined) dbUpdates.title = updates.title;
  if (updates.body !== undefined) dbUpdates.body = updates.body;
  if (updates.summary !== undefined) dbUpdates.summary = updates.summary;
  if (updates.folderId !== undefined)
    dbUpdates.folder_id = updates.folderId || null;
  if (updates.groupId !== undefined)
    dbUpdates.group_id = updates.groupId || null;
  if (updates.courseId !== undefined)
    dbUpdates.course_id = updates.courseId || null;
  if (updates.studySetId !== undefined)
    dbUpdates.study_set_id = updates.studySetId || null;
  // Validated against the course the note ENDS UP with, before the first
  // write attempt, so a wrong-course topic 400s instead of being stored.
  const topicId = await deps.resolveArtefactTopicPatch("notes", noteId, updates);
  if (topicId !== undefined) dbUpdates.topic_id = topicId;
  // Only clearing is accepted here; a cover is SET by POST /notes/:id/cover,
  // so a client can never point the column at an arbitrary storage object.
  if (updates.coverPath === null) dbUpdates.cover_path = null;
  if (updates.isShared !== undefined) dbUpdates.is_shared = updates.isShared;
  if (updates.youtubeUrl !== undefined)
    dbUpdates.youtube_url = updates.youtubeUrl;
  if (updates.youtubeVideoId !== undefined)
    dbUpdates.youtube_video_id = updates.youtubeVideoId;
  if (updates.isPinned !== undefined) {
    const pinned = Boolean(updates.isPinned);
    dbUpdates.is_pinned = pinned;
    dbUpdates.pinned_at = pinned ? new Date().toISOString() : null;
  }
  if (updates.isArchived !== undefined) {
    const archived = Boolean(updates.isArchived);
    dbUpdates.is_archived = archived;
    if (archived) {
      dbUpdates.is_pinned = false;
      dbUpdates.pinned_at = null;
    }
  }

  const maxAttempts = options.allowRetryOnConflict ? 2 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: current, error: currentError } = await db
      .from("notes")
      .select("updated_at, version")
      .eq("id", noteId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) {
      const err = new Error("Note not found or access denied") as Error & {
        code?: string;
        status?: number;
      };
      err.code = "PGRST116";
      err.status = 404;
      throw err;
    }

    const expectedVersion =
      options.expectedVersion != null && attempt === 0
        ? Number(options.expectedVersion)
        : Number(current.version) || 1;
    const expectedUpdatedAt =
      options.expectedUpdatedAt && attempt === 0
        ? options.expectedUpdatedAt
        : (current.updated_at as string);

    // Trigger bumps version/updated_at; CAS against the values we last read.
    const runUpdate = (payload: Record<string, unknown>) => {
      let query = db
        .from("notes")
        .update(payload)
        .eq("id", noteId);
      if (Number.isFinite(expectedVersion)) {
        query = query.eq("version", expectedVersion);
      } else if (expectedUpdatedAt) {
        query = query.eq("updated_at", expectedUpdatedAt);
      }
      return query.select().maybeSingle();
    };

    const { data, error } = await writeWithTopicFallback(runUpdate, dbUpdates);
    if (error) throw error;
    if (data) return deps.mapNote(data);

    if (attempt + 1 >= maxAttempts) {
      const latest = await deps.getNote(noteId, userId).catch(() => null);
      throw new VersionConflictError(
        "Note was updated elsewhere. Refresh and try again.",
        latest,
      );
    }
  }

  throw new VersionConflictError(
    "Note was updated elsewhere. Refresh and try again.",
  );
}


export async function deleteNote(
  db: DataClient,
  userId: string, noteId: string,
) {
  const { error } = await db
    .from("notes")
    .delete()
    .eq("id", noteId)
    .eq("user_id", userId);
  if (error) throw error;
  return true;
}


export async function getNoteAttachment(
  db: DataClient,
  noteId: string, attachmentId: string,
) {
  const { data, error } = await db
    .from("note_attachments")
    .select("*")
    .eq("note_id", noteId)
    .eq("id", attachmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    noteId: data.note_id,
    type: data.type,
    fileUrl: data.file_url || undefined,
    fileName: data.file_name || undefined,
    extractedText: data.extracted_text || undefined,
    metadata: data.metadata || {},
    createdAt: data.created_at,
  };
}


export async function updateNoteAttachment(
  db: DataClient,
  attachmentId: string,
  updates: { metadata?: Record<string, unknown>; extractedText?: string },
) {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;
  if (updates.extractedText !== undefined)
    dbUpdates.extracted_text = updates.extractedText;

  const { data, error } = await db
    .from("note_attachments")
    .update(dbUpdates)
    .eq("id", attachmentId)
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    noteId: data.note_id,
    type: data.type,
    fileUrl: data.file_url || undefined,
    fileName: data.file_name || undefined,
    extractedText: data.extracted_text || undefined,
    metadata: data.metadata || {},
    createdAt: data.created_at,
  };
}


export async function uploadNoteFile(
  db: DataClient,
  params: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
  upsert?: boolean;
},
): Promise<{ path: string }> {
  const bucket = "note-files";
  const isImage = (params.contentType || "").toLowerCase().startsWith("image/");
  const attemptUpload = async () =>
    db.storage
      .from(bucket)
      .upload(params.storagePath, params.buffer, {
        contentType: params.contentType,
        cacheControl: isImage ? IMMUTABLE_IMAGE_CACHE_CONTROL : "3600",
        upsert: params.upsert === true,
      });

  let uploadResult = await attemptUpload();
  if (
    uploadResult.error &&
    typeof uploadResult.error.message === "string" &&
    uploadResult.error.message.toLowerCase().includes("bucket") &&
    uploadResult.error.message.toLowerCase().includes("not found")
  ) {
    await db.storage.createBucket(bucket, { public: false });
    uploadResult = await attemptUpload();
  }

  const { error } = uploadResult;
  if (error) {
    logger.error("Error uploading note file:", {
      error,
      path: params.storagePath,
    });
    throw new Error(error.message);
  }
  return { path: params.storagePath };
}


/**
 * Mint a short-lived signed upload URL so browsers can PUT lecture audio
 * directly to Supabase Storage (avoids CF Worker / API body size & timeout).
 */
export async function createSignedNoteFileUploadUrl(
  db: DataClient,
  deps: Pick<NotesDeps, "normalizeStorageUrl">,
  storagePath: string,
): Promise<{
  signedUrl: string;
  token: string;
  path: string;
}> {
  const bucket = "note-files";
  if (
    !storagePath ||
    storagePath.includes("..") ||
    storagePath.startsWith("/") ||
    storagePath.includes("\\")
  ) {
    throw new Error("Invalid storage path");
  }

  const attempt = async () =>
    db.storage.from(bucket).createSignedUploadUrl(storagePath);

  let result = await attempt();
  if (
    result.error &&
    typeof result.error.message === "string" &&
    result.error.message.toLowerCase().includes("bucket") &&
    result.error.message.toLowerCase().includes("not found")
  ) {
    await db.storage.createBucket(bucket, { public: false });
    result = await attempt();
  }

  if (result.error || !result.data?.signedUrl || !result.data?.token) {
    logger.error("Error creating signed note-file upload URL:", {
      error: result.error,
      path: storagePath,
    });
    throw new Error(
      result.error?.message || "Failed to create signed upload URL",
    );
  }

  return {
    signedUrl: deps.normalizeStorageUrl(result.data.signedUrl),
    token: result.data.token,
    path: result.data.path || storagePath,
  };
}


export async function createSignedNoteFileUrl(
  deps: Pick<NotesDeps, "createSignedStorageUrlWithVariant">,
  storagePath: string,
  expiresInSeconds = 60 * 60 * 24,
  variant: "thumb" | "original" = "original",
): Promise<string> {
  return deps.createSignedStorageUrlWithVariant(
    "note-files",
    storagePath,
    expiresInSeconds,
    variant,
  );
}


export async function deleteNoteFile(
  db: DataClient,
  storagePath: string,
): Promise<void> {
  const { error } = await db.storage
    .from("note-files")
    .remove([storagePath]);
  if (error) {
    logger.warn("Failed to delete note file from storage", {
      error,
      storagePath,
    });
  }
}


export async function downloadNoteFile(
  db: DataClient,
  storagePath: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const { data, error } = await db.storage
    .from("note-files")
    .download(storagePath);
  if (error || !data) {
    throw new Error(error?.message || "Failed to download note file");
  }
  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const lower = storagePath.toLowerCase();
  let contentType = "application/octet-stream";
  if (lower.endsWith(".pdf")) contentType = "application/pdf";
  else if (lower.endsWith(".pptx")) {
    contentType =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  } else if (lower.endsWith(".ppt"))
    contentType = "application/vnd.ms-powerpoint";
  else if (lower.endsWith(".png")) contentType = "image/png";
  else if (lower.endsWith(".gif")) contentType = "image/gif";
  else if (lower.endsWith(".webp")) contentType = "image/webp";
  else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
    contentType = "image/jpeg";
  else {
    const detected = detectImageMime(buffer);
    if (detected) contentType = detected;
  }
  return { buffer, contentType };
}


export function resolveNoteAttachmentStoragePath(
  attachment: {
  fileUrl?: string;
  metadata?: Record<string, unknown>;
  type?: string;
},
): string | null {
  const meta = attachment.metadata || {};
  if (
    typeof meta.previewStoragePath === "string" &&
    meta.previewStoragePath
  ) {
    return meta.previewStoragePath;
  }
  if (typeof meta.storagePath === "string" && meta.storagePath) {
    return meta.storagePath;
  }
  if (!attachment.fileUrl) return null;
  try {
    const url = new URL(attachment.fileUrl);
    const marker = "/storage/v1/object/";
    const idx = url.pathname.indexOf(marker);
    if (idx === -1) return null;
    let after = url.pathname.slice(idx + marker.length);
    if (after.startsWith("sign/")) after = after.slice("sign/".length);
    if (after.startsWith("public/")) after = after.slice("public/".length);
    const parts = after.split("/");
    if (parts.length < 2) return null;
    const bucket = parts[0];
    if (bucket !== "note-files") return null;
    return decodeURIComponent(parts.slice(1).join("/"));
  } catch {
    return null;
  }
}


export async function getNoteAttachments(
  db: DataClient,
  noteId: string,
) {
  const { data, error } = await db
    .from("note_attachments")
    .select("*")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    noteId: row.note_id,
    type: row.type,
    fileUrl: row.file_url || undefined,
    fileName: row.file_name || undefined,
    extractedText: row.extracted_text || undefined,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }));
}


export async function addNoteAttachment(
  db: DataClient,
  noteId: string,
  payload: {
    type: string;
    fileUrl?: string;
    fileName?: string;
    extractedText?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { data, error } = await db
    .from("note_attachments")
    .insert({
      note_id: noteId,
      type: payload.type,
      file_url: payload.fileUrl || null,
      file_name: payload.fileName || null,
      extracted_text: payload.extractedText || null,
      metadata: payload.metadata || {},
    })
    .select()
    .single();
  if (error) throw error;
  return {
    id: data.id,
    noteId: data.note_id,
    type: data.type,
    fileUrl: data.file_url || undefined,
    fileName: data.file_name || undefined,
    extractedText: data.extracted_text || undefined,
    metadata: data.metadata || {},
    createdAt: data.created_at,
  };
}


export async function getNoteCollaborators(
  db: DataClient,
  noteId: string,
) {
  const { data, error } = await db
    .from("note_collaborators")
    // Name the FK constraint (note_collaborators.user_id -> profiles.id,
    // auto-named note_collaborators_user_id_fkey). note_collaborators has a
    // single FK to profiles today, so a bare `profiles(...)` resolves — the
    // same single-FK state community_members was in before a second FK made
    // its bare embed ambiguous (PGRST201) and broke the roster. Naming it now
    // keeps this correct if profiles ever gains a second relationship here.
    // The resource is still called `profiles`, so `row.profiles` below holds.
    .select("*, profiles!note_collaborators_user_id_fkey(id, name, avatar_url)")
    .eq("note_id", noteId);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    noteId: row.note_id,
    userId: row.user_id,
    role: row.role,
    addedAt: row.added_at,
    user: row.profiles
      ? {
          id: row.profiles.id,
          name: row.profiles.name,
          avatarUrl: row.profiles.avatar_url,
        }
      : undefined,
  }));
}


export async function addNoteCollaborator(
  db: DataClient,
  deps: Pick<
    NotesDeps,
    | "createNotification"
    | "getNote"
    | "getNoteOwnerPresentation"
    | "resolveCollaboratorUserId"
  >,
  noteId: string,
  ownerId: string,
  collaboratorUserId: string,
  role: string = "editor",
) {
  const note = await deps.getNote(noteId, ownerId);
  if (note.userId !== ownerId)
    throw new Error("Only the note owner can add collaborators");

  const normalizedRole = role === "viewer" ? "viewer" : "editor";
  const resolvedUserId =
    await deps.resolveCollaboratorUserId(collaboratorUserId);
  if (resolvedUserId === ownerId) {
    throw new Error("You cannot add yourself as a collaborator.");
  }

  const { data: existing } = await db
    .from("note_collaborators")
    .select("role")
    .eq("note_id", noteId)
    .eq("user_id", resolvedUserId)
    .maybeSingle();

  const grantRole =
    existing?.role === "editor" && normalizedRole === "viewer"
      ? "editor"
      : normalizedRole;

  const { data, error } = await db
    .from("note_collaborators")
    .upsert({
      note_id: noteId,
      user_id: resolvedUserId,
      role: grantRole,
    })
    .select()
    .single();
  if (error) throw error;

  const actor = await deps.getNoteOwnerPresentation(ownerId);
  void deps.createNotification(resolvedUserId, {
    type: "note_share_invite",
    message: `${actor.name || actor.username || "Someone"} shared "${note.title}" with you`,
    link: `/notes/${noteId}`,
    data: { noteId, role: grantRole, fromUserId: ownerId },
  }).catch(() => {});

  return {
    noteId: data.note_id,
    userId: data.user_id,
    role: data.role,
    addedAt: data.added_at,
  };
}


export async function removeNoteCollaborator(
  db: DataClient,
  deps: Pick<NotesDeps, "getNote">,
  noteId: string,
  ownerId: string,
  collaboratorUserId: string,
) {
  const note = await deps.getNote(noteId, ownerId);
  if (note.userId !== ownerId)
    throw new Error("Only the note owner can remove collaborators");

  const { error } = await db
    .from("note_collaborators")
    .delete()
    .eq("note_id", noteId)
    .eq("user_id", collaboratorUserId);
  if (error) throw error;
  return true;
}


export async function updateNoteCollaboratorRole(
  db: DataClient,
  deps: Pick<NotesDeps, "isNoteOwner">,
  noteId: string,
  ownerId: string,
  collaboratorUserId: string,
  role: "viewer" | "editor",
) {
  if (!(await deps.isNoteOwner(ownerId, noteId))) {
    throw new Error("Only the note owner can change collaborator roles");
  }
  if (collaboratorUserId === ownerId) {
    throw new Error("Cannot change the owner role via collaborator update");
  }
  const { data, error } = await db
    .from("note_collaborators")
    .update({ role })
    .eq("note_id", noteId)
    .eq("user_id", collaboratorUserId)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Collaborator not found");
  return {
    noteId: data.note_id,
    userId: data.user_id,
    role: data.role,
    addedAt: data.added_at,
  };
}


/** Collaborator leaves a shared note (self-remove). Owners cannot leave. */
export async function leaveNoteCollaboration(
  db: DataClient,
  deps: Pick<NotesDeps, "isNoteOwner" | "resolveNoteAccess">,
  noteId: string, userId: string,
) {
  if (await deps.isNoteOwner(userId, noteId)) {
    throw new Error("Note owners cannot leave their own note");
  }
  const access = await deps.resolveNoteAccess(noteId, userId);
  if (
    !access ||
    (access.accessRole !== "viewer" && access.accessRole !== "editor")
  ) {
    throw new Error("You are not a collaborator on this note");
  }
  const { error } = await db
    .from("note_collaborators")
    .delete()
    .eq("note_id", noteId)
    .eq("user_id", userId);
  if (error) throw error;
  return true;
}


export async function createNoteShareLink(
  db: DataClient,
  deps: Pick<NotesDeps, "isNoteOwner">,
  noteId: string,
  ownerId: string,
  role: "viewer" | "editor",
  options?: { expiresAt?: string | null },
) {
  const { generateNoteShareToken, hashNoteShareToken, buildNoteShareWebUrl } =
    await import("../noteShareTokens");
  if (!(await deps.isNoteOwner(ownerId, noteId))) {
    throw new Error("Only the note owner can create share links");
  }
  if (role !== "viewer" && role !== "editor") {
    throw new Error("role must be viewer or editor");
  }

  const token = generateNoteShareToken();
  const tokenHash = hashNoteShareToken(token);
  const { data, error } = await db
    .from("note_share_links")
    .insert({
      note_id: noteId,
      created_by: ownerId,
      token_hash: tokenHash,
      role,
      expires_at: options?.expiresAt || null,
    })
    .select(
      "id, note_id, role, expires_at, revoked_at, created_at, last_redeemed_at",
    )
    .single();
  if (error) throw error;

  return {
    id: data.id,
    noteId: data.note_id,
    role: data.role as "viewer" | "editor",
    expiresAt: data.expires_at || undefined,
    revokedAt: data.revoked_at || undefined,
    createdAt: data.created_at,
    lastRedeemedAt: data.last_redeemed_at || undefined,
    // Plaintext returned once for the owner to copy; never stored.
    token,
    url: buildNoteShareWebUrl(token),
  };
}


export async function listNoteShareLinks(
  db: DataClient,
  deps: Pick<NotesDeps, "isNoteOwner">,
  noteId: string, ownerId: string,
) {
  if (!(await deps.isNoteOwner(ownerId, noteId))) {
    throw new Error("Only the note owner can list share links");
  }
  const { data, error } = await db
    .from("note_share_links")
    .select(
      "id, note_id, role, expires_at, revoked_at, created_at, last_redeemed_at",
    )
    .eq("note_id", noteId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    noteId: row.note_id,
    role: row.role as "viewer" | "editor",
    expiresAt: row.expires_at || undefined,
    revokedAt: row.revoked_at || undefined,
    createdAt: row.created_at,
    lastRedeemedAt: row.last_redeemed_at || undefined,
    isActive:
      !row.revoked_at &&
      (!row.expires_at || new Date(row.expires_at) > new Date()),
  }));
}


export async function revokeNoteShareLink(
  db: DataClient,
  deps: Pick<NotesDeps, "isNoteOwner">,
  noteId: string, ownerId: string, linkId: string,
) {
  if (!(await deps.isNoteOwner(ownerId, noteId))) {
    throw new Error("Only the note owner can revoke share links");
  }
  const { data, error } = await db
    .from("note_share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("note_id", noteId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Share link not found or already revoked");
  return true;
}


export async function previewNoteShareLink(
  db: DataClient,
  deps: Pick<NotesDeps, "getNoteOwnerPresentation" | "resolveNoteAccess">,
  token: string, userId: string,
) {
  const { hashNoteShareToken, isValidNoteShareTokenFormat } =
    await import("../noteShareTokens");
  if (!isValidNoteShareTokenFormat(token)) {
    const err = new Error("Invalid share link") as Error & { code?: string };
    err.code = "share_link_invalid";
    throw err;
  }
  const tokenHash = hashNoteShareToken(token);
  const { data: link, error } = await db
    .from("note_share_links")
    .select("id, note_id, role, expires_at, revoked_at, created_by")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!link) {
    const err = new Error("Share link not found") as Error & {
      code?: string;
    };
    err.code = "share_link_not_found";
    throw err;
  }
  if (link.revoked_at) {
    const err = new Error("This share link has been revoked") as Error & {
      code?: string;
    };
    err.code = "share_link_revoked";
    throw err;
  }
  if (link.expires_at && new Date(link.expires_at) <= new Date()) {
    const err = new Error("This share link has expired") as Error & {
      code?: string;
    };
    err.code = "share_link_expired";
    throw err;
  }

  const { data: note, error: noteError } = await db
    .from("notes")
    .select("id, title, user_id")
    .eq("id", link.note_id)
    .single();
  if (noteError) throw noteError;

  const owner = await deps.getNoteOwnerPresentation(note.user_id);
  const existing = await deps.resolveNoteAccess(note.id, userId);

  return {
    shareLinkId: link.id,
    noteId: note.id,
    title: note.title,
    role: link.role as "viewer" | "editor",
    owner,
    alreadyHasAccess: Boolean(existing),
    currentAccessRole: existing?.accessRole,
    isOwner: note.user_id === userId,
  };
}


export async function acceptNoteShareLink(
  db: DataClient,
  deps: Pick<NotesDeps, "createNotification" | "getNote" | "service">,
  token: string, userId: string,
) {
  const { hashNoteShareToken, isValidNoteShareTokenFormat } =
    await import("../noteShareTokens");
  if (!isValidNoteShareTokenFormat(token)) {
    const err = new Error("Invalid share link") as Error & { code?: string };
    err.code = "share_link_invalid";
    throw err;
  }
  const tokenHash = hashNoteShareToken(token);
  const { data, error } = await db.rpc("accept_note_share_link", {
    p_token_hash: tokenHash,
    p_user_id: userId,
  });
  if (error) {
    const message = error.message || "Failed to accept share link";
    const err = new Error(
      message.includes("share_link_revoked")
        ? "This share link has been revoked"
        : message.includes("share_link_expired")
          ? "This share link has expired"
          : message.includes("share_link_not_found")
            ? "Share link not found"
            : "Failed to accept share link",
    ) as Error & { code?: string };
    if (message.includes("share_link_revoked"))
      err.code = "share_link_revoked";
    else if (message.includes("share_link_expired"))
      err.code = "share_link_expired";
    else if (message.includes("share_link_not_found"))
      err.code = "share_link_not_found";
    throw err;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.note_id) {
    throw new Error("Failed to accept share link");
  }

  const note = await deps.getNote(row.note_id, userId);

  // Notify owner (best-effort) when a new collaborator accepts
  if (!row.already_accepted && note.userId !== userId) {
    const { data: profile } = await db
      .from("profiles")
      .select("name, username")
      .eq("id", userId)
      .maybeSingle();
    // NB: this local `actor` is the REDEEMER's DISPLAY NAME for the
    // notification copy — it is the person being HELPED, i.e. the exact
    // opposite of a learning-connection actorId. Do not reuse it below.
    const actor = profile?.name || profile?.username || "Someone";

    // North-star metric (Phase 3 · O): the note's author is the actor.
    // Phase 3 M: the feed verb that matched this hook had no writer.
    void (async () => {
      const { getActivityFeedService } = await import("../activityFeed");
      await getActivityFeedService(deps.service).record({
        actorId: note.userId,
        verb: "shared_note",
        objectType: "note",
        objectId: note.id,
        audienceType: "followers",
        courseId: (note as { courseId?: string | null }).courseId ?? null,
        payload: { title: (note as { title?: string }).title ?? null },
      });
    })();

    void (async () => {
      const { getLearningConnectionsService } = await import(
        "../learningConnections"
      );
      await getLearningConnectionsService(deps.service).record({
        actorId: note.userId,
        beneficiaryId: userId,
        kind: "note_redeemed",
        objectType: "note",
        objectId: note.id,
        courseId: (note as { courseId?: string | null }).courseId ?? null,
      });
    })();

    void deps.createNotification(note.userId, {
      type: "note_share_accepted",
      message: `${actor} accepted your invite to "${note.title}"`,
      link: `/notes/${note.id}`,
      data: {
        noteId: note.id,
        redeemerUserId: userId,
        role: row.granted_role,
      },
    }).catch(() => {});
  }

  return {
    note,
    grantedRole: row.granted_role as string,
    alreadyAccepted: Boolean(row.already_accepted),
    shareLinkId: row.share_link_id as string,
  };
}


/**
 * Detached personal copy: note body + storage-backed attachments.
 * Excludes collaborators, comments, group membership, and quiz history.
 */
export async function copyNoteForUser(
  deps: Pick<
    NotesDeps,
    | "addNoteAttachment"
    | "createNote"
    | "downloadNoteFile"
    | "getNote"
    | "getNoteAttachments"
    | "resolveNoteAttachmentStoragePath"
    | "uploadNoteFile"
  >,
  sourceNoteId: string, userId: string,
) {
  const source = await deps.getNote(sourceNoteId, userId);
  const attachments = await deps.getNoteAttachments(sourceNoteId);

  const copyTitle = source.title?.startsWith("Copy of ")
    ? source.title
    : `Copy of ${source.title || "Untitled Note"}`;

  const created = await deps.createNote(userId, {
    title: copyTitle,
    body: source.body || "",
    summary: source.summary,
    sourceType: source.sourceType,
    youtubeUrl: source.youtubeUrl,
    youtubeVideoId: source.youtubeVideoId,
    // Personal copy is never group-shared by default
    folderId: undefined,
    groupId: undefined,
    copiedFromNoteId: source.id,
  });

  for (const attachment of attachments) {
    let fileUrl = attachment.fileUrl as string | undefined;
    const storagePath = deps.resolveNoteAttachmentStoragePath(attachment);
    if (storagePath) {
      try {
        const downloaded = await deps.downloadNoteFile(storagePath);
        const newPath = buildNoteStoragePath(
          userId,
          attachment.fileName || "file",
        );
        await deps.uploadNoteFile({
          storagePath: newPath,
          buffer: downloaded.buffer,
          contentType: downloaded.contentType,
        });
        fileUrl = newPath;
      } catch (err) {
        logger.warn(
          "Failed to copy note attachment file; keeping metadata only",
          {
            err,
            sourceNoteId,
            attachmentId: attachment.id,
          },
        );
        // External URLs (youtube) or failed downloads: preserve original fileUrl if external
        if (storagePath && fileUrl === storagePath) {
          fileUrl = undefined;
        }
      }
    }

    await deps.addNoteAttachment(created.id, {
      type: attachment.type,
      fileUrl,
      fileName: attachment.fileName,
      extractedText: attachment.extractedText,
      metadata: {
        ...(attachment.metadata || {}),
        copiedFromAttachmentId: attachment.id,
      },
    });
  }

  return deps.getNote(created.id, userId);
}


export async function getNoteComments(
  db: DataClient,
  noteId: string,
) {
  const { data, error } = await db
    .from("note_comments")
    .select(NOTE_COMMENT_SELECT)
    .eq("note_id", noteId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => mapNoteCommentRow(row));
}


export async function addNoteComment(
  db: DataClient,
  noteId: string, userId: string, comment: string,
) {
  const { data, error } = await db
    .from("note_comments")
    .insert({ note_id: noteId, user_id: userId, comment })
    .select(NOTE_COMMENT_SELECT)
    .single();
  if (error) throw error;
  return mapNoteCommentRow(data as any);
}


export async function shareNoteWithGroup(
  deps: Pick<NotesDeps, "updateNote">,
  noteId: string, userId: string, groupId: string,
) {
  return deps.updateNote(userId, noteId, { groupId, isShared: true });
}


export function mapNoteQuiz(
  row: any,
) {
  return {
    date: String(row.updated_at || row.created_at || "").slice(0, 10),
    noteId: row.note_id,
    questions: Array.isArray(row.questions) ? row.questions : [],
    answers:
      row.answers && typeof row.answers === "object" ? row.answers : {},
    completed: Boolean(row.completed),
    studyGoal: row.study_goal || "retention",
  };
}


export async function getNoteQuiz(
  db: DataClient,
  deps: Pick<NotesDeps, "getNote" | "mapNoteQuiz">,
  userId: string, noteId: string,
) {
  await deps.getNote(noteId, userId);
  const { data, error } = await db
    .from("note_quizzes")
    .select("*")
    .eq("note_id", noteId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? deps.mapNoteQuiz(data) : null;
}


/**
 * REL-02: a quiz with recorded answers or a completed run must never be
 * overwritten by regenerate. Shared by upsertNoteQuiz and the quiz route's
 * pre-generation check (so a refused regenerate never burns an AI call).
 */
export function isNoteQuizProtected(
  quiz:
    | { completed?: boolean; answers?: Record<string, unknown> | null }
    | null
    | undefined,
): boolean {
  if (!quiz) return false;
  const answerCount =
    quiz.answers && typeof quiz.answers === "object"
      ? Object.keys(quiz.answers).length
      : 0;
  return Boolean(quiz.completed) || answerCount > 0;
}


export async function upsertNoteQuiz(
  db: DataClient,
  deps: Pick<
    NotesDeps,
    | "getNote"
    | "getNoteQuiz"
    | "isNoteQuizProtected"
    | "mapNoteQuiz"
  >,
  userId: string,
  noteId: string,
  payload: {
    studyGoal: string;
    questions: unknown[];
  },
) {
  await deps.getNote(noteId, userId);

  // REL-02: never wipe an in-progress or completed quiz on regenerate.
  // `reused: true` tells the client the questions it got back are the old
  // ones, not a fresh generation (absent means fresh).
  const existing = await deps.getNoteQuiz(userId, noteId);
  if (existing) {
    if (deps.isNoteQuizProtected(existing)) {
      return { ...existing, reused: true };
    }

    // Race guard is `completed = false` only. Do NOT add a jsonb equality
    // filter here: postgrest-js serializes `.eq("answers", {})` as
    // `answers=eq.[object Object]`, which Postgres cannot cast to jsonb, so
    // every regenerate of an untouched quiz 500'd after the AI had already
    // generated the new questions.
    const { data, error } = await db
      .from("note_quizzes")
      .update({
        study_goal: payload.studyGoal,
        questions: payload.questions,
        answers: {},
        completed: false,
        updated_at: new Date().toISOString(),
      })
      .eq("note_id", noteId)
      .eq("user_id", userId)
      .eq("completed", false)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      // The quiz was completed between the pre-check and the update; hand
      // back the winner's quiz rather than wipe it.
      const raced = await deps.getNoteQuiz(userId, noteId);
      if (raced) return { ...raced, reused: true };
      throw new Error("Failed to update note quiz");
    }
    return deps.mapNoteQuiz(data);
  }

  const { data, error } = await db
    .from("note_quizzes")
    .insert({
      note_id: noteId,
      user_id: userId,
      study_goal: payload.studyGoal,
      questions: payload.questions,
      answers: {},
      completed: false,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) {
    // Concurrent first insert: return the winner's row rather than wipe.
    if (error.code === "23505") {
      const raced = await deps.getNoteQuiz(userId, noteId);
      if (raced) return raced;
    }
    throw error;
  }
  return deps.mapNoteQuiz(data);
}


export async function updateNoteQuiz(
  db: DataClient,
  deps: Pick<NotesDeps, "getNote" | "mapNoteQuiz">,
  userId: string,
  noteId: string,
  updates: { answers?: Record<string, string>; completed?: boolean },
) {
  await deps.getNote(noteId, userId);
  const dbUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (updates.answers !== undefined) dbUpdates.answers = updates.answers;
  if (updates.completed !== undefined)
    dbUpdates.completed = updates.completed;

  const { data, error } = await db
    .from("note_quizzes")
    .update(dbUpdates)
    .eq("note_id", noteId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return deps.mapNoteQuiz(data);
}

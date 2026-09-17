/**
 * Companion conversation (thread) helpers — auth-scoped list/create/resolve.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { bestEffortWrite } from './data/writeResult';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCompanionUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return UUID_RE.test(trimmed) ? trimmed : null;
}

export type CompanionConversationRow = {
  id: string;
  note_context_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanionConversationSummary = {
  id: string;
  title: string;
  preview: string;
  noteContextId: string | null;
  noteTitle: string | null;
  createdAt: string;
  updatedAt: string;
};

function titleFromMessage(content: string | null | undefined): string {
  const trimmed = (content || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'New chat';
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

function previewFromMessage(content: string | null | undefined): string {
  const trimmed = (content || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}…` : trimmed;
}

export async function createCompanionConversation(
  client: SupabaseClient,
  userId: string,
  noteContextId: string | null,
  title?: string | null
): Promise<CompanionConversationRow> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('ai_companion_conversations')
    .insert({
      user_id: userId,
      note_context_id: noteContextId,
      title: title?.trim() ? title.trim().slice(0, 120) : null,
      created_at: now,
      updated_at: now,
    })
    .select('id, note_context_id, title, created_at, updated_at')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create conversation');
  }
  return data as CompanionConversationRow;
}

export async function getOwnedConversation(
  client: SupabaseClient,
  userId: string,
  conversationId: string
): Promise<CompanionConversationRow | null> {
  const { data, error } = await client
    .from('ai_companion_conversations')
    .select('id, note_context_id, title, created_at, updated_at')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return (data as CompanionConversationRow | null) ?? null;
}

/**
 * Resolve which conversation a send belongs to.
 * - Valid owned conversationId → that thread (note_context from the conversation wins)
 * - forceNew → always create a new thread
 * - else reuse the latest thread for this note scope (legacy clients / continue chat)
 * - if none exists → create
 */
export async function resolveConversationForSend(
  client: SupabaseClient,
  userId: string,
  conversationId: string | null,
  noteContextId: string | null,
  options?: { forceNew?: boolean }
): Promise<CompanionConversationRow> {
  if (!options?.forceNew && conversationId) {
    const existing = await getOwnedConversation(client, userId, conversationId);
    if (existing) return existing;
  }

  if (!options?.forceNew) {
    const latest = await findLatestConversationForNoteScope(
      client,
      userId,
      noteContextId
    );
    if (latest) return latest;
  }

  return createCompanionConversation(client, userId, noteContextId);
}

export async function touchConversation(
  client: SupabaseClient,
  userId: string,
  conversationId: string,
  patch?: { title?: string | null }
): Promise<void> {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch?.title !== undefined) {
    updates.title = patch.title;
  }
  // BEST EFFORT (#108): an `updated_at` touch that keeps the conversation at
  // the top of the list, plus an optional title. A lost one costs list order.
  bestEffortWrite(
    await client
      .from('ai_companion_conversations')
      .update(updates)
      .eq('id', conversationId)
      .eq('user_id', userId),
    { table: 'ai_companion_conversations', op: 'update', conversationId, userId },
  );
}

export async function ensureConversationTitle(
  client: SupabaseClient,
  userId: string,
  conversation: CompanionConversationRow,
  firstUserMessage: string
): Promise<void> {
  if (conversation.title?.trim()) return;
  await touchConversation(client, userId, conversation.id, {
    title: titleFromMessage(firstUserMessage),
  });
}

export async function listCompanionConversations(
  client: SupabaseClient,
  userId: string,
  limit = 40
): Promise<CompanionConversationSummary[]> {
  const { data: rows, error } = await client
    .from('ai_companion_conversations')
    .select('id, note_context_id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  if (error) throw error;
  const conversations = (rows || []) as CompanionConversationRow[];
  if (conversations.length === 0) return [];

  const ids = conversations.map((c) => c.id);
  const noteIds = [
    ...new Set(
      conversations
        .map((c) => c.note_context_id)
        .filter((id): id is string => typeof id === 'string' && Boolean(id))
    ),
  ];

  const [{ data: messageRows }, { data: noteRows }] = await Promise.all([
    client
      .from('ai_companion_messages')
      .select('conversation_id, role, content, created_at')
      .eq('user_id', userId)
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      // Enough rows to cover latest preview + first-user title fallback per thread.
      .limit(Math.min(ids.length * 40, 800)),
    noteIds.length
      ? client.from('notes').select('id, title').eq('user_id', userId).in('id', noteIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string | null }> }),
  ]);

  const noteTitleById = new Map<string, string>();
  for (const note of noteRows || []) {
    const title =
      typeof note.title === 'string' && note.title.trim()
        ? note.title.trim()
        : 'Untitled note';
    noteTitleById.set(note.id, title);
  }

  // Latest message + first user message per conversation (from newest-first rows).
  const latestByConv = new Map<string, { role: string; content: string }>();
  const firstUserByConv = new Map<string, string>();
  const hasMessages = new Set<string>();

  for (const row of messageRows || []) {
    const convId = row.conversation_id as string | null;
    if (!convId) continue;
    hasMessages.add(convId);
    if (!latestByConv.has(convId)) {
      latestByConv.set(convId, {
        role: row.role as string,
        content: typeof row.content === 'string' ? row.content : '',
      });
    }
    if (row.role === 'user' && typeof row.content === 'string') {
      // Keep walking so the last assignment (oldest in this reverse walk) becomes first user msg.
      firstUserByConv.set(convId, row.content);
    }
  }

  return conversations
    .filter((c) => hasMessages.has(c.id))
    .map((c) => {
      const latest = latestByConv.get(c.id);
      const firstUser = firstUserByConv.get(c.id);
      const storedTitle = c.title?.trim();
      return {
        id: c.id,
        title: storedTitle || titleFromMessage(firstUser) || 'Chat',
        preview: previewFromMessage(latest?.content) || titleFromMessage(firstUser),
        noteContextId: c.note_context_id,
        noteTitle: c.note_context_id ? noteTitleById.get(c.note_context_id) || null : null,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      };
    });
}

export async function findLatestConversationForNoteScope(
  client: SupabaseClient,
  userId: string,
  noteContextId: string | null
): Promise<CompanionConversationRow | null> {
  let query = client
    .from('ai_companion_conversations')
    .select('id, note_context_id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1);

  query = noteContextId
    ? query.eq('note_context_id', noteContextId)
    : query.is('note_context_id', null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as CompanionConversationRow | null) ?? null;
}

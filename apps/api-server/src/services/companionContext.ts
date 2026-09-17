/**
 * Build server-trusted AI companion context — ignores client-forged study/privacy fields.
 */
/**
 * Purpose: assemble the context block that goes into the AI companion's system
 * prompt, and the authorised message set for a group-chat summary.
 *
 * Exports:
 * - `buildTrustedCompanionContext` — called by routes/ai.ts (`/ai/companion/*`)
 *   and by the BullMQ companion processor that answers `/message` in
 *   production.
 * - `fetchAuthorizedGroupSummaryMessages` — called by the group-summary route
 *   before `aiService.summarizeGroupChat`.
 *
 * What it touches: Supabase tables `profiles`, `group_members` + `groups`,
 * `flashcards` + `decks`, `user_preferences`, `notes`, and `test_sessions` via
 * `SupabaseService.fetchTestResults`. Lazily imports `topicMastery` (the
 * materialised Mastery Graph), `notePages` (per-page transcripts) and
 * `classSections` (the class corpus). No external API is called from here; the
 * result is handed to aiService, which calls Groq/Fireworks.
 *
 * The defence this module IS: every study and entitlement fact in the returned
 * context is re-derived SERVER-SIDE from the caller's own rows. The client's
 * `context` object is not merged in. Group names, due-card counts, weak topics,
 * the last test score and the wallet line are all read here; `noteId`,
 * `attachmentId`, `pageIndex` and `classId` are accepted only as ids, UUID-
 * shape-checked, and then re-read under a `user_id = userId` filter, so a
 * stranger's id returns nothing rather than their content. The few free-text
 * fields a client may contribute (`currentScreen`, `activeSessionSummary`,
 * `studyGoal`, `userName`) pass through `sanitizeHint`, which strips control
 * characters and hard-caps length. `mode` and `guided` are the only structured
 * client fields honoured, and only through their normalisers.
 */
import { isCardDue } from '@lantern/shared/utils/srs';
import type { DataLayer } from './data';
import {
  normalizeCompanionMode,
  normalizeGuidedSessionContext,
  type CompanionContext,
} from './aiService';
import {
  WEAK_TOPIC_SESSION_LIMIT,
  buildTagBreakdown,
  deriveWeakTopics,
} from './companionWeakTopics';

const MAX_HINT_LEN = 120;
/**
 * How much of the note travels to companionChat.
 *
 * This is NOT the prompt size. companionChat splits this into chunks and sends
 * only the 2-3 that match the question, so raising the cap widens what the
 * tutor can reach without widening what it costs — at 6000 the tutor simply
 * could not see past the opening of a lecture-length note, and answered
 * "from your notes" using material it had never been shown.
 */
const MAX_NOTE_LEN = 24000;

function sanitizeHint(value: unknown, maxLen = MAX_HINT_LEN): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function extractMessageText(message: Record<string, unknown>): string {
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (text) return text;
  const stem = typeof message.questionStem === 'string' ? message.questionStem.trim() : '';
  if (stem) return stem;
  const questionData = message.question_data as Record<string, unknown> | null | undefined;
  const nestedStem = typeof questionData?.questionStem === 'string' ? questionData.questionStem.trim() : '';
  return nestedStem;
}

/**
 * Build the companion context for one turn, server-side.
 *
 * `clientContext` is treated as a set of REQUESTS, never as facts. Everything
 * the model is told about the student — who they are, what they are behind on,
 * how many cards are due, what they last scored, what is in their wallet — is
 * queried here from rows keyed to `userId`. A client that inflates its own
 * context changes nothing the assistant says about the student's data.
 *
 * `context.guided` is the one exception worth naming: it is honoured only in
 * guided mode, and only after `normalizeGuidedSessionContext` shape-checks it,
 * caps its strings and clamps the step index. A malformed guided block is
 * dropped whole, which costs one block of prompt rather than a wrong answer.
 *
 * Resolution order for the note context, widest scope last:
 *   1. `noteId` — the owned note's summary + body, capped at MAX_NOTE_LEN.
 *   2. `attachmentId` + `pageIndex` — page scope REPLACES the whole-note body
 *      and returns early, so nothing wider is appended.
 *   3. Otherwise the class corpus is appended for `classId`.
 */
export async function buildTrustedCompanionContext(
  layer: DataLayer,
  userId: string,
  clientContext: CompanionContext & { noteId?: string } = {}
): Promise<CompanionContext> {
  const db = layer.getClient();

  // --- Server-derived facts -------------------------------------------------
  // Four owner-scoped reads in parallel, plus the test history. Nothing below
  // reads a count, a score or a balance out of `clientContext`.
  const [
    profileResult,
    groupsResult,
    flashcardsResult,
    prefsResult,
  ] = await Promise.all([
    db.from('profiles').select('name, first_name, settings').eq('id', userId).maybeSingle(),
    db
      .from('group_members')
      .select('groups!inner(name, is_archived)')
      .eq('user_id', userId)
      .eq('pending', false)
      .limit(20),
    db
      .from('flashcards')
      .select('srs_data, decks!inner(user_id)')
      .eq('decks.user_id', userId)
      .limit(120),
    db.from('user_preferences').select('preferences, theme').eq('user_id', userId).maybeSingle(),
  ]);

  const testResults = await layer.tests.fetchTestResults(userId);

  const profile = profileResult.data;
  const userName =
    profile?.first_name ||
    profile?.name ||
    sanitizeHint(clientContext.userName, 80) ||
    'Student';

  const groupNames = (groupsResult.data || [])
    .map((row: any) => {
      const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
      if (!group || group.is_archived) return null;
      return typeof group.name === 'string' ? group.name : null;
    })
    .filter((name): name is string => Boolean(name))
    .slice(0, 5);

  // Use the shared predicate rather than a local copy. This number is fed to the
  // AI companion, so when it drifts from the clients the assistant states a
  // different due count than the dashboards show.
  const dueCardsCount = (flashcardsResult.data || []).filter((card: any) =>
    isCardDue(card.srs_data || card.srsData)
  ).length;

  // Weak topics are derived here, server-side, from the most recent full
  // sessions. fetchTestResults maps whole test_sessions rows (questions jsonb +
  // user_answers), so no second query is needed; only the newest N feed the
  // tally so the companion reflects current standing, not all-time history.
  // (The old code read `result.tagBreakdown`, which nothing ever produced, so
  // weakTopics was always empty.)
  //
  // Phase 3 P: prefer the materialised Mastery Graph when it has rows — it
  // spans every session AND the flashcard side, where the inline tally only
  // sees the last N sessions' questions. The inline tally stays as the
  // fallback for users whose graph has not been built yet (it is refreshed on
  // test completion, so a brand-new account has none), which also means the
  // companion never regresses to silence if the refresh RPC is failing.
  let weakTopics: string[] = [];
  try {
    const { getTopicMasteryService } = await import('./topicMastery');
    // TRANSITIONAL (M2d): `getTopicMasteryService` still takes the `SupabaseService` facade whole.
    const masteryWeak = await getTopicMasteryService(layer.legacyService).weakTopics(userId, 5);
    weakTopics = masteryWeak.map((row) => row.topic);
  } catch {
    /* fall through to the inline tally */
  }
  if (weakTopics.length === 0) {
    weakTopics = deriveWeakTopics(
      buildTagBreakdown(testResults.slice(0, WEAK_TOPIC_SESSION_LIMIT).map((result) => result.session))
    );
  }

  const recentTest = testResults[0];
  const recentTestSummary =
    recentTest && typeof recentTest.score === 'number'
      ? `Last test: ${Math.round(recentTest.score)}%`
      : undefined;

  let budgetSummary: string | undefined;
  const extras = (prefsResult.data?.preferences as { budgetExtras?: Record<string, unknown> } | null)?.budgetExtras;
  const walletBalance = extras && typeof extras.walletBalance === 'number' ? extras.walletBalance : null;
  if (walletBalance != null) {
    budgetSummary = `Wallet balance: ₦${walletBalance.toFixed(0)}`;
  }

  const studyGoalFromPrefs =
    (prefsResult.data?.preferences as { studyGoal?: string } | null)?.studyGoal ||
    (profile?.settings as { study?: { goal?: string } } | null)?.study?.goal;

  const trusted: CompanionContext = {
    userName,
    groups: groupNames,
    weakTopics,
    dueCardsCount,
    recentTestSummary,
    budgetSummary,
    currentScreen: sanitizeHint(clientContext.currentScreen, 80),
    activeSessionSummary: sanitizeHint(clientContext.activeSessionSummary, 200),
    studyGoal: sanitizeHint(clientContext.studyGoal || studyGoalFromPrefs, 40),
    // The study mode is the one context field the client legitimately owns —
    // it is a UI choice, not a claim about the student's data. It still goes
    // through the allowlist, so an unknown value falls back to 'explain'
    // instead of being pasted into the system prompt.
    mode: normalizeCompanionMode(clientContext.mode),
    // Where the Guided lesson got to. Like `mode` this is UI state the client
    // legitimately owns — a claim about its own screen, not about the
    // student's data — so it is allowed through, but only after the same kind
    // of allowlisting: shape-checked, length-capped, step clamped, and dropped
    // entirely when malformed. A dropped session costs one block of prompt,
    // not a wrong answer.
    guided: normalizeGuidedSessionContext(clientContext.guided),
  };

  // --- Note scope -----------------------------------------------------------
  // The client names a note; the server decides whether it is theirs. The
  // `user_id` filter on the read is the ownership predicate — the service-role
  // client bypasses RLS, so it cannot be left to the database.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const rawNoteId = typeof clientContext.noteId === 'string' ? clientContext.noteId.trim() : '';
  const noteId = UUID_RE.test(rawNoteId) ? rawNoteId : undefined;
  if (noteId) {
    const { data: note } = await db
      .from('notes')
      .select('id, title, body, summary, source_type, user_id')
      .eq('id', noteId)
      .eq('user_id', userId)
      .maybeSingle();

    if (note) {
      trusted.noteId = note.id;
      trusted.noteTitle = sanitizeHint(note.title, 120);
      const body = [
        typeof note.summary === 'string' ? note.summary : '',
        typeof note.body === 'string' ? note.body : '',
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, MAX_NOTE_LEN);
      if (body) trusted.noteContext = body;
    }
  }

  /**
   * Walk-through page scope.
   *
   * When the student asks about the page they are on, the trusted context is
   * that page and NOTHING else: the whole-note body above is replaced, and the
   * class corpus below is not appended. Anything wider would put "answered
   * from your notes" under a reply written from material the student is not
   * looking at.
   *
   * Every failure lands in the same place — an empty `noteContext`. A page
   * that is blank, a page that does not exist and a migration that has not
   * been applied all mean the companion has been shown nothing, and the
   * existing clamp in companionChat turns "shown nothing" into
   * "answered from general knowledge" on its own.
   */
  const rawAttachmentId =
    typeof clientContext.attachmentId === 'string' ? clientContext.attachmentId.trim() : '';
  const attachmentId = UUID_RE.test(rawAttachmentId) ? rawAttachmentId : undefined;
  const rawPageIndex = Number(clientContext.pageIndex);
  const pageIndex =
    Number.isFinite(rawPageIndex) && rawPageIndex >= 0 ? Math.floor(rawPageIndex) : undefined;
  const pageScoped = Boolean(noteId && trusted.noteId && attachmentId && pageIndex !== undefined);

  if (pageScoped && noteId && attachmentId && pageIndex !== undefined) {
    trusted.attachmentId = attachmentId;
    trusted.pageIndex = pageIndex;
    trusted.noteContext = undefined;
    try {
      const { getPageText } = await import('./notePages');
      // TRANSITIONAL (M2d): `getPageText` still takes the `SupabaseService` facade whole.
      const page = await getPageText(layer.legacyService, { noteId, attachmentId, pageIndex });
      const text = page.reason === 'ok' ? page.text.trim() : '';
      if (text) trusted.noteContext = text.slice(0, MAX_NOTE_LEN);
    } catch {
      /* pages unavailable — the companion answers from general knowledge */
    }
    return trusted;
  }

  // --- Class corpus ---------------------------------------------------------
  // Widest scope, and last: appended only when the turn is not page-scoped.
  // `corpusForCompanion` applies its own enrolment check, so an unenrolled
  // classId yields nothing.
  const rawClassId = typeof clientContext.classId === 'string' ? clientContext.classId.trim() : '';
  const classId = UUID_RE.test(rawClassId) ? rawClassId : undefined;
  try {
    const { getClassSectionsService } = await import('./classSections');
    const corpus = await getClassSectionsService(layer).corpusForCompanion(userId, classId);
    if (corpus) {
      const combined = [trusted.noteContext || '', corpus].filter(Boolean).join('\n\n').slice(0, MAX_NOTE_LEN);
      if (combined) trusted.noteContext = combined;
    }
  } catch {
    /* classes migration unapplied — companion still works */
  }

  return trusted;
}

// --- Group-chat summary ------------------------------------------------------

/**
 * Collect the messages a group summary may be written from.
 *
 * Membership is the gate: a non-member gets a 403 before any message is read.
 * The `full` response profile is used so QUESTION stems carried in
 * `question_data` are included — the compact profile omits them, which made
 * summaries of a question-heavy group read as empty.
 *
 * FIXED (F7a): these strings are other members' text. They are still returned
 * raw here — this function's job is authorization and retrieval — but
 * `aiService.summarizeGroupChat` now routes them through
 * `buildGroupChatMessagesBlock`, which sanitizes each line, caps it, defangs a
 * typed fence marker and wraps the block in a BEGIN/END UNTRUSTED fence the
 * system prompt names as data. Any new consumer of these strings owes them the
 * same treatment: they are the one cross-user injection surface in the
 * companion.
 */
export async function fetchAuthorizedGroupSummaryMessages(
  layer: DataLayer,
  groupId: string,
  userId: string,
  limit = 50
): Promise<{ groupName: string; messages: string[] }> {
  const isMember = await layer.groups.isGroupMember(groupId, userId);
  if (!isMember) {
    throw Object.assign(new Error('You are not a member of this group'), { statusCode: 403 });
  }

  const group = await layer.groups.getGroupById(groupId);
  const groupName = group?.name || 'Group';

  // Use full profile so QUESTION stems in question_data are included (compact omits them).
  const rows = await layer.groupMessages.getGroupMessages(groupId, {
    page: 1,
    limit: Math.min(limit, 50),
    responseProfile: 'full',
  });

  const messages = (rows || [])
    .filter((row: any) => !row.is_archived && !row.isArchived)
    .map((row: any) => {
      const text = extractMessageText(row as Record<string, unknown>);
      if (!text) return '';
      const type = String(row.type || '').toUpperCase();
      return type === 'QUESTION' ? `[Question] ${text}` : text;
    })
    .filter((text: string) => text.length > 0)
    .slice(-limit);

  return { groupName, messages };
}

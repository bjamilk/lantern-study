/**
 * Build server-trusted AI companion context — ignores client-forged study/privacy fields.
 */
import { isCardDue } from '@lantern/shared/utils/srs';
import type { SupabaseService } from './supabase';
import { normalizeCompanionMode, type CompanionContext } from './aiService';
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

export async function buildTrustedCompanionContext(
  supabaseService: SupabaseService,
  userId: string,
  clientContext: CompanionContext & { noteId?: string } = {}
): Promise<CompanionContext> {
  const db = supabaseService.getClient();

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

  const testResults = await supabaseService.fetchTestResults(userId);

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
    const masteryWeak = await getTopicMasteryService(supabaseService).weakTopics(userId, 5);
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
  };

  const rawNoteId = typeof clientContext.noteId === 'string' ? clientContext.noteId.trim() : '';
  const noteId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawNoteId)
      ? rawNoteId
      : undefined;
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

  return trusted;
}

export async function fetchAuthorizedGroupSummaryMessages(
  supabaseService: SupabaseService,
  groupId: string,
  userId: string,
  limit = 50
): Promise<{ groupName: string; messages: string[] }> {
  const isMember = await supabaseService.isGroupMember(groupId, userId);
  if (!isMember) {
    throw Object.assign(new Error('You are not a member of this group'), { statusCode: 403 });
  }

  const group = await supabaseService.getGroupById(groupId);
  const groupName = group?.name || 'Group';

  // Use full profile so QUESTION stems in question_data are included (compact omits them).
  const rows = await supabaseService.getGroupMessages(groupId, {
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

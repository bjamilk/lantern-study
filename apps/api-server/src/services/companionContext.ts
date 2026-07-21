/**
 * Build server-trusted AI companion context — ignores client-forged study/privacy fields.
 */
import type { SupabaseService } from './supabase';
import type { CompanionContext } from './aiService';

const MAX_HINT_LEN = 120;
const MAX_NOTE_LEN = 6000;

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

  const now = Date.now();
  const dueCardsCount = (flashcardsResult.data || []).filter((card: any) => {
    const srs = (card.srs_data || card.srsData) as
      | { nextReviewDate?: string; next_review_date?: string; nextReview?: string; repetitions?: number }
      | null
      | undefined;
    if (!srs) return false;
    const nextRaw = srs.nextReviewDate || srs.next_review_date || srs.nextReview;
    if (!nextRaw) {
      // New cards are not due; only corrupted learning cards without a date count
      return (srs.repetitions ?? 0) > 0;
    }
    const next = Date.parse(nextRaw);
    return Number.isFinite(next) && next <= now;
  }).length;

  const weakTopicSet = new Set<string>();
  for (const result of testResults.slice(0, 10)) {
    const breakdown = (result as { tagBreakdown?: Record<string, { total?: number; correct?: number }> })
      .tagBreakdown;
    if (!breakdown) continue;
    for (const [tag, stats] of Object.entries(breakdown)) {
      const total = stats?.total ?? 0;
      const correct = stats?.correct ?? 0;
      if (total > 0 && correct / total < 0.6) weakTopicSet.add(tag);
    }
  }
  const weakTopics = [...weakTopicSet].slice(0, 5);

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
  };

  const noteId = sanitizeHint(clientContext.noteId, 64);
  if (noteId) {
    const { data: note } = await db
      .from('notes')
      .select('id, title, body, summary, source_type, user_id')
      .eq('id', noteId)
      .eq('user_id', userId)
      .maybeSingle();

    if (note) {
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

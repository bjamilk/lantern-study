// ===========================================
// Lantern Study - Shared AI Companion Client
// ===========================================

import type {
  CompanionAction,
  CompanionCitation,
  CompanionConversation,
  CompanionImageAttachment,
  CompanionMode,
  CompanionUserContext,
} from '../types';
import type { AIClientConfig } from './ai';
import { parseGlobalAIUsageFromHeaders } from './usageHeaders';
import { JobStillRunningError, createJobClient } from '../jobs/jobClient';

/**
 * The modes a client may ask for, in the server's own order. Kept next to the
 * request builder because this list is what goes ON THE WIRE — the server
 * re-validates it, and an unknown value there falls back to `explain` rather
 * than reaching the system prompt.
 */
export const COMPANION_MODES: readonly CompanionMode[] = [
  'explain',
  'quiz_me',
  'socratic',
  'guided',
];

export const DEFAULT_COMPANION_MODE: CompanionMode = 'explain';

/** Student-facing labels — web and mobile must show the same words. */
export const COMPANION_MODE_LABELS: Record<CompanionMode, string> = {
  explain: 'Explain',
  quiz_me: 'Quiz me',
  socratic: 'Socratic',
  guided: 'Guided',
};

export function isCompanionMode(value: unknown): value is CompanionMode {
  return typeof value === 'string' && (COMPANION_MODES as readonly string[]).includes(value);
}

/** Anything unknown becomes `explain`, the same fallback the server applies. */
export function normalizeCompanionMode(value: unknown): CompanionMode {
  return isCompanionMode(value) ? value : DEFAULT_COMPANION_MODE;
}

/**
 * What Guided promises, in one line, on both surfaces.
 *
 * Deliberately NOT "walks you around the app". Guided is chat-only: it teaches
 * one step at a time and suggests what to do next. Claiming it navigates for
 * you would be a product-control promise the implementation cannot keep.
 */
export const GUIDED_MODE_PROMISE =
  'Lantern teaches one step at a time and checks you have got it before moving on.';

/** The picker's heading — a goal, not a blank box. */
export const GUIDED_PICKER_TITLE = 'What would you like me to guide you through?';

/**
 * Guided costs exactly what a normal message costs. Said out loud because
 * "Start a guided session" invites the assumption that a session is billed
 * separately, and because one step per turn means MORE turns, not cheaper ones.
 */
export const GUIDED_COST_NOTE = 'Same cost as a normal message — one turn, one use.';

export interface GuidedGoal {
  /** Stable key for React/RN lists. */
  id: string;
  /** `continue` only ever appears for a topic with real saved progress. */
  kind: 'continue' | 'start';
  /** The bare topic, for the accessibility label. */
  topic: string;
  /** What the row reads: `Continue learning: <topic>`. */
  label: string;
  /** The unit the plan files this topic under, when the host knows it. */
  unit?: string | null;
  /**
   * The note this topic was built from, when the plan recorded one.
   *
   * The client attaches it as THIS TURN's note context so the model has the
   * text in front of it on turn 1. Without it the first reply can only ask
   * which material to use — which is what it did.
   */
  sourceNoteId?: string | null;
  /** That note's title, when the host could resolve one. Named in the prompt. */
  sourceTitle?: string | null;
  /** The first guided turn this row sends. */
  prompt: string;
}

/**
 * The sentence a picker row sends as its first guided turn.
 *
 * Every clause is load-bearing, and each one answers a way the first turn was
 * observed to go wrong:
 *
 * - The TOPIC in quotes, not the unit. Seeding with the unit ("Imported Notes")
 *   made the model reply with a menu of the notes under it and stop.
 * - The SOURCE in quotes when one is known, so "which material?" is already
 *   answered in the question.
 * - "Start with step 1 now" — an instruction to teach, not to plan.
 * - "Do not ask me which material to use" — the same rule the server prompt
 *   carries, restated here because the seed reaches production the moment a
 *   client ships, while the prompt waits on an API deploy.
 */
export function guidedSeedPrompt(input: {
  topic: string;
  source?: string | null;
  unit?: string | null;
}): string {
  const topic = cleanTopic(input.topic) || '';
  const source = cleanTopic(input.source);
  const unit = cleanTopic(input.unit);
  return (
    `Guide me through "${topic}"` +
    (source ? ` from "${source}"` : '') +
    (unit ? ` in ${unit}` : '') +
    '. Start with step 1 now — teach that one step, then check I have got it' +
    ' before moving on. Do not ask me which material to use.'
  );
}

/**
 * The plan's next topic as a host states it.
 *
 * The unit rides along because the lesson reads differently inside its stretch
 * of the course — it goes into the PROMPT, not the row, so the label stays the
 * one line the picker promises (`Continue learning: <topic>`).
 */
export interface GuidedNextTopic {
  title: string;
  unit?: string | null;
  /** The plan topic's first source note, when the plan recorded one. */
  sourceNoteId?: string | null;
  /** That note's title, when the host could resolve one. */
  sourceTitle?: string | null;
}

/**
 * A topic the picker may offer as a cold start.
 *
 * `status` carries the plan's own word for it. Only `mastered` removes a row:
 * a COVERED topic is one the student has been through once, which is exactly
 * the thing they most often want to be walked through again — and dropping it
 * left a set with two topics, one of them covered, offering no `Start
 * learning:` row at all (AH release smoke 1.0.58, turn-2 observation).
 */
export interface GuidedStartTopic {
  title: string;
  status?: 'unseen' | 'covered' | 'mastered' | null;
  /** The unit the plan files it under — named in the prompt, not the row. */
  unit?: string | null;
  /** The topic's first source note, when the plan recorded one. */
  sourceNoteId?: string | null;
  /** That note's title, when the host could resolve one. */
  sourceTitle?: string | null;
}

export interface GuidedGoalsInput {
  /**
   * The topic the set's plan says comes next, when the host actually has one.
   * Absent (or blank) means NO `Continue learning:` row — an invented continue
   * is worse than none, because it claims progress that was never stored.
   *
   * A bare string is the title on its own; the object form adds the unit.
   */
  nextTopic?: string | GuidedNextTopic | null;
  /**
   * Topics the student could start, from the plan / units / attached note.
   *
   * A bare string is a title with no status attached; the object form is a
   * plan row, and its `status` is the ONLY thing that can remove a row.
   */
  topics?: readonly (string | GuidedStartTopic | null | undefined)[];
  /** How many rows the picker draws, `nextTopic` included. */
  limit?: number;
}

const GUIDED_GOALS_LIMIT = 6;

function cleanTopic(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : null;
}

/**
 * The rows the Guided picker draws, from material the client already has.
 *
 * Pure and model-free: building the picker spends no credits, so it is a local
 * render, never a companion call. `Continue learning:` is gated on a real
 * `nextTopic` — with none, the picker offers `Start learning:` rows only.
 */
export function buildGuidedGoals(input: GuidedGoalsInput = {}): GuidedGoal[] {
  const limit = Math.max(1, input.limit ?? GUIDED_GOALS_LIMIT);
  const goals: GuidedGoal[] = [];
  const seen = new Set<string>();

  const rawNext = input.nextTopic;
  const next = cleanTopic(typeof rawNext === 'string' ? rawNext : rawNext?.title);
  const nextObject = typeof rawNext === 'string' || !rawNext ? null : rawNext;
  const nextUnit = cleanTopic(nextObject?.unit);
  const nextSourceTitle = cleanTopic(nextObject?.sourceTitle);
  const nextSourceNoteId = cleanTopic(nextObject?.sourceNoteId);
  if (next) {
    seen.add(next.toLowerCase());
    goals.push({
      id: `continue:${next}`,
      kind: 'continue',
      topic: next,
      label: `Continue learning: ${next}`,
      unit: nextUnit,
      sourceNoteId: nextSourceNoteId,
      sourceTitle: nextSourceTitle,
      // The row still reads `Continue learning: <topic>`; only the sentence it
      // SENDS names the source, so the picker stays one line per goal.
      prompt: guidedSeedPrompt({ topic: next, source: nextSourceTitle, unit: nextUnit }),
    });
  }

  for (const raw of input.topics ?? []) {
    if (goals.length >= limit) break;
    const row: GuidedStartTopic | null =
      typeof raw === 'string' ? { title: raw } : raw && typeof raw === 'object' ? raw : null;
    // Mastered is the only status that removes a row. Covered topics stay
    // startable: "I have seen this once" is not "I never want it again".
    if (!row || row.status === 'mastered') continue;
    const topic = cleanTopic(row.title);
    if (!topic) continue;
    const key = topic.toLowerCase();
    // The Continue row already claims this topic — one row per topic.
    if (seen.has(key)) continue;
    seen.add(key);
    const unit = cleanTopic(row.unit);
    const sourceNoteId = cleanTopic(row.sourceNoteId);
    const sourceTitle = cleanTopic(row.sourceTitle);
    goals.push({
      id: `start:${topic}`,
      kind: 'start',
      topic,
      label: `Start learning: ${topic}`,
      unit,
      sourceNoteId,
      sourceTitle,
      // Same seed shape the Continue row sends: the source rides in the
      // sentence so turn 1 teaches instead of asking which material to use.
      prompt: guidedSeedPrompt({ topic, source: sourceTitle, unit }),
    });
  }

  return goals.slice(0, limit);
}

/**
 * Should the picker be drawn as a card ABOVE the composer?
 *
 * Guided used to offer the picker only in an EMPTY thread, so turning Guided
 * on mid-conversation flipped the header badge and offered nothing — the mode
 * with no way to name a target except free text (AH release smoke 1.0.57).
 * StudyFetch replaces the composer with the picker on toggle; Lantern puts it
 * just above, so the thread stays readable and the composer stays reachable.
 *
 * `hasMessages` is the whole rule: an empty thread already draws the picker in
 * its empty state, and drawing it twice is two cost lines on one screen. The
 * empty state's picker-OR-chips exclusivity is untouched by this.
 */
export function showGuidedComposerPicker(input: {
  guided: boolean;
  hasMessages?: boolean;
  /** The student shut the card for this thread. */
  dismissed?: boolean;
  /** History still coming back — offer nothing until it lands. */
  isLoadingHistory?: boolean;
}): boolean {
  if (!input.guided || input.dismissed || input.isLoadingHistory) return false;
  return input.hasMessages === true;
}

/** What the free-text row sends once the student has typed their own goal. */
export function guidedFreeTextPrompt(text: string): string {
  const goal = cleanTopic(text) || '';
  return `Guide me through ${goal}, one step at a time. Start with the first step and check I have got it before moving on.`;
}

/**
 * Read a citation off a wire payload. Anything malformed becomes null: a
 * source chip that points nowhere is worse than no chip at all.
 */
export function normalizeCompanionCitation(raw: unknown): CompanionCitation | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as { noteId?: unknown; noteTitle?: unknown; excerpts?: unknown };
  if (typeof c.noteId !== 'string' || !c.noteId.trim()) return null;
  const excerpts = Array.isArray(c.excerpts)
    ? c.excerpts.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    : [];
  if (!excerpts.length) return null;
  return {
    noteId: c.noteId.trim(),
    noteTitle:
      typeof c.noteTitle === 'string' && c.noteTitle.trim() ? c.noteTitle.trim() : 'Untitled note',
    excerpts,
  };
}

/**
 * Labels that name a CLASS of failure and say nothing about THIS one.
 *
 * `errorHandler.ts` answers an unhandled route throw with
 * `{ error: apiError.name || 'Error', message: '<the real reason>' }`, so
 * reading `error` alone surfaced the literal word "Error" to the student —
 * which is exactly what the "Add image" upload showed on the phone. When the
 * label is one of these, the sentence in `message` is the one to show.
 */
const GENERIC_ERROR_LABELS = new Set([
  'error',
  'apierror',
  'request failed',
  'validation error',
  'bad request',
  'internal server error',
  'service unavailable',
  'unknown error',
]);

/** The most useful sentence an error body has to offer. */
export function companionErrorText(
  body: { error?: unknown; message?: unknown },
  status: number
): string {
  const label = typeof body?.error === 'string' ? body.error.trim() : '';
  const detail = typeof body?.message === 'string' ? body.message.trim() : '';
  if (label && !GENERIC_ERROR_LABELS.has(label.toLowerCase())) return label;
  if (detail) return detail;
  if (label) return label;
  return `Companion request failed (${status})`;
}

type CompanionRequestOptions = {
  /** When false, never update the global usage badge from this response. */
  trackUsage?: boolean;
};

/**
 * The companion's queued replies use the same watcher as every other job: real
 * stages, backoff polling, and a budget that ends in `still_running` rather
 * than a lie about the message being lost.
 */
async function awaitCompanionJob<T>(config: AIClientConfig, jobId: string): Promise<T> {
  const jobs = createJobClient({
    getBaseUrl: config.getBaseUrl,
    getAuthHeaders: config.getAuthHeaders,
  });
  const outcome = await jobs.watchJob<T>(jobId);
  if (outcome.status === 'done') return outcome.result;
  if (outcome.status === 'failed') throw new Error(outcome.error.message);
  throw new JobStillRunningError(jobId, 'Still thinking. Your message is safe and on its way.');
}

function historyQuery(opts?: {
  conversationId?: string | null;
  noteContextId?: string | null;
}): string {
  const params = new URLSearchParams();
  if (opts?.conversationId?.trim()) {
    params.set('conversationId', opts.conversationId.trim());
  } else if (opts?.noteContextId?.trim()) {
    params.set('noteContextId', opts.noteContextId.trim());
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function createCompanionClient(config: AIClientConfig) {
  const companionRequest = async <T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE',
    body?: Record<string, unknown>,
    requestOptions?: CompanionRequestOptions
  ): Promise<T> => {
    const headers = await config.getAuthHeaders();
    const fetchOptions: RequestInit = { method, headers };

    if (method === 'POST' || method === 'DELETE') {
      fetchOptions.body = JSON.stringify(body || {});
    }

    const response = await fetch(
      `${config.getBaseUrl()}/api/v1/ai/companion${endpoint}`,
      fetchOptions
    );

    if (requestOptions?.trackUsage !== false) {
      parseGlobalAIUsageFromHeaders(response, config.onUsageUpdate);
    }

    const json = (await response.json().catch(() => ({}))) as {
      jobId?: string;
      error?: string;
      message?: string;
    };

    if (response.status === 202 && typeof json.jobId === 'string') {
      return awaitCompanionJob<T>(config, json.jobId);
    }

    if (!response.ok) {
      const failure = new Error(companionErrorText(json, response.status)) as Error & {
        status?: number;
      };
      failure.status = response.status;
      throw failure;
    }

    return json as T;
  };

  return {
    companionSendMessage: (message: string, context?: CompanionUserContext) =>
      // /message is the billable call — it must update the usage badge.
      // (trackUsage: false stays only on the read-only endpoints.)
      companionRequest<{
        reply: string;
        actions: CompanionAction[];
        provider: string;
        citations?: CompanionCitation | null;
        conversationId?: string;
      }>('/message', 'POST', { message, context }),

    /**
     * Upload one photo for the next companion turn and get back what the
     * server read out of it.
     *
     * This is NOT a chat turn — it is the image read, charged at the same OCR
     * price the note photo path charges (2 AI uses), which is why it updates
     * the usage badge: the credits are gone before the student types anything.
     */
    uploadCompanionImage: (params: {
      base64Data: string;
      fileName?: string;
      contentType?: string;
    }) =>
      companionRequest<CompanionImageAttachment>('/attachments', 'POST', {
        base64Data: params.base64Data,
        fileName: params.fileName || 'image.jpg',
        contentType: params.contentType,
      }),

    fetchCompanionConversations: () =>
      companionRequest<{ conversations: CompanionConversation[] }>(
        '/conversations',
        'GET',
        undefined,
        { trackUsage: false }
      ),

    createCompanionConversation: (noteContextId?: string | null) =>
      companionRequest<{ conversation: CompanionConversation }>(
        '/conversations',
        'POST',
        noteContextId?.trim() ? { noteContextId: noteContextId.trim() } : {},
        { trackUsage: false }
      ),

    fetchCompanionHistory: (opts?: {
      conversationId?: string | null;
      noteContextId?: string | null;
    } | string | null) => {
      // Back-compat: string arg = noteContextId
      const normalized =
        typeof opts === 'string' || opts === null || opts === undefined
          ? { noteContextId: opts ?? null }
          : opts;
      return companionRequest<{
        messages: Array<{
          id: string;
          role: 'user' | 'assistant';
          content: string;
          actions?: CompanionAction[];
          /**
           * Which excerpts of which note the answer was read out of. Reloaded
           * threads used to lose this — the column did not exist — so a rail
           * that had shown source chips came back as chip-less prose with
           * "(Excerpt 1)" left stranded inside the sentence.
           */
          citations?: unknown;
          feedback?: 'up' | 'down' | null;
          created_at: string;
        }>;
        conversationId: string | null;
        noteContextId: string | null;
      }>(`/history${historyQuery(normalized)}`, 'GET', undefined, { trackUsage: false });
    },

    clearCompanionHistory: (opts?: {
      conversationId?: string | null;
      noteContextId?: string | null;
    } | string | null) => {
      const normalized =
        typeof opts === 'string' || opts === null || opts === undefined
          ? { noteContextId: opts ?? null }
          : opts;
      return companionRequest<{
        success: boolean;
        conversationId: string | null;
        noteContextId: string | null;
      }>(`/history${historyQuery(normalized)}`, 'DELETE', undefined, { trackUsage: false });
    },

    companionSendMessageStream: async (
      message: string,
      context: CompanionUserContext | undefined,
      onToken: (token: string) => void,
      onDone: (result: {
        actions: CompanionAction[];
        citations?: CompanionCitation | null;
        messageId?: string;
        userMessageId?: string;
        conversationId?: string;
      }) => void,
      onError: (err: Error) => void
    ): Promise<void> => {
      // React Native cannot read a streamed body, so ask for the whole reply in
      // one piece and hand it to the same callbacks. Callers get a single
      // "token" instead of a trickle, which is the only difference they see.
      if (config.supportsResponseStreaming === false) {
        try {
          // Billable send: keep the usage badge in sync (this is the path ALL
          // mobile chat takes, since RN can't read streamed bodies).
          const result = await companionRequest<{
            reply: string;
            actions: CompanionAction[];
            citations?: CompanionCitation | null;
            messageId?: string;
            userMessageId?: string;
            conversationId?: string;
          }>('/message', 'POST', { message, context });
          if (result.reply) onToken(result.reply);
          onDone({
            actions: result.actions || [],
            // Normalised exactly like the SSE `done` frame. This is the path
            // every mobile send takes, and it was trusting the payload shape
            // the SSE path validates — a half-formed citation reached the
            // phone as a chip that pointed nowhere.
            citations: normalizeCompanionCitation(result.citations),
            messageId: result.messageId,
            userMessageId: result.userMessageId,
            conversationId: result.conversationId,
          });
        } catch (e: unknown) {
          onError(e instanceof Error ? e : new Error('Failed to reach Lantern.'));
        }
        return;
      }

      const headers = await config.getAuthHeaders();

      let response: Response;
      try {
        response = await fetch(`${config.getBaseUrl()}/api/v1/ai/companion/message/stream`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ message, context }),
        });
      } catch (e: unknown) {
        onError(new Error(e instanceof Error ? e.message : 'Network error'));
        return;
      }

      parseGlobalAIUsageFromHeaders(response, config.onUsageUpdate);

      if (!response.ok || !response.body) {
        // Surface the daily-limit message instead of a bare status code, and
        // let the badge learn the true count from the 429 body.
        if (response.status === 429) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            used?: number;
            limit?: number;
            resetsAt?: string;
            feature?: string;
          };
          if (
            !body.feature &&
            typeof body.used === 'number' &&
            typeof body.limit === 'number'
          ) {
            config.onUsageUpdate?.({
              used: body.used,
              limit: body.limit,
              remaining: Math.max(0, body.limit - body.used),
              resetsAt: body.resetsAt || '',
            });
          }
          onError(
            new Error(
              body.error ||
                "You've used today's AI requests. They reset at midnight UTC."
            )
          );
          return;
        }
        onError(new Error(`Stream request failed (${response.status})`));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            if (!part.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(part.slice(6));
              if (data.error) {
                onError(new Error(data.error));
                return;
              }
              if (data.token !== undefined) onToken(data.token as string);
              if (data.done) {
                onDone({
                  actions: (data.actions as CompanionAction[]) || [],
                  citations: normalizeCompanionCitation(data.citations),
                  messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
                  userMessageId:
                    typeof data.userMessageId === 'string' ? data.userMessageId : undefined,
                  conversationId:
                    typeof data.conversationId === 'string' ? data.conversationId : undefined,
                });
              }
            } catch {
              /* malformed chunk — skip */
            }
          }
        }
      } catch (e: unknown) {
        onError(new Error(e instanceof Error ? e.message : 'Stream read error'));
      }
    },

    submitCompanionFeedback: async (
      messageId: string,
      rating: 'up' | 'down' | null
    ): Promise<void> => {
      const persistedId =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!persistedId.test(messageId)) {
        throw new Error('Message is still saving; try feedback again in a moment');
      }
      const headers = await config.getAuthHeaders();
      const response = await fetch(`${config.getBaseUrl()}/api/v1/ai/companion/feedback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messageId, rating }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || 'Failed to save feedback');
      }
    },

    trackAIAnalyticsEvent: async (
      event: string,
      metadata?: Record<string, unknown>
    ): Promise<void> => {
      try {
        const headers = await config.getAuthHeaders();
        await fetch(`${config.getBaseUrl()}/api/v1/ai/companion/analytics`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ event, metadata }),
        });
      } catch {
        /* non-critical */
      }
    },

    summarizeGroupChat: (groupId: string, groupName?: string) =>
      companionRequest<{ summary: string; provider: string }>('/summarize-group', 'POST', {
        groupId,
        groupName,
      }),
  };
}

export type LanternCompanionClient = ReturnType<typeof createCompanionClient>;

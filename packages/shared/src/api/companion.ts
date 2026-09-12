// ===========================================
// Lantern Study - Shared AI Companion Client
// ===========================================

import type {
  CompanionAction,
  CompanionCitation,
  CompanionConversation,
  CompanionUserContext,
} from '../types';
import type { AIClientConfig } from './ai';
import { parseGlobalAIUsageFromHeaders } from './usageHeaders';
import { JobStillRunningError, createJobClient } from '../jobs/jobClient';

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
    };

    if (response.status === 202 && typeof json.jobId === 'string') {
      return awaitCompanionJob<T>(config, json.jobId);
    }

    if (!response.ok) {
      throw new Error(json.error || `Companion request failed (${response.status})`);
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

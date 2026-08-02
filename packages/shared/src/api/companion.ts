// ===========================================
// Lantern Study - Shared AI Companion Client
// ===========================================

import type {
  CompanionAction,
  CompanionConversation,
  CompanionUserContext,
} from '../types';
import type { AIClientConfig } from './ai';
import {
  consumeCompanionSseBuffer,
  readCompanionStreamError,
} from './companionSse';
import { parseGlobalAIUsageFromHeaders } from './usageHeaders';

type CompanionRequestOptions = {
  /** When false, never update the global usage badge from this response. */
  trackUsage?: boolean;
};

async function pollCompanionJob<T>(
  config: AIClientConfig,
  jobId: string,
  timeoutMs = 180_000
): Promise<T> {
  const doFetch = config.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const headers = await config.getAuthHeaders();
    const response = await doFetch(`${config.getBaseUrl()}/api/v1/jobs/${jobId}`, { headers });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { status?: string; result?: T; error?: string };
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || `Job status check failed (${response.status})`);
    }
    const job = payload.data ?? payload;
    const status = (job as { status?: string }).status;
    if (status === 'completed') {
      const result = (job as { result?: T }).result;
      if (result !== undefined) return result;
      throw new Error('Companion job completed without a result.');
    }
    if (status === 'failed') {
      const err = (job as { error?: string }).error;
      throw new Error(typeof err === 'string' && err ? err : 'Companion request failed.');
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Companion request timed out. Try again.');
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
  const doFetch = config.fetchImpl ?? fetch;

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

    const response = await doFetch(
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
      return pollCompanionJob<T>(config, json.jobId);
    }

    if (!response.ok) {
      throw new Error(json.error || `Companion request failed (${response.status})`);
    }

    return json as T;
  };

  return {
    companionSendMessage: (message: string, context?: CompanionUserContext) =>
      companionRequest<{
        reply: string;
        actions: CompanionAction[];
        provider: string;
        conversationId?: string;
      }>('/message', 'POST', { message, context }, { trackUsage: false }),

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
        messageId?: string;
        userMessageId?: string;
        conversationId?: string;
      }) => void,
      onError: (err: Error) => void
    ): Promise<void> => {
      const headers = await config.getAuthHeaders();
      const handlers = { onToken, onDone, onError };

      let response: Response;
      try {
        response = await doFetch(
          `${config.getBaseUrl()}/api/v1/ai/companion/message/stream`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ message, context }),
          }
        );
      } catch (e: unknown) {
        onError(new Error(e instanceof Error ? e.message : 'Network error'));
        return;
      }

      parseGlobalAIUsageFromHeaders(response, config.onUsageUpdate);

      if (!response.ok) {
        onError(await readCompanionStreamError(response));
        return;
      }

      const reader = response.body?.getReader?.();
      if (!reader) {
        // React Native's default fetch often omits response.body even on 200.
        // Fall back to reading the full buffered SSE payload.
        try {
          const text = await response.text();
          const { stopped } = consumeCompanionSseBuffer(
            text.endsWith('\n\n') ? text : `${text}\n\n`,
            handlers
          );
          if (!stopped) {
            onError(new Error('Stream ended without a complete response'));
          }
        } catch (e: unknown) {
          onError(new Error(e instanceof Error ? e.message : 'Stream read error'));
        }
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const consumed = consumeCompanionSseBuffer(buffer, handlers);
          buffer = consumed.rest;
          if (consumed.stopped) return;
        }
        if (buffer.trim()) {
          const consumed = consumeCompanionSseBuffer(
            buffer.endsWith('\n\n') ? buffer : `${buffer}\n\n`,
            handlers
          );
          if (consumed.stopped) return;
        }
        onError(new Error('Stream ended without a complete response'));
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
      const response = await doFetch(`${config.getBaseUrl()}/api/v1/ai/companion/feedback`, {
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
        await doFetch(`${config.getBaseUrl()}/api/v1/ai/companion/analytics`, {
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

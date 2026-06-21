// ===========================================
// Lantern Study - Shared AI Companion Client
// ===========================================

import type { AIUsageInfo, CompanionAction, CompanionUserContext } from '../types';
import type { AIClientConfig } from './ai';

function parseUsageFromHeaders(
  response: Response,
  onUsageUpdate?: (usage: AIUsageInfo) => void
): void {
  const usedHeader = response.headers.get('X-AI-Usage-Used');
  const limitHeader = response.headers.get('X-AI-Usage-Limit');
  const resetsHeader = response.headers.get('X-AI-Usage-Resets-At');
  if (usedHeader && limitHeader) {
    const used = parseInt(usedHeader, 10);
    const limit = parseInt(limitHeader, 10);
    onUsageUpdate?.({
      used,
      limit,
      remaining: limit - used,
      resetsAt: resetsHeader || '',
    });
  }
}

export function createCompanionClient(config: AIClientConfig) {
  const companionRequest = async <T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE',
    body?: Record<string, unknown>
  ): Promise<T> => {
    const headers = await config.getAuthHeaders();
    const options: RequestInit = { method, headers };

    if (method === 'POST' || method === 'DELETE') {
      options.body = JSON.stringify(body || {});
    }

    const response = await fetch(
      `${config.getBaseUrl()}/api/v1/ai/companion${endpoint}`,
      options
    );

    parseUsageFromHeaders(response, config.onUsageUpdate);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `Companion request failed (${response.status})`);
    }

    return response.json() as Promise<T>;
  };

  return {
    companionSendMessage: (message: string, context?: CompanionUserContext) =>
      companionRequest<{ reply: string; actions: CompanionAction[]; provider: string }>(
        '/message',
        'POST',
        { message, context }
      ),

    fetchCompanionHistory: () =>
      companionRequest<{
        messages: Array<{
          id: string;
          role: 'user' | 'assistant';
          content: string;
          actions?: CompanionAction[];
          created_at: string;
        }>;
      }>('/history', 'GET'),

    clearCompanionHistory: () =>
      companionRequest<{ success: boolean }>('/history', 'DELETE'),

    companionSendMessageStream: async (
      message: string,
      context: CompanionUserContext | undefined,
      onToken: (token: string) => void,
      onDone: (actions: CompanionAction[]) => void,
      onError: (err: Error) => void
    ): Promise<void> => {
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

      parseUsageFromHeaders(response, config.onUsageUpdate);

      if (!response.ok || !response.body) {
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
              if (data.done) onDone((data.actions as CompanionAction[]) || []);
            } catch {
              /* malformed chunk — skip */
            }
          }
        }
      } catch (e: unknown) {
        onError(new Error(e instanceof Error ? e.message : 'Stream read error'));
      }
    },

    submitCompanionFeedback: async (messageId: string, rating: 'up' | 'down'): Promise<void> => {
      try {
        const headers = await config.getAuthHeaders();
        await fetch(`${config.getBaseUrl()}/api/v1/ai/companion/feedback`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ messageId, rating }),
        });
      } catch {
        /* non-critical */
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

    summarizeGroupChat: (messages: string[], groupName: string) =>
      companionRequest<{ summary: string; provider: string }>('/summarize-group', 'POST', {
        messages,
        groupName,
      }),
  };
}

export type LanternCompanionClient = ReturnType<typeof createCompanionClient>;

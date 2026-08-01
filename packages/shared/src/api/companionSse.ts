// ===========================================
// Lantern Study - Companion SSE helpers
// ===========================================

import type { CompanionAction } from '../types';

export type CompanionStreamDone = {
  actions: CompanionAction[];
  messageId?: string;
  userMessageId?: string;
  conversationId?: string;
};

export type CompanionSseHandlers = {
  onToken: (token: string) => void;
  onDone: (result: CompanionStreamDone) => void;
  onError: (err: Error) => void;
};

/** Parse one or more SSE `data:` frames from a buffer fragment. */
export function consumeCompanionSseBuffer(
  buffer: string,
  handlers: CompanionSseHandlers
): { rest: string; stopped: boolean } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    const line = part
      .split('\n')
      .map((l) => l.trimEnd())
      .find((l) => l.startsWith('data: '));
    if (!line) continue;
    try {
      const data = JSON.parse(line.slice(6)) as {
        error?: string;
        token?: string;
        done?: boolean;
        actions?: CompanionAction[];
        messageId?: string;
        userMessageId?: string;
        conversationId?: string;
      };
      if (data.error) {
        handlers.onError(new Error(data.error));
        return { rest: '', stopped: true };
      }
      if (data.token !== undefined) handlers.onToken(data.token);
      if (data.done) {
        handlers.onDone({
          actions: data.actions || [],
          messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
          userMessageId:
            typeof data.userMessageId === 'string' ? data.userMessageId : undefined,
          conversationId:
            typeof data.conversationId === 'string' ? data.conversationId : undefined,
        });
        return { rest: '', stopped: true };
      }
    } catch {
      /* malformed chunk — skip */
    }
  }
  return { rest, stopped: false };
}

/** Extract a useful error message from a failed stream HTTP response body. */
export async function readCompanionStreamError(
  response: Response,
  fallbackStatusLabel = 'Stream request failed'
): Promise<Error> {
  const raw = await response.text().catch(() => '');
  const trimmed = raw.trim();
  if (trimmed) {
    try {
      const json = JSON.parse(trimmed) as { error?: string; message?: string };
      if (typeof json.error === 'string' && json.error.trim()) {
        return new Error(json.error.trim());
      }
      if (typeof json.message === 'string' && json.message.trim()) {
        return new Error(json.message.trim());
      }
    } catch {
      // Non-JSON body — surface a short plain-text snippet when useful.
      if (trimmed.length <= 200 && !trimmed.startsWith('<')) {
        return new Error(trimmed);
      }
    }
  }
  return new Error(`${fallbackStatusLabel} (${response.status})`);
}

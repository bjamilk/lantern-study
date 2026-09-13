export type ChatDraftScope = 'group' | 'dm';

export function chatDraftStorageKey(scope: ChatDraftScope, chatId: string): string {
  return `lantern_chat_draft:${scope}:${chatId}`;
}

export function normalizeChatDraft(text: string | null | undefined): string {
  return (text || '').replace(/\s+$/u, '');
}

export function chatDraftIsEmpty(text: string | null | undefined): boolean {
  return !normalizeChatDraft(text).trim();
}

import React, { useMemo, useState } from 'react';
import type { CompanionConversation } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { confirmDialog } from '../../stores/confirmStore';
import { filterConversations } from './companionScope';

interface CompanionHistoryProps {
  conversations: CompanionConversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  onSelect: (conversation: CompanionConversation) => void;
  onDelete: (conversationId: string) => void;
  onNewChat: () => void;
  onBack: () => void;
  formatRelativeTime: (iso: string) => string;
}

/**
 * Past chats, as a list you can actually search and prune.
 *
 * Two things this replaces. The list had no search, so a student with fifty
 * threads could only scroll for the one they wanted; and delete was a two-tap
 * "arm the trash" affordance that depends on hover to even be visible and on a
 * blur that Safari never fires (it does not focus buttons on click), so an
 * armed trash could sit red indefinitely. Delete now goes through the app's own
 * confirm dialog — the same gate every other destructive action in the app
 * uses, and the one the phone's twin uses.
 */
export function CompanionHistory({
  conversations,
  activeConversationId,
  isLoading,
  onSelect,
  onDelete,
  onNewChat,
  onBack,
  formatRelativeTime,
}: CompanionHistoryProps) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => filterConversations(conversations, query), [conversations, query]);

  const confirmDelete = async (conversation: CompanionConversation) => {
    const ok = await confirmDialog({
      title: 'Delete this chat?',
      message: `“${conversation.title}” and its messages will be removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) onDelete(conversation.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 dark:bg-lantern-surface-secondary">
          <AppIcon name="search" size={14} className="flex-shrink-0 text-lantern-text-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            aria-label="Search past chats"
            className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-lantern-text-tertiary"
          />
        </label>
        <button
          type="button"
          onClick={onNewChat}
          className="flex-shrink-0 rounded-lg px-2 py-2 text-body font-medium text-lantern-feature-ai-ink hover:underline"
        >
          New
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {isLoading && conversations.length === 0 ? (
          <p className="py-8 text-center text-caption text-lantern-text-secondary">Loading chats…</p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-caption text-lantern-text-secondary">
            {query.trim()
              ? `No chats match “${query.trim()}”.`
              : 'No past chats yet. Start a conversation and it will show up here.'}
          </p>
        ) : (
          rows.map((conversation) => {
            const isActive = conversation.id === activeConversationId;
            return (
              <div key={conversation.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(conversation)}
                  className={`w-full rounded-xl border px-3 py-2.5 pr-10 text-left transition-colors ${
                    isActive
                      ? 'border-lantern-feature-ai-ink/30 bg-lantern-feature-ai-tint'
                      : 'border-transparent hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-body font-medium text-lantern-text">
                      {conversation.title}
                    </p>
                    <span className="flex-shrink-0 text-caption text-lantern-text-tertiary">
                      {formatRelativeTime(conversation.updatedAt)}
                    </span>
                  </div>
                  {conversation.noteTitle && (
                    <p className="mt-0.5 flex items-center gap-1 truncate text-caption text-lantern-feature-ai-ink">
                      <AppIcon name="document-text" size={12} className="flex-shrink-0" />
                      {conversation.noteTitle}
                    </p>
                  )}
                  {conversation.preview && (
                    <p className="mt-0.5 line-clamp-2 text-caption text-lantern-text-secondary">
                      {conversation.preview}
                    </p>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Delete “${conversation.title}”`}
                  title="Delete chat"
                  onClick={() => void confirmDelete(conversation)}
                  className="absolute bottom-2 right-2 rounded-lg p-1.5 text-lantern-text-tertiary opacity-0 transition-opacity hover:text-lantern-error focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <AppIcon name="trash" size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="flex-shrink-0 py-2 text-body text-lantern-text-secondary hover:underline"
      >
        Back to chat
      </button>
    </div>
  );
}

export default CompanionHistory;

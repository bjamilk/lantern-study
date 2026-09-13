import React, { useMemo, useState } from 'react';
import { isCommunityBoard } from '@lantern/shared/network';
import type { DMThread, Group, User } from '../../types';
import { sendDirectMessage, sendMessage } from '../../services/supabase';
import { useToastStore } from '../../stores/toastStore';
import Modal from '../ui/Modal';
import { AppIcon } from '../ui/AppIcon';

interface ForwardChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  messageText: string;
  currentUser: User;
  groups: Group[];
  dmThreads: DMThread[];
}

export function ForwardChatModal({
  isOpen,
  onClose,
  messageText,
  currentUser,
  groups,
  dmThreads,
}: ForwardChatModalProps) {
  const [query, setQuery] = useState('');
  const [sendingKey, setSendingKey] = useState<string | null>(null);

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: Array<{ key: string; kind: 'group' | 'dm'; id: string; name: string; otherUserId?: string }> = [];
    for (const group of groups) {
      if (group.isArchived || isCommunityBoard(group)) continue;
      rows.push({ key: `g:${group.id}`, kind: 'group', id: group.id, name: group.name });
    }
    for (const thread of dmThreads) {
      if (thread.isArchived || thread.status === 'declined') continue;
      const otherUserId = (thread.participantIds || []).find((id) => id !== currentUser.id);
      if (!otherUserId) continue;
      const other = thread.participants?.[otherUserId];
      rows.push({
        key: `d:${thread.id}`,
        kind: 'dm',
        id: thread.id,
        name: other?.name || other?.username || 'Direct chat',
        otherUserId,
      });
    }
    return q ? rows.filter((row) => row.name.toLowerCase().includes(q)) : rows;
  }, [groups, dmThreads, currentUser.id, query]);

  const handlePick = async (target: (typeof targets)[number]) => {
    const text = messageText.trim();
    if (!text || sendingKey) return;
    setSendingKey(target.key);
    try {
      if (target.kind === 'group') {
        await sendMessage(target.id, currentUser.id, text);
      } else if (target.otherUserId) {
        await sendDirectMessage(currentUser.id, target.otherUserId, text);
      }
      useToastStore.getState().showToast(`Forwarded to ${target.name}`, 'success');
      onClose();
    } catch (err) {
      useToastStore.getState().showToast(
        err instanceof Error ? err.message : 'Could not forward that message',
        'error',
      );
    } finally {
      setSendingKey(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="forward-chat-title"
      maxWidthClass="max-w-md"
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 id="forward-chat-title" className="text-heading text-lantern-text">
            Forward message
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] rounded-lg text-lantern-text-tertiary hover:text-lantern-text"
            aria-label="Close"
          >
            <AppIcon name="close" size={18} />
          </button>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats to forward to"
          className="w-full mb-3 rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-body"
        />
        <ul className="max-h-72 overflow-y-auto divide-y divide-lantern-border">
          {targets.map((target) => (
            <li key={target.key}>
              <button
                type="button"
                disabled={!!sendingKey}
                onClick={() => void handlePick(target)}
                className="w-full text-left px-2 py-2.5 text-body text-lantern-text hover:bg-lantern-background-secondary rounded-md disabled:opacity-50"
              >
                {sendingKey === target.key ? 'Sending…' : target.name}
              </button>
            </li>
          ))}
          {targets.length === 0 && (
            <li className="px-2 py-4 text-body text-lantern-text-secondary">No chats to forward to.</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}

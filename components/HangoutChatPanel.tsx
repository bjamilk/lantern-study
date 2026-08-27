import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMessages, sendMessage } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

export interface HangoutChatPanelProps {
  groupId: string;
  title?: string;
  onOpenInChats?: () => void;
}

type HangoutRow = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
};

function asRow(raw: unknown): HangoutRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = typeof m.id === 'string' ? m.id : null;
  if (!id) return null;
  const sender = m.sender && typeof m.sender === 'object' ? (m.sender as Record<string, unknown>) : null;
  const senderId = String(m.senderId || m.sender_id || sender?.id || '');
  const senderName = String(sender?.name || m.senderName || 'Student');
  const text = String(m.text || m.content || '').trim();
  const timestamp = String(m.timestamp || m.created_at || m.createdAt || '');
  return { id, senderId, senderName, text, timestamp };
}

/**
 * Thin in-place thread for community lounges and study rooms.
 * Reuses GET/POST /messages/group/:id — not ChatWindow.
 */
export const HangoutChatPanel: React.FC<HangoutChatPanelProps> = ({
  groupId,
  title = 'Hangout',
  onOpenInChats,
}) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [rows, setRows] = useState<HangoutRow[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchMessages(groupId, undefined, 50);
      const next = (Array.isArray(list) ? list : []).map(asRow).filter((row): row is HangoutRow => !!row);
      setRows(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the hangout');
    }
  }, [groupId]);

  useEffect(() => {
    void load();
    const tick = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(tick);
  }, [load]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content || !currentUser?.id || sending) return;
    setSending(true);
    try {
      await sendMessage(groupId, currentUser.id, content);
      setDraft('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      aria-label={title}
      className="rounded-xl border border-lantern-border bg-lantern-surface overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 border-b border-lantern-border/70 px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
          {title}
        </h2>
        {onOpenInChats ? (
          <button
            type="button"
            onClick={onOpenInChats}
            className="text-xs font-medium text-lantern-primary hover:underline"
          >
            Open in Chats
          </button>
        ) : null}
      </div>
      <div ref={scrollerRef} className="max-h-72 min-h-[10rem] overflow-y-auto px-3 py-2 space-y-2">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-lantern-text-secondary">
            Say something — this is the hangout.
          </p>
        ) : (
          rows.map((row) => {
            const own = !!currentUser?.id && row.senderId === currentUser.id;
            return (
              <div key={row.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${
                    own
                      ? 'bg-lantern-primary text-white'
                      : 'bg-lantern-background-secondary text-lantern-text'
                  }`}
                >
                  {!own ? (
                    <p className="text-[10px] font-medium opacity-80 mb-0.5">{row.senderName}</p>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words">{row.text || ' '}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
      {error ? (
        <p className="px-3 pb-1 text-xs text-lantern-error" role="alert">
          {error}
        </p>
      ) : null}
      <form
        className="flex gap-2 border-t border-lantern-border/70 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor={`hangout-${groupId}`}>
          Message
        </label>
        <textarea
          id={`hangout-${groupId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Write a message…"
          className="min-h-[40px] flex-1 resize-none rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm text-lantern-text"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-lg bg-lantern-primary px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </section>
  );
};

export default HangoutChatPanel;

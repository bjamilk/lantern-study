import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type BroadcastPayload = Record<string, unknown> | undefined;
type BroadcastHandler = (payload: BroadcastPayload) => void;

interface BroadcastEntry {
  channel: RealtimeChannel;
  refs: number;
  handlers: Map<string, Set<BroadcastHandler>>;
  boundEvents: Set<string>;
  subscribed: boolean;
  teardown: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, BroadcastEntry>();

/**
 * Refcounted access to ONE Supabase broadcast channel per topic.
 *
 * supabase-js dedupes `channel(topic)` by topic and `removeChannel` tears the
 * shared instance down for everyone, so two components subscribing to the
 * same topic used to end up with one channel that the first unmount killed —
 * the survivor kept a reference to a closed channel and silently stopped
 * receiving. That is reachable now that the same group can be open on the
 * Chat stack and inside a community at the same time (`typing:{id}`,
 * `chat-read:{id}`). Here the channel is created once, every subscriber's
 * handler is fanned out from a single binding, and only the last release
 * removes it.
 */
export function acquireBroadcastChannel(
  topic: string,
  event: string,
  handler: BroadcastHandler
): { channel: RealtimeChannel; release: () => void } {
  let entry = entries.get(topic);
  if (entry?.teardown) {
    clearTimeout(entry.teardown);
    entry.teardown = null;
  }
  if (!entry) {
    entry = {
      channel: supabase.channel(topic),
      refs: 0,
      handlers: new Map(),
      boundEvents: new Set(),
      subscribed: false,
      teardown: null,
    };
    entries.set(topic, entry);
  }

  const held = entry;
  held.refs += 1;

  let handlers = held.handlers.get(event);
  if (!handlers) {
    handlers = new Set();
    held.handlers.set(event, handlers);
  }
  handlers.add(handler);

  if (!held.boundEvents.has(event)) {
    held.boundEvents.add(event);
    // Broadcast bindings are client-side filters, so adding one to an
    // already-joined channel is safe (unlike a presence binding, which forces
    // a resubscribe).
    held.channel.on('broadcast', { event }, ({ payload }) => {
      held.handlers.get(event)?.forEach((notify) => notify(payload as BroadcastPayload));
    });
  }

  if (!held.subscribed) {
    held.subscribed = true;
    held.channel.subscribe();
  }

  let released = false;
  return {
    channel: held.channel,
    release: () => {
      if (released) return;
      released = true;
      handlers.delete(handler);
      held.refs -= 1;
      if (held.refs > 0) return;
      // Deferred so a screen handing over to another screen on the same topic
      // in the same commit does not churn the channel.
      held.teardown = setTimeout(() => {
        held.teardown = null;
        if (held.refs > 0) return;
        if (entries.get(topic) === held) entries.delete(topic);
        void supabase.removeChannel(held.channel);
      }, 0);
    },
  };
}

export default acquireBroadcastChannel;

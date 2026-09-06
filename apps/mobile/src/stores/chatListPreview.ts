// ===========================================
// Lantern Study Mobile - chat list previews
// ===========================================
//
// The Chat list preview comes from two places that disagree: the group-list
// endpoint's `last_message` (which can lag behind the thread it summarises) and
// the locally cached messages for that group. Showing the server copy blindly
// previewed a 38-day-old message for a group whose newest message had already
// been persisted; opening the thread "fixed" it. The list must show whichever
// of the two is actually newer.

export interface PreviewTimestamped {
  createdAt: string;
}

export interface DeliverableMessage {
  isRemoved?: boolean;
  removedAt?: string | null;
  deliveryState?: 'pending' | 'failed';
}

/** Newest row that is neither removed nor stuck in the outbox. */
export function lastDeliveredMessage<T extends DeliverableMessage>(list: T[]): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]!;
    if (m.isRemoved || m.removedAt) continue;
    if (m.deliveryState === 'failed' || m.deliveryState === 'pending') continue;
    return m;
  }
  return undefined;
}

function timeOf(value: string | undefined): number {
  if (!value) return NaN;
  return new Date(value).getTime();
}

/**
 * The preview to render for a group: the newer of the server's summary and the
 * newest delivered message we already hold for that group. Unparseable or
 * missing timestamps never win — a preview with no usable time is only used
 * when the other side has nothing at all. Ties go to the server copy, which is
 * the authoritative text.
 */
export function resolveGroupPreview<S extends PreviewTimestamped, C extends PreviewTimestamped>(
  serverPreview: S | undefined,
  cachedPreview: C | undefined
): S | C | undefined {
  if (!serverPreview) return cachedPreview;
  if (!cachedPreview) return serverPreview;
  const serverTime = timeOf(serverPreview.createdAt);
  const cachedTime = timeOf(cachedPreview.createdAt);
  if (Number.isNaN(cachedTime)) return serverPreview;
  if (Number.isNaN(serverTime)) return cachedPreview;
  return cachedTime > serverTime ? cachedPreview : serverPreview;
}

/**
 * Preview for a group given its server copy and the group's cached messages:
 * a queued row is skipped (it is not delivered yet), so the list never claims
 * a message the recipient cannot see.
 */
export function previewFromServerAndCache<
  S extends PreviewTimestamped,
  C extends PreviewTimestamped & DeliverableMessage,
>(serverPreview: S | undefined, cached: C[] | undefined): S | C | undefined {
  return resolveGroupPreview(serverPreview, lastDeliveredMessage(cached || []));
}

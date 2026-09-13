export type InquiryChatRecord = {
  id?: string | null;
  dm_thread_id?: string | null;
  dmThreadId?: string | null;
  buyer_id?: string | null;
  buyerId?: string | null;
  seller_id?: string | null;
  sellerId?: string | null;
  listing?: { user_id?: string | null; userId?: string | null; title?: string | null } | null;
};

export function inquiryThreadId(record: InquiryChatRecord | null | undefined): string | undefined {
  const id = record?.dm_thread_id || record?.dmThreadId;
  return typeof id === 'string' && id ? id : undefined;
}

export function inquiryBuyerId(record: InquiryChatRecord | null | undefined): string | undefined {
  const id = record?.buyer_id || record?.buyerId;
  return typeof id === 'string' && id ? id : undefined;
}

export function inquirySellerId(record: InquiryChatRecord | null | undefined): string | undefined {
  const id = record?.seller_id || record?.sellerId || record?.listing?.user_id || record?.listing?.userId;
  return typeof id === 'string' && id ? id : undefined;
}

export function resolveInquiryDmTarget(input: {
  viewerId?: string | null;
  inquiryId?: string | null;
  threadId?: string | null;
  buyerId?: string | null;
  sellerId?: string | null;
}): { inquiryId?: string; threadId?: string; otherUserId?: string } {
  const inquiryId = input.inquiryId || undefined;
  const threadId = input.threadId || undefined;
  const viewerId = input.viewerId || undefined;
  let otherUserId: string | undefined;
  if (viewerId && input.buyerId && input.sellerId) {
    otherUserId = viewerId === input.buyerId ? input.sellerId : input.buyerId;
  }
  return { inquiryId, threadId, otherUserId };
}

export function findInquiryRecord<T extends InquiryChatRecord>(
  rows: T[] | null | undefined,
  match: { inquiryId?: string | null; threadId?: string | null },
): T | undefined {
  if (!rows?.length) return undefined;
  if (match.threadId) {
    const byThread = rows.find((row) => inquiryThreadId(row) === match.threadId);
    if (byThread) return byThread;
  }
  if (match.inquiryId) {
    return rows.find((row) => row.id === match.inquiryId);
  }
  return undefined;
}

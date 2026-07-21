import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_KEY_LENGTH = 128;
const PROCESSING_STATUS = '__processing__';
const POLL_INTERVAL_MS = 100;
const POLL_MAX_ATTEMPTS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessingResponse(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { _status?: string })._status === PROCESSING_STATUS
  );
}

export function normalizeIdempotencyKey(
  headerValue: string | string[] | undefined,
  fallback?: string
): string | null {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const key = (raw || fallback || '').trim();
  if (!key || key.length > MAX_KEY_LENGTH) return null;
  return key;
}

export async function getIdempotentResponse<T>(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string
): Promise<T | null> {
  const { data, error } = await client
    .from('api_idempotency_keys')
    .select('response')
    .eq('user_id', userId)
    .eq('operation', operation)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  if (!data?.response || isProcessingResponse(data.response)) return null;
  return data.response as T;
}

async function waitForCompletedResponse<T>(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string
): Promise<T | null> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const cached = await getIdempotentResponse<T>(client, userId, operation, idempotencyKey);
    if (cached) return cached;
  }
  return null;
}

async function claimIdempotencySlot(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string
): Promise<'claimed' | 'cached' | 'wait'> {
  // Advisory lock when available; unique index still owns cross-request safety.
  try {
    await client.rpc('claim_idempotency_lock', {
      p_user_id: userId,
      p_operation: operation,
      p_idempotency_key: idempotencyKey,
    });
  } catch {
    // Best-effort; insert conflict handling below remains authoritative.
  }

  const { error } = await client.from('api_idempotency_keys').insert({
    user_id: userId,
    operation,
    idempotency_key: idempotencyKey,
    response: { _status: PROCESSING_STATUS },
  });

  if (!error) return 'claimed';

  if (error.code === '23505') {
    const { data, error: readError } = await client
      .from('api_idempotency_keys')
      .select('response')
      .eq('user_id', userId)
      .eq('operation', operation)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (readError) throw readError;
    if (data?.response && !isProcessingResponse(data.response)) {
      return 'cached';
    }
    return 'wait';
  }

  throw error;
}

async function storeIdempotentResponse(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string,
  response: unknown
): Promise<void> {
  const { error } = await client
    .from('api_idempotency_keys')
    .update({ response })
    .eq('user_id', userId)
    .eq('operation', operation)
    .eq('idempotency_key', idempotencyKey);

  if (error) throw error;
}

async function releaseIdempotencySlot(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string
): Promise<void> {
  await client
    .from('api_idempotency_keys')
    .delete()
    .eq('user_id', userId)
    .eq('operation', operation)
    .eq('idempotency_key', idempotencyKey);
}

export async function withIdempotency<T extends Record<string, unknown>>(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string | null,
  handler: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey) {
    return handler();
  }

  const claim = await claimIdempotencySlot(client, userId, operation, idempotencyKey);
  if (claim === 'cached') {
    const cached = await getIdempotentResponse<T>(client, userId, operation, idempotencyKey);
    if (cached) return cached;
  }
  if (claim === 'wait') {
    const waited = await waitForCompletedResponse<T>(client, userId, operation, idempotencyKey);
    if (waited) return waited;
    throw new Error('Concurrent idempotent request timed out');
  }

  try {
    const result = await handler();
    await storeIdempotentResponse(client, userId, operation, idempotencyKey, result);
    return result;
  } catch (error) {
    await releaseIdempotencySlot(client, userId, operation, idempotencyKey);
    throw error;
  }
}

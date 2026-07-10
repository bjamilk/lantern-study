import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_KEY_LENGTH = 128;

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
  return data?.response ? (data.response as T) : null;
}

export async function storeIdempotentResponse(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string,
  response: unknown
): Promise<void> {
  const { error } = await client.from('api_idempotency_keys').insert({
    user_id: userId,
    operation,
    idempotency_key: idempotencyKey,
    response,
  });

  if (error) {
    if (error.code === '23505') return;
    throw error;
  }
}

export async function withIdempotency<T extends Record<string, unknown>>(
  client: SupabaseClient,
  userId: string,
  operation: string,
  idempotencyKey: string | null,
  handler: () => Promise<T>
): Promise<T> {
  if (idempotencyKey) {
    const cached = await getIdempotentResponse<T>(client, userId, operation, idempotencyKey);
    if (cached) return cached;
  }

  const result = await handler();

  if (idempotencyKey) {
    await storeIdempotentResponse(client, userId, operation, idempotencyKey, result);
  }

  return result;
}

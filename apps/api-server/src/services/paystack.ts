/**
 * Thin, stateless client for the Paystack REST API, plus the key-mode guards
 * that decide whether this server may transact at all.
 *
 * Exports — consumed almost entirely by `services/marketplacePayments.ts`, with
 * `isPaystackConfigured` also read by route guards and
 * `listPaystackBanks` / `resolvePaystackAccount` by the seller payout-profile
 * routes in `routes/marketplace.ts`:
 * - charge: `initializePaystackTransaction`, `verifyPaystackTransaction`
 * - payout: `createPaystackTransferRecipient`, `initiatePaystackTransfer`,
 *   `resolvePaystackAccount`, `listPaystackBanks`
 * - refund: `refundPaystackTransaction`
 * - reconciliation READS (#113, they move nothing):
 *   `fetchPaystackTransferByReference`, `listPaystackRefundsForTransaction`,
 *   plus `PaystackApiError` / `isPaystackNotFound` so a caller can tell "no
 *   such transfer" from "Paystack is unreachable"
 * - webhook: `verifyPaystackSignature`
 * - config: `isPaystackConfigured`, `getPaystackPublicKey`, `paystackMode`,
 *   `assertPaystackLiveKeyInProduction`, `createPaystackReference`
 *
 * What it touches: `https://api.paystack.co` over HTTPS, and the env vars
 * `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `NODE_ENV`. No database, no
 * cache, no module state.
 *
 * Key-mode safety. `isPaystackConfigured()` only asserts the secret is
 * non-empty, so it alone cannot tell a test key from a live one. Two guards
 * cover that gap: `assertPaystackLiveKeyInProduction()` — called from
 * `secretKey()`, so it fires on every outbound call and every signature check —
 * throws when a production server holds anything but an `sk_live_` key, and
 * `paystackMode()` is stamped onto each `marketplace_payments` row at
 * initialize so settlement refuses a row whose mode differs from the running
 * server's. Together they stop a test key with checkout enabled from settling
 * test charges as real ones.
 *
 * Gotchas
 * - `verifyPaystackSignature` must receive the RAW request body. Any JSON
 *   parsing upstream changes the bytes and every signature fails.
 * - Paystack returns HTTP 200 with `status: false` for application-level
 *   errors, so `paystackFetch` checks both.
 * - Amounts are integer kobo end to end; `initializePaystackTransaction`
 *   rejects a non-integer or anything under 100 kobo.
 * - A transfer `reference` is Paystack's own idempotency key: reusing one for
 *   the same recipient is rejected, which the payout path relies on.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { logger } from '../utils/logger';

const PAYSTACK_BASE = 'https://api.paystack.co';

export type PaystackInitializeResult = {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
};

export type PaystackVerifyResult = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  id: number | string;
  paidAt?: string | null;
  metadata?: Record<string, unknown>;
  gatewayResponse?: string;
};

export type PaystackRecipientResult = {
  recipientCode: string;
  accountName: string;
  bankCode: string;
  accountNumberLast4: string;
};

/**
 * 'live' | 'test' for the configured secret key. Stamped on every payment row
 * so a row initialised against one key can never be settled against the other
 * (a test-key settlement of a live charge would hand out goods for free, and a
 * live-key settlement of a test charge would pay a seller real money).
 */
export function paystackMode(): 'live' | 'test' {
  return process.env.PAYSTACK_SECRET_KEY?.trim().startsWith('sk_live_') ? 'live' : 'test';
}

function isProductionRuntime(): boolean {
  return (process.env.NODE_ENV || '').trim() === 'production';
}

/**
 * In production a test secret key is a hard error, not a degraded mode: buyers
 * would see a working checkout that never moves real money. Throwing here
 * refuses every Paystack call rather than silently transacting in test mode.
 */
export function assertPaystackLiveKeyInProduction(): void {
  if (!isProductionRuntime()) return;
  const key = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!key) return; // unconfigured is handled by isPaystackConfigured()/secretKey()
  if (!key.startsWith('sk_live_')) {
    throw new Error(
      'PAYSTACK_SECRET_KEY must be a live key (sk_live_...) in production; refusing to run in test mode'
    );
  }
}

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured');
  assertPaystackLiveKeyInProduction();
  return key;
}

export function getPaystackPublicKey(): string {
  return process.env.PAYSTACK_PUBLIC_KEY?.trim() || '';
}

export function isPaystackConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
}

export function createPaystackReference(prefix = 'ls_mkt'): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(8).toString('hex')}`;
}

/** Paystack signs the raw body with HMAC SHA512 using the secret key. */
export function verifyPaystackSignature(rawBody: string | Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const hash = createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  // Constant-time compare: a === on hex strings leaks match length through
  // timing. Buffer lengths must match first or timingSafeEqual throws.
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Transport ---------------------------------------------------------------
// Every call below funnels through paystackFetch, so every call also runs the
// production live-key assertion inside secretKey(). Errors are surfaced as the
// message Paystack returned; callers on the money path log and re-throw rather
// than continuing.

async function paystackFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers,
    body,
  });
  const payload = (await res.json().catch(() => ({}))) as {
    status?: boolean;
    message?: string;
    data?: T;
  };
  if (!res.ok || payload.status === false) {
    const msg = payload.message || `Paystack request failed (${res.status})`;
    logger.warn('Paystack API error', { path, status: res.status, message: msg });
    throw new PaystackApiError(msg, res.status);
  }
  return payload.data as T;
}

/**
 * What `paystackFetch` throws. It is still an `Error` carrying exactly the
 * message it always did — every existing caller is unchanged — plus the HTTP
 * status, which the read-only reconciliation reads (#113): a 404 on a transfer
 * lookup is the FACT "Paystack has no such transfer", while a 500 or a network
 * failure is "we do not know", and the two must never be confused.
 */
export class PaystackApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PaystackApiError';
    this.status = status;
  }
}

/** Was this failure Paystack saying "no such object", rather than a blip? */
export function isPaystackNotFound(err: unknown): boolean {
  return err instanceof PaystackApiError && err.status === 404;
}

export type PaystackTransferResult = {
  status: string;
  reference: string;
  transferCode: string | null;
  amountKobo: number | null;
};

/**
 * READ-ONLY (#113). Ask Paystack what became of one transfer, by the
 * deterministic reference the payout path wrote BEFORE it moved any money.
 *
 * This is the reconciliation job's source of truth for "did the seller's money
 * actually leave?" — never our own row. It moves nothing: there is no transfer
 * initiation here and there must never be one.
 *
 * A reference Paystack has never seen answers 404, which `paystackFetch` raises
 * as a `PaystackApiError` the caller tells apart with `isPaystackNotFound`.
 */
export async function fetchPaystackTransferByReference(
  reference: string
): Promise<PaystackTransferResult> {
  const data = await paystackFetch<{
    status: string;
    reference: string;
    transfer_code?: string | null;
    amount?: number | null;
  }>(`/transfer/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
  return {
    status: data.status,
    reference: data.reference,
    transferCode: data.transfer_code ?? null,
    amountKobo: typeof data.amount === 'number' ? data.amount : null,
  };
}

export type PaystackRefundRecord = {
  id: string;
  status: string;
  amountKobo: number | null;
};

/**
 * READ-ONLY (#113). Every refund Paystack holds against one transaction,
 * newest first as Paystack returns them.
 *
 * An empty array is a real answer — "no refund was ever accepted for this
 * charge" — and is what lets the job release a refund claim that is backing
 * nothing. It initiates no refund.
 */
export async function listPaystackRefundsForTransaction(
  transactionIdOrReference: string | number
): Promise<PaystackRefundRecord[]> {
  const qs = new URLSearchParams({ transaction: String(transactionIdOrReference) });
  const data = await paystackFetch<
    Array<{ id: number | string; status: string; amount?: number | null }>
  >(`/refund?${qs.toString()}`, { method: 'GET' });
  return (data || []).map((row) => ({
    id: String(row.id),
    status: String(row.status),
    amountKobo: typeof row.amount === 'number' ? row.amount : null,
  }));
}

export async function initializePaystackTransaction(input: {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}): Promise<PaystackInitializeResult> {
  if (!Number.isInteger(input.amountKobo) || input.amountKobo < 100) {
    throw new Error('Paystack amount must be at least 100 kobo');
  }
  const data = await paystackFetch<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }>('/transaction/initialize', {
    method: 'POST',
    json: {
      email: input.email,
      amount: input.amountKobo,
      currency: 'NGN',
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    },
  });
  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference,
  };
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackVerifyResult> {
  const data = await paystackFetch<{
    status: string;
    reference: string;
    amount: number;
    currency: string;
    id: number;
    paid_at?: string | null;
    metadata?: Record<string, unknown>;
    gateway_response?: string;
  }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
  return {
    status: data.status,
    reference: data.reference,
    amount: data.amount,
    currency: data.currency,
    id: data.id,
    paidAt: data.paid_at,
    metadata: data.metadata,
    gatewayResponse: data.gateway_response,
  };
}

export async function resolvePaystackAccount(input: {
  accountNumber: string;
  bankCode: string;
}): Promise<{ accountName: string; accountNumber: string }> {
  const qs = new URLSearchParams({
    account_number: input.accountNumber,
    bank_code: input.bankCode,
  });
  const data = await paystackFetch<{ account_name: string; account_number: string }>(
    `/bank/resolve?${qs.toString()}`,
    { method: 'GET' }
  );
  return {
    accountName: data.account_name,
    accountNumber: data.account_number,
  };
}

export async function createPaystackTransferRecipient(input: {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  currency?: string;
}): Promise<PaystackRecipientResult> {
  const data = await paystackFetch<{
    recipient_code: string;
    details?: { account_number?: string; bank_code?: string; account_name?: string };
  }>('/transferrecipient', {
    method: 'POST',
    json: {
      type: 'nuban',
      name: input.accountName,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: input.currency || 'NGN',
    },
  });
  const acct = data.details?.account_number || input.accountNumber;
  return {
    recipientCode: data.recipient_code,
    accountName: data.details?.account_name || input.accountName,
    bankCode: data.details?.bank_code || input.bankCode,
    accountNumberLast4: acct.slice(-4),
  };
}

export async function initiatePaystackTransfer(input: {
  amountKobo: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<{ transferCode: string; status: string; reference: string }> {
  const data = await paystackFetch<{
    transfer_code: string;
    status: string;
    reference: string;
  }>('/transfer', {
    method: 'POST',
    json: {
      source: 'balance',
      amount: input.amountKobo,
      recipient: input.recipientCode,
      reference: input.reference,
      reason: input.reason,
      currency: 'NGN',
    },
  });
  return {
    transferCode: data.transfer_code,
    status: data.status,
    reference: data.reference,
  };
}

export async function refundPaystackTransaction(input: {
  transactionIdOrReference: string | number;
  amountKobo?: number;
}): Promise<{ id: number | string; status: string }> {
  const json: Record<string, unknown> = {
    transaction: input.transactionIdOrReference,
  };
  if (input.amountKobo != null) json.amount = input.amountKobo;
  const data = await paystackFetch<{ id: number; status: string }>('/refund', {
    method: 'POST',
    json,
  });
  return { id: data.id, status: data.status };
}

export async function listPaystackBanks(): Promise<Array<{ name: string; code: string }>> {
  const data = await paystackFetch<Array<{ name: string; code: string }>>(
    '/bank?country=nigeria&currency=NGN',
    { method: 'GET' }
  );
  return (data || []).map((b) => ({ name: b.name, code: b.code }));
}

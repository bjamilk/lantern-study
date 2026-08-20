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

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not configured');
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
    throw new Error(msg);
  }
  return payload.data as T;
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

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { EXPORT_FORMAT_V2 } from '@lantern/shared/accountLifecycle';

function signingSecret(): string {
  const secret = process.env.EXPORT_SIGNING_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('EXPORT_SIGNING_SECRET or JWT_SECRET is required for signed exports');
  }
  return secret;
}

function payloadDigest(data: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function signAccountExport(params: {
  sourceUserId: string;
  sourceEmail?: string | null;
  exportedAt: string;
  data: Record<string, unknown>;
}): string {
  const canonical = [
    EXPORT_FORMAT_V2,
    params.sourceUserId,
    params.sourceEmail ?? '',
    params.exportedAt,
    payloadDigest(params.data),
  ].join('|');

  return createHmac('sha256', signingSecret()).update(canonical).digest('hex');
}

export function verifyAccountExportSignature(exportDoc: {
  format: string;
  sourceUserId: string;
  sourceEmail?: string | null;
  exportedAt: string;
  signature: string;
  data: Record<string, unknown>;
}): boolean {
  if (exportDoc.format !== EXPORT_FORMAT_V2) return false;
  const expected = signAccountExport({
    sourceUserId: exportDoc.sourceUserId,
    sourceEmail: exportDoc.sourceEmail,
    exportedAt: exportDoc.exportedAt,
    data: exportDoc.data,
  });
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(exportDoc.signature, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function wrapSignedExport(params: {
  sourceUserId: string;
  sourceEmail?: string | null;
  data: Record<string, unknown>;
}) {
  const exportedAt = new Date().toISOString();
  const signature = signAccountExport({
    sourceUserId: params.sourceUserId,
    sourceEmail: params.sourceEmail,
    exportedAt,
    data: params.data,
  });

  return {
    format: EXPORT_FORMAT_V2,
    exportedAt,
    sourceUserId: params.sourceUserId,
    sourceEmail: params.sourceEmail ?? null,
    signature,
    data: params.data,
  };
}

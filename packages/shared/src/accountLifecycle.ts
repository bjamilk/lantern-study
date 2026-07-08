/** GDPR export format versions */
export const EXPORT_FORMAT_V1 = 'lantern-study-gdpr-export-v1';
export const EXPORT_FORMAT_V2 = 'lantern-study-gdpr-export-v2';

/** Days before a paused account is permanently deleted */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;

export const ACCOUNT_DELETE_CONFIRM_TEXT = 'DELETE';

/** Shown in delete / export flows */
export const ACCOUNT_DATA_LOSS_ITEMS = [
  'Notes and written content (uploaded PDFs and slide files are not included in export)',
  'Flashcards, decks, and study progress',
  'Test results and offline study bundles',
  'Group memberships and chat history',
  'Marketplace listings, orders, and messages',
  'Budget entries and gamification stats',
  'Profile, username, and account settings',
] as const;

export const ACCOUNT_EXPORT_COPY = {
  summary:
    'Download a JSON backup of your account data. You can import this backup into a new account after signing in.',
  limitations:
    'Exports include text-based data (notes, flashcards, profile). Uploaded files (PDFs, presentations, images) are not included.',
  restoreHint:
    'After you create a new account, use Settings → Import backup to restore notes and flashcards. You will need your account password to import.',
} as const;

export type AccountLifecycleStatus = 'active' | 'deactivated' | 'banned';

export interface AccountLifecycleInfo {
  status: AccountLifecycleStatus;
  deactivatedAt?: string | null;
  deletionScheduledAt?: string | null;
  graceDaysRemaining?: number | null;
}

export interface SignedAccountExportV2 {
  format: typeof EXPORT_FORMAT_V2;
  exportedAt: string;
  sourceUserId: string;
  sourceEmail?: string | null;
  signature: string;
  data: Record<string, unknown>;
}

export function isSignedExportV2(value: unknown): value is SignedAccountExportV2 {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    o.format === EXPORT_FORMAT_V2 &&
    typeof o.signature === 'string' &&
    o.signature.length >= 32 &&
    typeof o.data === 'object' &&
    o.data !== null &&
    typeof o.sourceUserId === 'string'
  );
}

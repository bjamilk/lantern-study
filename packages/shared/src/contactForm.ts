export const CONTACT_CATEGORIES = [
  'general',
  'account',
  'bug',
  'billing',
  'marketplace',
  'privacy',
  'other',
] as const;

export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  general: 'General question',
  account: 'Account & login',
  bug: 'Bug or technical issue',
  billing: 'Billing & subscription',
  marketplace: 'Marketplace',
  privacy: 'Privacy & data',
  other: 'Other',
};

export interface ContactFormInput {
  name: string;
  email: string;
  subject: string;
  message: string;
  category: ContactCategory;
  /** Honeypot — must be empty for legitimate submissions */
  _hp?: string;
}

export interface ContactFormPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
  category: ContactCategory;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

export function validateContactForm(
  input: Partial<ContactFormInput>
): { ok: true; value: ContactFormPayload } | { ok: false; error: string } {
  if (input._hp && String(input._hp).trim().length > 0) {
    return { ok: false, error: 'Invalid submission.' };
  }

  const name = stripHtml(stripControlChars(String(input.name ?? '')));
  if (name.length < 2 || name.length > 100) {
    return { ok: false, error: 'Name must be 2–100 characters.' };
  }

  const email = stripControlChars(String(input.email ?? '')).toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return { ok: false, error: 'Enter a valid email address.' };
  }

  const category = input.category;
  if (!category || !CONTACT_CATEGORIES.includes(category as ContactCategory)) {
    return { ok: false, error: 'Select a valid category.' };
  }

  const subject = stripHtml(stripControlChars(String(input.subject ?? '')));
  if (subject.length < 3 || subject.length > 120) {
    return { ok: false, error: 'Subject must be 3–120 characters.' };
  }

  const message = stripHtml(stripControlChars(String(input.message ?? '')));
  if (message.length < 20 || message.length > 2000) {
    return { ok: false, error: 'Message must be 20–2000 characters.' };
  }

  return {
    ok: true,
    value: { name, email, subject, message, category: category as ContactCategory },
  };
}

export const CONTACT_FORM_LIMITS = {
  nameMax: 100,
  subjectMax: 120,
  messageMax: 2000,
  messageMin: 20,
} as const;

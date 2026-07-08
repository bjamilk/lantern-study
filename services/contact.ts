import { getApiBaseUrl } from '@lantern/shared';
import {
  validateContactForm,
  type ContactCategory,
  type ContactFormInput,
} from '@lantern/shared/contactForm';
import { getAuthHeaders } from './supabase';

const API_BASE_URL = getApiBaseUrl();

export type SubmitContactFormInput = Omit<ContactFormInput, '_hp'> & {
  source?: 'web' | 'mobile';
};

export async function submitContactForm(input: SubmitContactFormInput): Promise<string> {
  const validated = validateContactForm({ ...input, _hp: '' });
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/api/v1/contact`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...validated.value,
      source: input.source ?? 'web',
      _hp: '',
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || json.message || `Request failed (${response.status})`);
  }

  return json.message || 'Message sent successfully.';
}

export type { ContactCategory };

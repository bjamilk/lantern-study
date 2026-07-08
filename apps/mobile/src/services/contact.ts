import { getApiBaseUrl } from '@lantern/shared';
import {
  validateContactForm,
  type ContactCategory,
  type ContactFormInput,
} from '@lantern/shared/contactForm';
import { getAuthHeaders, API_BASE_URL } from './supabase';

export type SubmitContactFormInput = Omit<ContactFormInput, '_hp'> & {
  source?: 'web' | 'mobile';
};

export async function submitContactForm(input: SubmitContactFormInput): Promise<string> {
  const validated = validateContactForm({ ...input, _hp: '' });
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  const baseUrl = API_BASE_URL || getApiBaseUrl();
  const headers = await getAuthHeaders();
  const response = await fetch(`${baseUrl}/api/v1/contact`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...validated.value,
      source: input.source ?? 'mobile',
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

import {
  CONTACT_CATEGORY_LABELS,
  type ContactFormPayload,
} from '@lantern/shared/contactForm';
import { logger } from '../utils/logger';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isContactMailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.CONTACT_TO_EMAIL);
}

export async function sendContactFormEmail(params: {
  payload: ContactFormPayload;
  source: 'web' | 'mobile';
  userId?: string | null;
  clientIp?: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!apiKey || !to) {
    throw new Error('Contact email is not configured on the server.');
  }

  const from =
    process.env.CONTACT_FROM_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    'Lantern Study <noreply@lanternstudy.com>';

  const { payload, source, userId, clientIp } = params;
  const categoryLabel = CONTACT_CATEGORY_LABELS[payload.category];

  const html = `
    <h2>New contact form message</h2>
    <p><strong>Category:</strong> ${escapeHtml(categoryLabel)}</p>
    <p><strong>From:</strong> ${escapeHtml(payload.name)} &lt;${escapeHtml(payload.email)}&gt;</p>
    <p><strong>Subject:</strong> ${escapeHtml(payload.subject)}</p>
    <p><strong>Source:</strong> ${escapeHtml(source)}</p>
    ${userId ? `<p><strong>User ID:</strong> ${escapeHtml(userId)}</p>` : ''}
    ${clientIp ? `<p><strong>IP:</strong> ${escapeHtml(clientIp)}</p>` : ''}
    <hr />
    <pre style="white-space:pre-wrap;font-family:sans-serif;">${escapeHtml(payload.message)}</pre>
  `.trim();

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: payload.email,
      subject: `[Lantern Contact] ${payload.subject}`,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('Resend contact email failed', { status: response.status, body });
    throw new Error('Failed to send message. Please try again later.');
  }

  logger.info('Contact form email sent', {
    category: payload.category,
    source,
    userId: userId ?? null,
  });
}

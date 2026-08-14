import React, { useState } from 'react';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  CONTACT_FORM_LIMITS,
  SUPPORT_EMAIL,
  buildSupportMailtoUrl,
  type ContactCategory,
} from '@lantern/shared';
import { Button, Input, Select, Textarea } from './ui';
import { submitContactForm } from '../services/contact';
import TurnstileWidget, { getTurnstileSitekey, type TurnstileHandle } from './TurnstileWidget';

export interface ContactFormProps {
  defaultName?: string;
  defaultEmail?: string;
  source?: 'web' | 'mobile';
  onSuccess?: (message: string) => void;
  compact?: boolean;
}

export const ContactForm: React.FC<ContactFormProps> = ({
  defaultName = '',
  defaultEmail = '',
  source = 'web',
  onSuccess,
  compact = false,
}) => {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [category, setCategory] = useState<ContactCategory>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [hp, setHp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = React.useRef<TurnstileHandle | null>(null);
  const turnstileRequired = Boolean(getTurnstileSitekey());

  const mailtoUrl = buildSupportMailtoUrl({
    subject: subject.trim()
      ? `[${CONTACT_CATEGORY_LABELS[category]}] ${subject.trim()}`
      : undefined,
    body:
      name.trim() || email.trim() || message.trim()
        ? [
            name.trim() ? `Name: ${name.trim()}` : null,
            email.trim() ? `Email: ${email.trim()}` : null,
            `Category: ${CONTACT_CATEGORY_LABELS[category]}`,
            '',
            message.trim(),
          ]
            .filter((line) => line !== null)
            .join('\n')
        : undefined,
  });

  const showMailtoFallback =
    Boolean(error) &&
    (error.includes('unavailable') || error.includes(SUPPORT_EMAIL));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await submitContactForm({
        name,
        email,
        category,
        subject,
        message,
        source,
        _hp: hp,
        turnstileToken,
      });
      setSuccess(result);
      setSubject('');
      setMessage('');
      onSuccess?.(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setLoading(false);
      // The token is spent whether or not the send succeeded, and the form
      // stays on screen — without this, a retry replays a dead token.
      setTurnstileToken('');
      turnstileRef.current?.reset();
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
      <p className="text-sm text-lantern-text-secondary">
        Send a message below and we will reply by email. You can also reach us directly at{' '}
        <a href={buildSupportMailtoUrl()} className="text-lantern-primary underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      {/* Honeypot — hidden from users, bots may fill it */}
      <div className="absolute opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
        <label htmlFor="contact-hp">Leave blank</label>
        <input
          id="contact-hp"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
        />
      </div>

      <div className={compact ? 'space-y-3' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}>
        <div>
          <label htmlFor="contact-name" className="block text-sm font-medium text-lantern-text mb-1">
            Name
          </label>
          <Input
            id="contact-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={CONTACT_FORM_LIMITS.nameMax}
            required
            autoComplete="name"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'contact-form-error' : undefined}
          />
        </div>
        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium text-lantern-text mb-1">
            Email
          </label>
          <Input
            id="contact-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            required
            autoComplete="email"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'contact-form-error' : undefined}
          />
        </div>
      </div>

      <div>
        <label htmlFor="contact-category" className="block text-sm font-medium text-lantern-text mb-1">
          Category
        </label>
        <Select
          id="contact-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ContactCategory)}
        >
          {CONTACT_CATEGORIES.map((key) => (
            <option key={key} value={key}>
              {CONTACT_CATEGORY_LABELS[key]}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor="contact-subject" className="block text-sm font-medium text-lantern-text mb-1">
          Subject
        </label>
        <Input
          id="contact-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={CONTACT_FORM_LIMITS.subjectMax}
          required
        />
      </div>

      <div>
        <label htmlFor="contact-message" className="block text-sm font-medium text-lantern-text mb-1">
          Message
        </label>
        <Textarea
          id="contact-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={compact ? 4 : 6}
          maxLength={CONTACT_FORM_LIMITS.messageMax}
          required
          placeholder={`Tell us how we can help (${CONTACT_FORM_LIMITS.messageMin} characters minimum)…`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'contact-form-error' : undefined}
        />
        <p className="text-xs text-lantern-text-secondary mt-1">
          {message.length}/{CONTACT_FORM_LIMITS.messageMax}
        </p>
      </div>

      {error && (
        <p id="contact-form-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {showMailtoFallback && (
        <a
          href={mailtoUrl}
          className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 text-sm font-medium text-lantern-primary dark:text-lantern-primary-light bg-lantern-primary-background hover:bg-lantern-primary-background dark:hover:bg-lantern-primary-dark/50 border border-lantern-primary/30 dark:border-lantern-primary/30 rounded-md"
        >
          Open in email app ({SUPPORT_EMAIL})
        </a>
      )}
      {success && <p className="text-sm text-green-700 dark:text-green-400">{success}</p>}

      <TurnstileWidget
        ref={turnstileRef}
        action="contact"
        onToken={setTurnstileToken}
        onExpire={() => setTurnstileToken('')}
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="submit"
          disabled={loading || (turnstileRequired && !turnstileToken)}
          className="w-full sm:w-auto"
        >
          {loading ? 'Sending…' : 'Send message'}
        </Button>
        <a
          href={mailtoUrl}
          className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-accent-background hover:bg-amber-100 dark:hover:bg-amber-900/30 border border-lantern-border rounded-md"
        >
          Email {SUPPORT_EMAIL}
        </a>
      </div>

      <p className="text-xs text-lantern-text-secondary">
        Do not include passwords or payment card numbers. We reply to the email address above.
      </p>
    </form>
  );
};

export default ContactForm;

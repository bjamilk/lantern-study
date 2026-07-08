import React, { useState } from 'react';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  CONTACT_FORM_LIMITS,
  type ContactCategory,
} from '@lantern/shared';
import { Button, Input, Select, Textarea } from './ui';
import { submitContactForm } from '../services/contact';

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
      });
      setSuccess(result);
      setSubject('');
      setMessage('');
      onSuccess?.(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
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
        />
        <p className="text-xs text-lantern-text-secondary mt-1">
          {message.length}/{CONTACT_FORM_LIMITS.messageMax}
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-700 dark:text-green-400">{success}</p>}

      <Button type="submit" disabled={loading} className="w-full sm:w-auto">
        {loading ? 'Sending…' : 'Send message'}
      </Button>

      <p className="text-xs text-lantern-text-secondary">
        Do not include passwords or payment card numbers. We reply to the email address above.
      </p>
    </form>
  );
};

export default ContactForm;

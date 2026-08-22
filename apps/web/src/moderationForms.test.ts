import { describe, expect, it } from 'vitest';
import {
  attestationRequiredForEdit,
  formatSuspensionDate,
  isAlreadyReportedError,
  isInlineSubmitError,
  listingNeedsAttestation,
  parseSourcesCited,
  readSuspensionFromBody,
  resolveListingCategoryId,
  suspendUntilIso,
} from '../../../utils/moderationForms';
import { ATTESTATION_REQUIRED_MESSAGE } from '@lantern/shared';

describe('listingNeedsAttestation', () => {
  it('requires the attestation for academic content categories', () => {
    for (const category of ['pq_bank', 'lecture_notes', 'project_thesis', 'textbook_exchange']) {
      expect(listingNeedsAttestation({ listingKind: 'single', category })).toBe(true);
    }
  });

  it('requires it for every digital question bank regardless of category', () => {
    expect(listingNeedsAttestation({ listingKind: 'question_bank', category: 'accommodation' })).toBe(true);
  });

  it('does not require it for student-life, lab or custom categories', () => {
    expect(listingNeedsAttestation({ listingKind: 'single', category: 'accommodation' })).toBe(false);
    expect(listingNeedsAttestation({ listingKind: 'single', category: 'equipment_rental' })).toBe(false);
    expect(listingNeedsAttestation({ listingKind: 'single', category: 'custom:My thing' })).toBe(false);
    expect(listingNeedsAttestation({ listingKind: 'single', category: '' })).toBe(false);
    expect(listingNeedsAttestation({ listingKind: 'single', category: null })).toBe(false);
  });

  it("never treats the form's 'other' placeholder as academic", () => {
    expect(listingNeedsAttestation({ category: resolveListingCategoryId('other', 'Past questions') })).toBe(false);
    expect(resolveListingCategoryId('other', ' Tutoring ')).toBe('custom:Tutoring');
    expect(resolveListingCategoryId('pq_bank', '')).toBe('pq_bank');
  });
});

describe('attestationRequiredForEdit', () => {
  it('re-prompts only when an academic listing is not already attested or cleared', () => {
    expect(attestationRequiredForEdit({ category: 'pq_bank', rightsStatus: 'unattested' })).toBe(true);
    expect(attestationRequiredForEdit({ category: 'pq_bank', rightsStatus: undefined })).toBe(true);
    expect(attestationRequiredForEdit({ category: 'pq_bank', rightsStatus: 'attested' })).toBe(false);
    expect(attestationRequiredForEdit({ category: 'pq_bank', rightsStatus: 'cleared' })).toBe(false);
    expect(attestationRequiredForEdit({ category: 'accommodation', rightsStatus: 'unattested' })).toBe(false);
  });
});

describe('parseSourcesCited', () => {
  it('splits one source per line, trims and drops blanks', () => {
    const result = parseSourcesCited('  Lecture slides week 3 \n\n  GST 101 past papers 2023\r\n');
    expect(result).toEqual({ ok: true, value: ['Lecture slides week 3', 'GST 101 past papers 2023'] });
  });

  it('returns an empty list for an empty textarea', () => {
    expect(parseSourcesCited('')).toEqual({ ok: true, value: [] });
  });

  it('rejects more than 20 sources or an over-long source', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `source ${i}`).join('\n');
    expect(parseSourcesCited(tooMany).ok).toBe(false);
    expect(parseSourcesCited('x'.repeat(201)).ok).toBe(false);
  });
});

describe('error classification', () => {
  it('treats 400s and the attestation message as inline form errors', () => {
    const badRequest = Object.assign(new Error('Listing title contains prohibited wording'), { status: 400 });
    expect(isInlineSubmitError(badRequest)).toBe(true);
    expect(isInlineSubmitError(new Error(ATTESTATION_REQUIRED_MESSAGE))).toBe(true);
    expect(isInlineSubmitError(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
    expect(isInlineSubmitError('nope')).toBe(false);
  });

  it('recognises the duplicate-report 409', () => {
    expect(isAlreadyReportedError(Object.assign(new Error('Conflict'), { status: 409 }))).toBe(true);
    expect(isAlreadyReportedError(new Error('You have already reported this listing'))).toBe(true);
    expect(isAlreadyReportedError(new Error('Network down'))).toBe(false);
  });
});

describe('suspension helpers', () => {
  it('reads only the ACCOUNT_SUSPENDED 403 body', () => {
    expect(
      readSuspensionFromBody(403, {
        code: 'ACCOUNT_SUSPENDED',
        suspendedUntil: '2026-09-05T00:00:00.000Z',
        message: 'Account suspended until 5 September 2026',
      }),
    ).toEqual({ suspendedUntil: '2026-09-05T00:00:00.000Z', message: 'Account suspended until 5 September 2026' });
    expect(readSuspensionFromBody(403, { error: 'Forbidden' })).toBeNull();
    expect(readSuspensionFromBody(401, { code: 'ACCOUNT_SUSPENDED' })).toBeNull();
    expect(readSuspensionFromBody(403, null)).toBeNull();
  });

  it('falls back to the error string and a default message', () => {
    expect(readSuspensionFromBody(403, { code: 'ACCOUNT_SUSPENDED', error: 'Suspended' })).toEqual({
      suspendedUntil: null,
      message: 'Suspended',
    });
    expect(readSuspensionFromBody(403, { code: 'ACCOUNT_SUSPENDED' })?.message).toBe('Your account is suspended.');
  });

  it('formats dates and survives garbage', () => {
    expect(formatSuspensionDate(null)).toBeNull();
    expect(formatSuspensionDate('not a date')).toBe('not a date');
    expect(formatSuspensionDate('2026-09-05T12:00:00.000Z')).toMatch(/2026/);
  });

  it('turns the admin date input into a future ISO timestamp', () => {
    const now = new Date('2026-08-22T10:00:00Z');
    expect(suspendUntilIso('', now)).toBeNull();
    expect(suspendUntilIso('2026-08-01', now)).toBeNull();
    expect(suspendUntilIso('garbage', now)).toBeNull();
    const iso = suspendUntilIso('2026-09-05', now);
    expect(iso).not.toBeNull();
    expect(new Date(iso as string).getTime()).toBeGreaterThan(now.getTime());
  });
});

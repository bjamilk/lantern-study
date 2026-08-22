import {
  ACADEMIC_LISTING_CATEGORIES,
  ADMIN_REPORT_ACTIONS,
  CONTENT_REPORT_REASONS,
  CONTENT_REPORT_TARGET_TYPES,
  REMOVE_CONTENT_SUPPORTED_TARGETS,
  REPORT_REASON_LABELS,
  RIGHTS_ATTESTATION_TEXT,
  RIGHTS_ATTESTATION_VERSION,
  STRIKE_SUSPENSION_THRESHOLD,
  canAppealListing,
  isAcademicListing,
  isReasonAllowedForTarget,
  isSuspensionActive,
  listingAppealRefusal,
  normalizeSourcesCited,
  reasonsForTarget,
  suspensionMessage,
} from './index';
import { JOB_REPORT_REASONS } from '../jobs/trust';
import { LEGAL_DOCUMENT_CONTENT, LEGAL_DOCUMENT_TITLES, LEGAL_PATHS } from '../legal';
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_LABELS } from '../contactForm';

describe('reasonsForTarget', () => {
  it('offers the academic-integrity reasons for listings and packs, not harassment', () => {
    for (const target of ['listing', 'question_bank'] as const) {
      const reasons = reasonsForTarget(target);
      expect(reasons).toEqual(
        expect.arrayContaining(['copyright', 'leaked_exam', 'plagiarism', 'prohibited_item', 'wrong_category']),
      );
      expect(reasons).not.toContain('harassment');
    }
  });

  it('offers harassment for people and chat, but not wrong_category', () => {
    for (const target of ['user', 'message', 'dm_message'] as const) {
      expect(reasonsForTarget(target)).toContain('harassment');
      expect(reasonsForTarget(target)).not.toContain('wrong_category');
    }
  });

  it('keeps the legacy jobs reason set for job postings so old clients keep working', () => {
    expect([...reasonsForTarget('job_posting')].sort()).toEqual([...JOB_REPORT_REASONS].sort());
  });

  it('always ends with "other" and only uses known reasons', () => {
    for (const target of CONTENT_REPORT_TARGET_TYPES) {
      const reasons = reasonsForTarget(target);
      expect(reasons[reasons.length - 1]).toBe('other');
      for (const reason of reasons) expect(CONTENT_REPORT_REASONS).toContain(reason);
    }
  });

  it('isReasonAllowedForTarget validates per target', () => {
    expect(isReasonAllowedForTarget('listing', 'leaked_exam')).toBe(true);
    expect(isReasonAllowedForTarget('user', 'leaked_exam')).toBe(false);
    expect(isReasonAllowedForTarget('user', 'not-a-reason')).toBe(false);
  });

  it('labels every reason', () => {
    for (const reason of CONTENT_REPORT_REASONS) {
      expect(REPORT_REASON_LABELS[reason]).toBeTruthy();
    }
  });
});

describe('rights attestation', () => {
  it('pins the attestation version and text both publish flows show', () => {
    expect(RIGHTS_ATTESTATION_VERSION).toBe('2026-08-22-v1');
    expect(RIGHTS_ATTESTATION_TEXT).toMatch(/leaked or unreleased exam/);
    expect(RIGHTS_ATTESTATION_TEXT).toMatch(/copyright/);
  });

  it('requires attestation for digital listings and exact academic category ids only', () => {
    expect(isAcademicListing({ listingKind: 'question_bank', category: 'anything' })).toBe(true);
    for (const category of ACADEMIC_LISTING_CATEGORIES) {
      expect(isAcademicListing({ listingKind: 'single', category })).toBe(true);
    }
    // Free text / custom categories never count, even when they mention notes.
    expect(isAcademicListing({ listingKind: 'single', category: 'custom:lecture notes' })).toBe(false);
    expect(isAcademicListing({ listingKind: 'single', category: 'Lecture Notes' })).toBe(false);
    expect(isAcademicListing({ listingKind: 'single', category: 'accommodation' })).toBe(false);
    expect(isAcademicListing({ listingKind: 'bundle', category: '' })).toBe(false);
  });

  it('uses the real marketplace category ids', () => {
    expect(ACADEMIC_LISTING_CATEGORIES).toEqual(['pq_bank', 'lecture_notes', 'project_thesis', 'textbook_exchange']);
  });
});

describe('normalizeSourcesCited', () => {
  it('accepts a list or newline-separated text, trimming and dropping blanks', () => {
    expect(normalizeSourcesCited(['  Stroud, Engineering Maths ', '', 'Lecture 3 handout'])).toEqual({
      ok: true,
      value: ['Stroud, Engineering Maths', 'Lecture 3 handout'],
    });
    expect(normalizeSourcesCited('a\nb\n\n')).toEqual({ ok: true, value: ['a', 'b'] });
    expect(normalizeSourcesCited(undefined)).toEqual({ ok: true, value: [] });
  });

  it('rejects more than 20 entries, over-long entries and non-strings', () => {
    expect(normalizeSourcesCited(Array.from({ length: 21 }, (_, i) => `s${i}`)).ok).toBe(false);
    expect(normalizeSourcesCited(['x'.repeat(201)]).ok).toBe(false);
    expect(normalizeSourcesCited([1 as unknown as string]).ok).toBe(false);
    expect(normalizeSourcesCited({} as unknown).ok).toBe(false);
  });
});

describe('strikes + suspension', () => {
  it('suspends at 3 active strikes', () => {
    expect(STRIKE_SUSPENSION_THRESHOLD).toBe(3);
  });

  it('treats only a future suspended_until as active', () => {
    const now = new Date('2026-08-22T12:00:00Z');
    expect(isSuspensionActive('2026-09-05T12:00:00Z', now)).toBe(true);
    expect(isSuspensionActive('2026-08-01T12:00:00Z', now)).toBe(false);
    expect(isSuspensionActive(null, now)).toBe(false);
    expect(isSuspensionActive('garbage', now)).toBe(false);
  });

  it('formats the suspension message with the date', () => {
    expect(suspensionMessage('2026-09-05T12:00:00Z')).toMatch(/^Account suspended until 5 September 2026$/);
  });
});

describe('takedown → appeal state machine', () => {
  it('allows one appeal while the listing is moderated', () => {
    expect(canAppealListing({ status: 'removed_by_admin', appeal_status: 'none' })).toBe(true);
    expect(canAppealListing({ status: 'suspended_by_admin' })).toBe(true);
  });

  it('refuses appeals on live listings and repeat appeals', () => {
    expect(listingAppealRefusal({ status: 'active', appeal_status: 'none' })).toMatch(/took down/);
    expect(listingAppealRefusal({ status: 'removed_by_admin', appeal_status: 'requested' })).toMatch(/already under review/);
    expect(listingAppealRefusal({ status: 'removed_by_admin', appeal_status: 'upheld' })).toMatch(/already been through/);
    expect(listingAppealRefusal({ status: 'removed_by_admin', appealStatus: 'reversed' })).toMatch(/already been through/);
  });
});

describe('admin action vocabulary', () => {
  it('lists the five v1 actions and the auto-removable targets', () => {
    expect(ADMIN_REPORT_ACTIONS).toEqual(['dismiss', 'under_review', 'warn', 'remove_content', 'strike']);
    expect(REMOVE_CONTENT_SUPPORTED_TARGETS).toEqual(['listing', 'question_bank', 'note', 'deck', 'group']);
    for (const t of ['message', 'dm_message', 'user', 'job_posting'] as const) {
      expect(REMOVE_CONTENT_SUPPORTED_TARGETS).not.toContain(t);
    }
  });
});

describe('policy documents + contact category', () => {
  it('registers the prohibited-content and seller-terms documents', () => {
    expect(LEGAL_PATHS.prohibited).toBe('/legal/prohibited');
    expect(LEGAL_PATHS['seller-terms']).toBe('/legal/seller-terms');
    expect(LEGAL_DOCUMENT_TITLES.prohibited).toMatch(/Prohibited/i);
    expect(LEGAL_DOCUMENT_TITLES['seller-terms']).toMatch(/Seller/i);
    expect(LEGAL_DOCUMENT_CONTENT.prohibited).toMatch(/draft for counsel review/i);
    expect(LEGAL_DOCUMENT_CONTENT['seller-terms']).toMatch(/draft for counsel review/i);
    expect(LEGAL_DOCUMENT_CONTENT['seller-terms']).toMatch(/three active strikes/i);
    expect(LEGAL_DOCUMENT_CONTENT.terms).toMatch(/\/legal\/prohibited/);
    expect(LEGAL_DOCUMENT_CONTENT.terms).toMatch(/\/legal\/seller-terms/);
  });

  it('adds the copyright contact category', () => {
    expect(CONTACT_CATEGORIES).toContain('copyright');
    expect(CONTACT_CATEGORY_LABELS.copyright).toBe('Copyright / content complaint');
  });
});

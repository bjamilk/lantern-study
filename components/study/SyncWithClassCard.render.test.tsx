// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { normalizeSyllabusSummary } from '@lantern/shared/study/syllabusSummary';

/**
 * "Sync with your class" — the first landing in an empty set.
 *
 * STRUCTURE tests, not pixel tests, for the same reason as the rest of this
 * wave: a render test cannot measure a laid-out box, and asserting a Tailwind
 * class string only proves the string was typed. What is pinned here is what
 * would be wrong if the card regressed:
 *
 *   - both doors are present and the reference's copy is the copy shipped;
 *   - the price is ON the upload button, before it is spent. That is Lantern's
 *     rule everywhere and the one place this deliberately leaves the
 *     reference, which prices nothing;
 *   - `Skip for now` exists, because the card must never be a wall;
 *   - the file input's accept list is `.pdf,.docx` and nothing else;
 *   - the extraction result and its Undo render inline — not as a toast that
 *     is gone before the number has been read;
 *   - an exam date renders once set, with a way to change it.
 *
 * The GATE — "this card appears only for an empty set" — is asserted against
 * `StudySetHome` rather than here, because that is where it lives.
 */

vi.mock('../../hooks/useResolvedStorageUrl', () => ({
  useResolvedStorageUrl: (src?: string | null) => (src ? `https://signed.example/${src}` : undefined),
}));
vi.mock('../../services/academic', () => ({ updateStudySet: vi.fn() }));
vi.mock('../../stores/academicStore', () => ({
  useAcademicStore: (sel: (s: unknown) => unknown) => sel({ myCourses: [], updateMyCourse: vi.fn() }),
}));
vi.mock('../../stores/studySetStore', () => ({
  useStudySetStore: (sel: (s: unknown) => unknown) => sel({ loadSets: vi.fn() }),
}));
vi.mock('../../stores/toastStore', () => ({
  useToastStore: (sel: (s: unknown) => unknown) => sel({ showToast: vi.fn() }),
}));

import { SyncWithClassCard } from './SyncWithClassCard';
import { StudySetHome } from './StudySetHome';

const SET_ID = '8f1b0c2e-2222-4a2b-9c3d-000000000002';

const SUMMARY = normalizeSyllabusSummary(
  {
    weeks: [
      { week: 1, title: 'Cell structure', date: '2026-09-21' },
      { week: 7, title: 'Midterm', date: '2026-10-30', examLabel: 'Midterm' },
    ],
    examDates: ['2026-10-30'],
  },
  '2026-09-18T00:00:00.000Z'
);

function card(extra: Partial<React.ComponentProps<typeof SyncWithClassCard>> = {}) {
  return renderToStaticMarkup(
    <SyncWithClassCard
      studySetId={SET_ID}
      examDate={null}
      syllabus={{ supported: true, noteId: null, summary: null }}
      onUploadSyllabus={async () => undefined}
      onUndoSyllabus={async () => undefined}
      onSkipToMaterials={() => undefined}
      onSkipForNow={() => undefined}
      {...extra}
    />
  );
}

describe('SyncWithClassCard', () => {
  it('shows the heading, the reference copy and both doors', () => {
    const html = card();
    // `Headline` sets the accent in its own span, so the line is split in the
    // markup — assert the halves, not the sentence.
    expect(html).toContain('Sync with ');
    expect(html).toContain('your class');
    expect(html).toContain('which topics belong to which exam');
    expect(html).toContain('Upload syllabus');
    expect(html).toContain('Skip and upload materials');
    // Both cards below, with the reference's own two headings.
    expect(html).toContain('Add your syllabus');
    expect(html).toContain('Exam dates');
    expect(html).toContain('Add exam');
  });

  it('prints the price on the upload button, before it is spent', () => {
    // The one deliberate departure from the reference, which prices nothing.
    expect(card()).toContain('1 AI use');
  });

  it('is never a wall: Skip for now is always there', () => {
    expect(card()).toContain('Skip for now');
  });

  it('offers only .pdf and .docx to the picker', () => {
    const html = card();
    expect(html).toContain('accept=".pdf,.docx"');
    // A nameless file field is unreachable by assistive tech.
    expect(html).toContain('aria-label="Choose a syllabus file"');
  });

  it('shows the extraction result inline, with an Undo beside it', () => {
    const html = card({ foundLabel: 'Found 2 weeks · 1 exam date', syllabus: { supported: true, noteId: 'n1', summary: SUMMARY } });
    expect(html).toContain('Found 2 weeks · 1 exam date');
    expect(html).toContain('Undo');
    // And the weeks it found, so the number is checkable rather than a claim.
    expect(html).toContain('Cell structure');
    expect(html).toContain('Wk 7');
    expect(html).toContain('Midterm');
  });

  it('shows a refusal inline as an alert, not as a vanished toast', () => {
    const html = card({ error: 'Legacy .doc files are not supported.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Legacy .doc files are not supported.');
  });

  it('renders the exam date once set, with a way to change and remove it', () => {
    const html = card({ examDate: '2026-11-02' });
    expect(html).toContain('2026-11-02');
    expect(html).toContain('Change');
    expect(html).toContain('Remove');
    // `Add exam` is gone once there is one — it would be a second, different
    // door to the same field.
    expect(html).not.toContain('Add exam');
  });

  it('says it is working while an upload is in flight', () => {
    expect(card({ uploading: true })).toContain('Reading your syllabus…');
  });

  it('offers Replace once a syllabus is filed', () => {
    const html = card({
      syllabus: { supported: true, noteId: 'n1', summary: SUMMARY },
      foundLabel: 'Found 2 weeks · 1 exam date',
    });
    expect(html).toContain('Replace syllabus');
  });
});

describe('the empty-set gate in StudySetHome', () => {
  const marker = <div data-testid="sync-card-here">SYNC CARD</div>;

  function home(extra: Partial<React.ComponentProps<typeof StudySetHome>> = {}) {
    return renderToStaticMarkup(
      <StudySetHome
        setLabel="Cell Biology"
        notes={[]}
        deckCount={0}
        testCount={0}
        onTool={() => undefined}
        onOpenNote={() => undefined}
        onOpenRecommended={() => undefined}
        syncWithClass={marker}
        {...extra}
      />
    );
  }

  it('draws the card for a set with nothing in it', () => {
    expect(home()).toContain('SYNC CARD');
  });

  it('drops it the moment the set has ANY material', () => {
    // A set with one deck has moved past "what class is this?" — three
    // separate counts, because each one on its own means the set is started.
    expect(home({ deckCount: 1 })).not.toContain('SYNC CARD');
    expect(home({ testCount: 1 })).not.toContain('SYNC CARD');
    expect(
      home({
        notes: [{ id: 'n1', title: 'A note', body: '', userId: 'u1' } as never],
      })
    ).not.toContain('SYNC CARD');
  });

  it('drops it when the parent has hidden it (skipped, or no migration)', () => {
    // The parent passes null for both cases, so an empty set is not enough on
    // its own — which is what makes `Skip for now` stick.
    expect(home({ syncWithClass: null })).not.toContain('SYNC CARD');
  });

  it('leaves the own-way grid on the page underneath it', () => {
    // The card is an offer above the room, never a replacement for it.
    const html = home();
    expect(html).toContain('SYNC CARD');
    expect(html).toContain('Or start learning ');
    expect(html).toContain('your own way');
  });
});

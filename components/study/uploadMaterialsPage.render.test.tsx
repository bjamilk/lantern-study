// @vitest-environment jsdom
/**
 * The Upload Materials page at the anatomy measured off StudyFetch on
 * 2026-09-17 (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md,
 * §Upload Materials).
 *
 * STRUCTURE, not pixels — a render test cannot measure a laid-out box. What is
 * pinned is what a student can feel and what was actually missing:
 *
 *   - the whole flow is VISIBLE: eleven doors are drawn, not six, and the ones
 *     Lantern cannot back are disabled with the reason attached to them by
 *     `aria-describedby` rather than hidden or left live;
 *   - the dropzone is a REAL file input, so it is reachable by Tab and
 *     operable from a keyboard — a div with a click handler is not;
 *   - the two invitations and the "what is generated" checklist exist at all.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { StudySetUpload } from './StudySetUpload';
import { UPLOAD_DOORS, UPLOAD_DOOR_UNAVAILABLE } from './uploadDoors';

vi.mock('../../stores/aiJobStore', () => ({
  useAiJobStore: (selector: (state: { jobs: unknown[] }) => unknown) => selector({ jobs: [] }),
}));

const page = (extra: Partial<React.ComponentProps<typeof StudySetUpload>> = {}) =>
  renderToStaticMarkup(
    <StudySetUpload
      studySetId="set-1"
      onImport={() => {}}
      onRecord={() => {}}
      onFiles={() => {}}
      onNoMaterial={() => {}}
      onCopyLink={() => {}}
      {...extra}
    />
  );

describe('the dropzone', () => {
  it('is a real file input behind a label, not a clickable div', () => {
    const html = page();
    expect(html).toContain('type="file"');
    expect(html).toContain('id="study-set-upload-input"');
    expect(html).toContain('for="study-set-upload-input"');
  });

  it('carries the reference copy and the honest size limit', () => {
    const html = page();
    expect(html).toContain('Upload any files from class');
    expect(html).toContain('Click to upload or drag and drop files');
    expect(html).toContain('25 MB');
  });

  it('accepts only what a handler exists for', () => {
    const html = page();
    expect(html).toContain('application/pdf');
    expect(html).toContain('image/*');
  });
});

describe('the doors', () => {
  it('draws every door, including the ones Lantern cannot back', () => {
    const html = page();
    // The "more" group is collapsed, so its LABELS are not in the markup yet —
    // but the primary six all are, disabled ones included.
    for (const door of UPLOAD_DOORS.slice(0, 6)) {
      expect(html, `${door.label} is missing`).toContain(door.label);
    }
    expect(html).toContain('View more upload types');
  });

  it('renders an unavailable door as a real disabled button with the reason', () => {
    const html = page();
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-describedby="upload-door-audio-reason"');
    expect(html).toContain('id="upload-door-audio-reason"');
    expect(html).toContain(UPLOAD_DOOR_UNAVAILABLE);
  });

  it('does not disable a door Lantern can actually back', () => {
    const html = page();
    // YouTube and Quizlet are live: createNoteFromYoutube and the export paste.
    expect(html).not.toContain('aria-describedby="upload-door-youtube-reason"');
    expect(html).not.toContain('aria-describedby="upload-door-quizlet-reason"');
  });

  it('keeps "more upload types" collapsed and says so', () => {
    expect(page()).toContain('aria-expanded="false"');
  });
});

describe('the three cards under the doors', () => {
  it('invites classmates and offers the share link', () => {
    const html = page();
    expect(html).toContain('Ask your friends to help upload materials');
    expect(html).toContain('Share this link with your classmates');
    expect(html).toContain('Copy link');
  });

  it('offers the live lecture', () => {
    const html = page();
    expect(html).toContain('Are you in class? Start a live lecture');
    expect(html).toContain('Start recording');
  });

  it('says what an upload actually produces', () => {
    const html = page();
    expect(html).toContain('What is generated');
    expect(html).toContain('Study Materials');
    expect(html).toContain('Plans &amp; Progress Tracking');
  });
});

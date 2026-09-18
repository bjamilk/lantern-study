// @vitest-environment jsdom
/**
 * The Upload Materials page at the anatomy measured off StudyFetch on
 * 2026-09-17 (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md,
 * §Upload Materials).
 *
 * STRUCTURE, not pixels — a render test cannot measure a laid-out box. What is
 * pinned is what a student can feel and what would silently rot:
 *
 *   - EVERY DOOR IS LIVE. The grid is six doors and each one carries an
 *     action; a door Lantern cannot back is not drawn. This is the test that
 *     fails if someone adds a seventh with nothing behind it.
 *   - the dropzone is a REAL file input, so it is reachable by Tab and
 *     operable from a keyboard — a div with a click handler is not — and no
 *     button is nested inside its `<label>`, which is invalid HTML and eats
 *     the click;
 *   - `.docx` is in the accept list and legacy `.doc` is not;
 *   - "View more upload types" is collapsed and toggles the second grid;
 *   - the two bands and the "what is generated" checklist exist, and their
 *     copy is true of Lantern rather than copied off the reference.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The job stores are stubbed rather than loaded: both persist to localStorage
// at import time, and this test is about the page's anatomy. `getJobsForUser`
// and `getCurrentStageLabel` are here because `creationProgress` calls them —
// the real mapping has its own unit test (`creationProgress.test.ts`).
vi.mock('../../stores/aiJobStore', () => ({
  useAiJobStore: (selector: (state: { jobs: unknown[] }) => unknown) => selector({ jobs: [] }),
  getJobsForUser: () => [],
  getCurrentStageLabel: () => 'Working…',
}));

vi.mock('../../stores/noteUploadStore', () => ({
  useNoteUploadStore: (selector: (state: { jobs: unknown[] }) => unknown) => selector({ jobs: [] }),
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { currentUser: { id: string } }) => unknown) =>
    selector({ currentUser: { id: 'student-1' } }),
}));

import { StudySetUpload } from './StudySetUpload';
import { DOCX_MIME, UPLOAD_DOORS, UPLOAD_DOORS_MORE, UPLOAD_DOORS_PRIMARY } from './uploadDoors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const props = (extra: Partial<React.ComponentProps<typeof StudySetUpload>> = {}) => ({
  studySetId: 'set-1',
  onImport: vi.fn(),
  onRecord: vi.fn(),
  onFiles: vi.fn(),
  onNoMaterial: vi.fn(),
  onCopyLink: vi.fn(),
  ...extra,
});

/** Server-rendered markup, for the copy assertions. */
const page = (extra: Partial<React.ComponentProps<typeof StudySetUpload>> = {}) =>
  renderToStaticMarkup(<StudySetUpload {...props(extra)} />);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(extra: Partial<React.ComponentProps<typeof StudySetUpload>> = {}) {
  act(() => root.render(<StudySetUpload {...props(extra)} />));
}

function buttonNamed(label: string | RegExp): HTMLButtonElement | undefined {
  const matches = (text: string) =>
    typeof label === 'string' ? text === label : label.test(text);
  return Array.from(container.querySelectorAll('button')).find((button) =>
    matches((button.textContent || '').trim())
  );
}

function click(button: HTMLElement | undefined) {
  expect(button, 'button not found').toBeTruthy();
  act(() => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('the intro bubble', () => {
  it('leads with the reference copy and names what Lantern actually reads', () => {
    const html = page();
    expect(html).toContain('Let’s build your study set.');
    expect(html).toContain('Word documents');
  });
});

describe('the dropzone', () => {
  it('is a real file input behind a label, not a clickable div', () => {
    const html = page();
    expect(html).toContain('type="file"');
    expect(html).toContain('id="study-set-upload-input"');
    expect(html).toContain('for="study-set-upload-input"');
  });

  it('carries the reference copy, with "Click to upload" in bold', () => {
    const html = page();
    expect(html).toContain('Upload any files from Class');
    expect(html).toContain('Click to upload');
    expect(html).toContain('25 MB');
  });

  it('nests no button inside the label', () => {
    mount();
    const label = container.querySelector('label[for="study-set-upload-input"]');
    expect(label).not.toBeNull();
    expect(label?.querySelector('button')).toBeNull();
  });

  it('accepts .docx — and never legacy .doc', () => {
    mount();
    const accept = container.querySelector('#study-set-upload-input')?.getAttribute('accept') ?? '';
    expect(accept).toContain('.docx');
    expect(accept).toContain(DOCX_MIME);
    expect(accept).toContain('application/pdf');
    expect(accept).toContain('image/*');
    // A bare `.doc` would be a promise the pipeline cannot keep.
    expect(accept).not.toMatch(/(^|,)\.doc(?!x)/);
  });
});

describe('the doors', () => {
  it('draws six primary doors, and one of them is Word', () => {
    expect(UPLOAD_DOORS_PRIMARY).toHaveLength(6);
    const html = page();
    for (const door of UPLOAD_DOORS_PRIMARY) {
      // `&` arrives as `&amp;` in server-rendered markup.
      expect(html, `${door.label} is missing`).toContain(door.label.replace(/&/g, '&amp;'));
    }
    expect(html).toContain('Word Documents');
  });

  it('gives every door a real handler — none is decoration', () => {
    for (const door of UPLOAD_DOORS) {
      expect(door.action, `${door.label} has no action`).toBeDefined();
      expect(['import', 'record', 'noMaterial']).toContain(door.action.kind);
    }
  });

  it('draws no door Lantern cannot back', () => {
    const labels = UPLOAD_DOORS.map((door) => door.label);
    for (const dropped of ['Audio Files', 'Video Files', 'Google Drive']) {
      expect(labels).not.toContain(dropped);
    }
    // And nothing renders a disabled control in their place.
    expect(page()).not.toContain('aria-disabled="true"');
  });

  it('opens the import modal on the source the door names', () => {
    const onImport = vi.fn();
    mount({ onImport });
    click(buttonNamed('Word Documents'));
    click(buttonNamed('PDF Documents'));
    expect(onImport.mock.calls.map((call) => call[0])).toEqual(['docx', 'pdf']);
  });

  it('keeps "more upload types" collapsed until it is pressed', () => {
    mount();
    const toggle = buttonNamed(/View more upload types/);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(buttonNamed('Paste Notes')).toBeUndefined();

    click(toggle);
    expect(buttonNamed(/View more upload types/)?.getAttribute('aria-expanded')).toBe('true');
    for (const door of UPLOAD_DOORS_MORE) {
      expect(buttonNamed(door.label), `${door.label} did not appear`).toBeTruthy();
    }
  });

  it('starts the topic wizard from "No Material" rather than an upload', () => {
    const onNoMaterial = vi.fn();
    mount({ onNoMaterial });
    click(buttonNamed(/View more upload types/));
    click(buttonNamed('No Material'));
    expect(onNoMaterial).toHaveBeenCalledTimes(1);
  });
});

describe('the three cards under the doors', () => {
  it('offers the share link with copy that is true of Lantern', () => {
    const html = page();
    expect(html).toContain('Share this set with your classmates');
    expect(html).toContain('Copy Link');
    // Lantern has no collaborative upload, so the band must not promise one.
    expect(html).not.toContain('help upload');
  });

  it('copies the share link from the band', () => {
    const onCopyLink = vi.fn();
    mount({ onCopyLink });
    click(buttonNamed(/Copy Link/));
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it('wires Start Recording to the lecture recorder', () => {
    const onRecord = vi.fn();
    mount({ onRecord });
    expect(container.textContent).toContain('Are you in class? Start a live lecture');
    click(buttonNamed(/Start Recording/));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it('says what an upload actually produces', () => {
    const html = page();
    expect(html).toContain('What is generated');
    expect(html).toContain('Study Materials');
    expect(html).toContain('Plans &amp; Progress Tracking');
  });
});

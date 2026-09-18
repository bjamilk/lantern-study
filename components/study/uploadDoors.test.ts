/**
 * The door table and the drop router.
 *
 * What is pinned here is the house rule the page cannot be trusted to keep on
 * its own: EVERY door does a real thing today. There is no longer an
 * `available` flag to be false — a door Lantern cannot back is not in the
 * table at all, so "disabled with a reason under it" cannot come back by
 * accident, and neither can a live control that does nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  DOCX_MIME,
  UPLOAD_ACCEPT,
  UPLOAD_DOORS,
  UPLOAD_DOORS_MORE,
  UPLOAD_DOORS_PRIMARY,
  routeUploadFiles,
} from './uploadDoors';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('the door table', () => {
  it('draws a 3×2 grid and three doors behind More', () => {
    expect(UPLOAD_DOORS_PRIMARY).toHaveLength(6);
    expect(UPLOAD_DOORS_MORE).toHaveLength(3);
  });

  it('keeps the reference order, with Word in place of the doors that were dropped', () => {
    expect(UPLOAD_DOORS_PRIMARY.map((door) => door.label)).toEqual([
      'Powerpoints',
      'PDF Documents',
      'Word Documents',
      'Import Quizlet',
      'YouTube Video',
      'Photos & Handwriting',
    ]);
    expect(UPLOAD_DOORS_MORE.map((door) => door.label)).toEqual([
      'Create Blank Notes',
      'No Material',
      'Paste Notes',
    ]);
  });

  it('gives every door something real to open', () => {
    for (const door of UPLOAD_DOORS) {
      expect(door.action, `${door.label} has no action`).toBeTruthy();
      expect(['import', 'record', 'noMaterial']).toContain(door.action.kind);
    }
  });

  it('draws nothing Lantern has no service for', () => {
    const labels = UPLOAD_DOORS.map((door) => door.label);
    // Audio and video FILE upload and Drive OAuth do not exist anywhere in
    // web; the lecture recorder has its own pill on the same page, and an
    // integration is a first-party feature with a consent screen, not a
    // button in a grid. See the PR's "Not replicated, and why".
    for (const dropped of ['Audio Files', 'Video Files', 'Google Drive']) {
      expect(labels).not.toContain(dropped);
    }
  });

  it('points the Word door at the docx import', () => {
    const word = UPLOAD_DOORS.find((door) => door.id === 'docx');
    expect(word?.action).toEqual({ kind: 'import', source: 'docx' });
  });

  it('has unique ids, because they key the React list', () => {
    expect(new Set(UPLOAD_DOORS.map((door) => door.id)).size).toBe(UPLOAD_DOORS.length);
  });
});

describe('what the dropzone accepts', () => {
  it('accepts only the types a handler exists for', () => {
    expect(UPLOAD_ACCEPT).toContain('application/pdf');
    expect(UPLOAD_ACCEPT).toContain('.pptx');
    expect(UPLOAD_ACCEPT).toContain('.docx');
    expect(UPLOAD_ACCEPT).toContain(DOCX_MIME);
    expect(UPLOAD_ACCEPT).toContain('image/*');
    // Legacy binary .doc is not a ZIP and nothing in the stack reads it.
    // Offering it would mean accepting a 25 MB upload only to refuse it.
    expect(UPLOAD_ACCEPT).not.toMatch(/(^|,)\.doc(?!x)/);
    // No audio or video: routeUploadFiles has nowhere to send them.
    expect(UPLOAD_ACCEPT).not.toContain('audio/');
    expect(UPLOAD_ACCEPT).not.toContain('video/');
  });
});

describe('routeUploadFiles', () => {
  it('sends a PDF to the PDF handler, by type or by extension', () => {
    expect(routeUploadFiles([file('lecture.pdf', 'application/pdf')]).kind).toBe('pdf');
    // Some browsers report an empty type for a dragged file.
    expect(routeUploadFiles([file('lecture.pdf', '')]).kind).toBe('pdf');
  });

  it('sends a deck to the presentation handler', () => {
    expect(routeUploadFiles([file('week1.pptx', '')]).kind).toBe('presentation');
    expect(
      routeUploadFiles([file('week1.ppt', 'application/vnd.ms-powerpoint')]).kind
    ).toBe('presentation');
  });

  it('sends a Word document to the document handler', () => {
    expect(routeUploadFiles([file('essay.docx', DOCX_MIME)]).kind).toBe('document');
    expect(routeUploadFiles([file('essay.docx', '')]).kind).toBe('document');
  });

  it('tells a student to re-save a legacy .doc BEFORE any bytes move', () => {
    const routed = routeUploadFiles([file('old.doc', 'application/msword')]);
    expect(routed.kind).toBe('unsupported');
    if (routed.kind === 'unsupported') expect(routed.message).toMatch(/save as \.docx/i);
  });

  it('batches photos, because a photographed handout is one note', () => {
    const routed = routeUploadFiles([
      file('p1.jpg', 'image/jpeg'),
      file('p2.jpg', 'image/jpeg'),
    ]);
    expect(routed.kind).toBe('images');
    if (routed.kind === 'images') expect(routed.files).toHaveLength(2);
  });

  it('takes the first file when a drop mixes kinds rather than silently dropping the rest', () => {
    const routed = routeUploadFiles([
      file('lecture.pdf', 'application/pdf'),
      file('p1.jpg', 'image/jpeg'),
    ]);
    expect(routed.kind).toBe('pdf');
  });

  it('names the file it cannot read instead of failing silently', () => {
    const routed = routeUploadFiles([file('recording.m4a', 'audio/mp4')]);
    expect(routed.kind).toBe('unsupported');
    if (routed.kind === 'unsupported') expect(routed.message).toContain('recording.m4a');
  });

  it('says so when nothing was chosen', () => {
    expect(routeUploadFiles([]).kind).toBe('unsupported');
  });

  it('reads a .txt or .md in the browser rather than uploading it', () => {
    expect(routeUploadFiles([file('notes.txt', 'text/plain')]).kind).toBe('text');
    // Most browsers give a `.md` no mime at all, so the NAME has to decide.
    expect(routeUploadFiles([file('chapter.md', '')]).kind).toBe('text');
    expect(routeUploadFiles([file('chapter.markdown', '')]).kind).toBe('text');
  });

  it('treats an iPhone photo as a photo even when the browser gives it no type', () => {
    // Chrome hands a .heic over with an EMPTY File.type; a type-only check sent
    // the commonest photograph on campus to "Lantern cannot read this".
    const routed = routeUploadFiles([file('IMG_0042.HEIC', '')]);
    expect(routed.kind).toBe('images');
    if (routed.kind === 'images') expect(routed.files).toHaveLength(1);
    expect(routeUploadFiles([file('IMG_0042.heic', 'image/heic')]).kind).toBe('images');
  });
});

describe('the accept list', () => {
  it('is the shared one, so the phone asks for the same set', () => {
    for (const fragment of ['.txt', '.md', '.heic', '.heif', '.docx', 'image/*']) {
      expect(UPLOAD_ACCEPT).toContain(fragment);
    }
  });
});

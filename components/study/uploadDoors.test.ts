/**
 * The door table and the drop router.
 *
 * What is pinned here is the rule the page cannot be trusted to keep on its
 * own: EVERY door is either live with an action or disabled with a reason.
 * A door that is `available` with no `action` is a live control that does
 * nothing — the exact pattern the declutter pass removed everywhere else — and
 * a door that is unavailable but still carries an action is one refactor away
 * from being re-enabled by accident.
 */
import { describe, expect, it } from 'vitest';

import {
  UPLOAD_ACCEPT,
  UPLOAD_DOORS,
  UPLOAD_DOORS_MORE,
  UPLOAD_DOORS_PRIMARY,
  routeUploadFiles,
} from './uploadDoors';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('the door table', () => {
  it('draws the reference grid: six primary doors, five behind More', () => {
    expect(UPLOAD_DOORS_PRIMARY).toHaveLength(6);
    expect(UPLOAD_DOORS_MORE).toHaveLength(5);
  });

  it('keeps the reference order and names', () => {
    expect(UPLOAD_DOORS_PRIMARY.map((door) => door.label)).toEqual([
      'Powerpoints',
      'PDF Documents',
      'Audio Files',
      'Video Files',
      'Import Quizlet',
      'YouTube Video',
    ]);
    expect(UPLOAD_DOORS_MORE.map((door) => door.label)).toEqual([
      'Create Blank Notes',
      'No Material',
      'Google Drive',
      'Handwritten Notes',
      'Paste Notes',
    ]);
  });

  it('gives every live door something to open, and every dead one a reason', () => {
    for (const door of UPLOAD_DOORS) {
      if (door.available) {
        expect(door.action, `${door.label} is live with no action`).toBeTruthy();
      } else {
        expect(door.action, `${door.label} is disabled but still acts`).toBeUndefined();
        expect(door.reason, `${door.label} is disabled with no reason`).toBeTruthy();
      }
    }
  });

  it('disables exactly the three Lantern has no service for', () => {
    const dead = UPLOAD_DOORS.filter((door) => !door.available).map((door) => door.label);
    // Audio and video FILE upload and Drive OAuth do not exist. YouTube,
    // Quizlet and handwriting DO (createNoteFromYoutube, the Anki/Quizlet
    // export paste, and the image upload), so they stay live.
    expect(dead).toEqual(['Audio Files', 'Video Files', 'Google Drive']);
  });

  it('has unique ids, because they key the React list and the reason element', () => {
    expect(new Set(UPLOAD_DOORS.map((door) => door.id)).size).toBe(UPLOAD_DOORS.length);
  });
});

describe('what the dropzone accepts', () => {
  it('accepts only the types a handler exists for', () => {
    expect(UPLOAD_ACCEPT).toContain('application/pdf');
    expect(UPLOAD_ACCEPT).toContain('.pptx');
    expect(UPLOAD_ACCEPT).toContain('image/*');
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
});

import {
  formatLectureTranscriptionEstimate,
  getLectureTranscriptionCost,
} from '@lantern/shared/utils/aiCredits';
import {
  lectureCapacityLine,
  maxLectureRecordingMinutes,
} from '@lantern/shared/utils/lectureAudio';
import {
  LECTURE_CONSENT_LINE,
  estimatedCostRow,
  lengthRow,
  screenRow,
  LECTURE_OFFLINE_QUEUEING,
  LEVEL_BAR_FLOOR_DB,
  connectionRow,
  levelBarFraction,
  levelRow,
  levelStateWord,
  micPermissionRow,
  planTitleAtStop,
  preflightRows,
  suggestedLectureTitle,
} from './lecturePreflight';
import { newLectureNoteTitle } from '../../screens/study/recorderDoor';

describe('micPermissionRow', () => {
  it('says the mic is allowed only when it is granted', () => {
    expect(micPermissionRow('granted')).toMatchObject({ state: 'Allowed', tone: 'ok' });
    expect(micPermissionRow('granted').action).toBeUndefined();
  });

  it('gives the exact next step when the mic is denied', () => {
    const row = micPermissionRow('denied');
    expect(row.tone).toBe('blocked');
    expect(row.action).toEqual({ label: 'Open settings', kind: 'open-settings' });
    expect(row.detail).toMatch(/phone settings/i);
  });

  it('does not pretend the mic is fine before it has been asked for', () => {
    const row = micPermissionRow('undetermined');
    expect(row.tone).toBe('unknown');
    expect(row.state).toBe('Not asked yet');
  });

  it('has a reading-in-progress state rather than an optimistic default', () => {
    expect(micPermissionRow('unknown')).toMatchObject({ state: 'Checking', tone: 'unknown' });
  });
});

describe('levelStateWord', () => {
  it('returns null with no reading, so no word is invented', () => {
    expect(levelStateWord(null)).toBeNull();
    expect(levelStateWord(undefined)).toBeNull();
    expect(levelStateWord(Number.NaN)).toBeNull();
    expect(levelStateWord(-Infinity)).toBeNull();
  });

  it('reads Silent at and below -45 dB', () => {
    expect(levelStateWord(-160)).toBe('Silent');
    expect(levelStateWord(-45)).toBe('Silent');
  });

  it('reads Quiet between -45 and -30 dB', () => {
    expect(levelStateWord(-44.9)).toBe('Quiet');
    expect(levelStateWord(-30)).toBe('Quiet');
  });

  it('reads Good between -30 and -8 dB', () => {
    expect(levelStateWord(-29.9)).toBe('Good');
    expect(levelStateWord(-20)).toBe('Good');
    expect(levelStateWord(-8.1)).toBe('Good');
  });

  it('reads Loud at and above -8 dB', () => {
    expect(levelStateWord(-8)).toBe('Loud');
    expect(levelStateWord(0)).toBe('Loud');
  });
});

describe('levelBarFraction', () => {
  it('draws an empty bar with no reading', () => {
    expect(levelBarFraction(null)).toBe(0);
    expect(levelBarFraction(undefined)).toBe(0);
    expect(levelBarFraction(Number.NaN)).toBe(0);
  });

  it('clamps to 0..1 across the drawn span', () => {
    expect(levelBarFraction(LEVEL_BAR_FLOOR_DB)).toBe(0);
    expect(levelBarFraction(-200)).toBe(0);
    expect(levelBarFraction(0)).toBe(1);
    expect(levelBarFraction(12)).toBe(1);
  });

  it('is linear in between', () => {
    expect(levelBarFraction(-30)).toBeCloseTo(0.5, 5);
  });
});

describe('levelRow', () => {
  it('says "No signal yet" until a reading arrives', () => {
    expect(levelRow(null)).toMatchObject({ state: 'No signal yet', tone: 'unknown' });
  });

  it('only calls the level good when it is good', () => {
    expect(levelRow(-20)).toMatchObject({ state: 'Good', tone: 'ok' });
    expect(levelRow(-50).tone).toBe('warn');
    expect(levelRow(-2).tone).toBe('warn');
  });
});

describe('connectionRow', () => {
  it('is plain about the offline reality this build actually has', () => {
    // A retry is a tap, not a queue: nothing uploads on its own when the
    // phone comes back. The row may promise the audio is kept — it is now —
    // but it must not promise a later transcription nobody schedules.
    expect(LECTURE_OFFLINE_QUEUEING).toBe(false);
    const row = connectionRow(false);
    expect(row.state).toBe('Offline');
    expect(row.detail).not.toMatch(/we transcribe (it )?later/i);
    expect(row.detail).toMatch(/we keep the audio/i);
    expect(row.detail).toMatch(/Retry/);
  });

  it('promises later transcription only when queueing really exists', () => {
    expect(connectionRow(false, true).detail).toMatch(/transcribe when you are back online/i);
  });

  it('reports online plainly', () => {
    expect(connectionRow(true)).toMatchObject({ state: 'Online', tone: 'ok' });
  });
});

describe('preflightRows', () => {
  it('is the six rows, in order', () => {
    const rows = preflightRows({ micPermission: 'granted', meterDb: null, isOnline: true });
    expect(rows.map((r) => r.label)).toEqual([
      'Microphone',
      'Level',
      'Cost',
      'Length',
      'Screen',
      'Connection',
    ]);
  });

  it('prices the recording it has actually been given', () => {
    const rows = preflightRows({
      micPermission: 'granted',
      meterDb: -20,
      isOnline: true,
      elapsedMs: 20 * 60_000,
    });
    expect(rows[2].state).toBe(formatLectureTranscriptionEstimate(20 * 60_000));
  });

  it('shows no level word while the mic is blocked and nothing has been read', () => {
    const rows = preflightRows({ micPermission: 'denied', meterDb: null, isOnline: true });
    expect(rows[1].state).toBe('No signal yet');
  });
});

describe('consent line', () => {
  it('is one plain sentence', () => {
    expect(LECTURE_CONSENT_LINE).toBe(
      'Recording is stored in your note; ask before recording other people.'
    );
  });
});

describe('suggestedLectureTitle', () => {
  const now = new Date(2026, 8, 6);

  it('uses the date title when the note still carries a placeholder', () => {
    expect(suggestedLectureTitle('', now)).toBe(newLectureNoteTitle(now));
    expect(suggestedLectureTitle('Untitled note', now)).toBe(newLectureNoteTitle(now));
    expect(suggestedLectureTitle('  ', now)).toBe(newLectureNoteTitle(now));
  });

  it('keeps a name the student already chose', () => {
    expect(suggestedLectureTitle('Pharmacology week 3', now)).toBe('Pharmacology week 3');
  });
});

describe('planTitleAtStop', () => {
  const now = new Date(2026, 8, 6);

  it('keeps the suggestion on one tap (nothing typed)', () => {
    const plan = planTitleAtStop({ currentTitle: 'Untitled note', now });
    expect(plan.suggestion).toBe(newLectureNoteTitle(now));
    expect(plan.nextTitle).toBe(newLectureNoteTitle(now));
    expect(plan.shouldRename).toBe(true);
  });

  it('treats whitespace as nothing typed', () => {
    const plan = planTitleAtStop({ currentTitle: 'Untitled note', typedTitle: '   ', now });
    expect(plan.nextTitle).toBe(newLectureNoteTitle(now));
  });

  it('takes a typed title and trims it', () => {
    const plan = planTitleAtStop({ currentTitle: 'Untitled note', typedTitle: '  Anatomy  ', now });
    expect(plan.nextTitle).toBe('Anatomy');
    expect(plan.shouldRename).toBe(true);
  });

  it('writes nothing when the title does not change', () => {
    const plan = planTitleAtStop({ currentTitle: 'Anatomy', typedTitle: 'Anatomy', now });
    expect(plan.shouldRename).toBe(false);
    expect(plan.nextTitle).toBe('Anatomy');
  });

  it('does not rename an already-named note that the student left alone', () => {
    const plan = planTitleAtStop({ currentTitle: 'Anatomy', now });
    expect(plan.suggestion).toBe('Anatomy');
    expect(plan.shouldRename).toBe(false);
  });

  it('caps a very long title', () => {
    const plan = planTitleAtStop({ currentTitle: '', typedTitle: 'x'.repeat(500), now });
    expect(plan.nextTitle).toHaveLength(120);
  });
});

describe('estimatedCostRow', () => {
  it('quotes the price for the length recorded so far, from the shared costing', () => {
    for (const minutes of [0, 1, 15, 16, 45]) {
      const ms = minutes * 60_000;
      expect(estimatedCostRow(ms).state).toBe(formatLectureTranscriptionEstimate(ms));
    }
  });

  it('moves when the recording crosses a block boundary', () => {
    expect(getLectureTranscriptionCost(15 * 60_000)).toBe(1);
    expect(estimatedCostRow(15 * 60_000).state).not.toBe(
      estimatedCostRow(16 * 60_000).state
    );
  });

  it('says the rule under the figure, so the number is explained not just shown', () => {
    expect(estimatedCostRow(0).detail).toMatch(/15 minutes/);
  });

  it('is an estimate, and says so', () => {
    expect(estimatedCostRow(0).state).toMatch(/^About /);
  });
});

describe('lengthRow', () => {
  const capMinutes = maxLectureRecordingMinutes();

  it('prints the derived capacity, never a typed minute figure', () => {
    expect(lengthRow(0).detail).toContain(lectureCapacityLine());
  });

  it('is calm for an ordinary lecture', () => {
    expect(lengthRow(45 * 60_000)).toMatchObject({ state: 'Room to spare', tone: 'ok' });
  });

  it('warns before the recording is unusable, not after', () => {
    const nearlyFull = Math.round(capMinutes * 0.9) * 60_000;
    const row = lengthRow(nearlyFull);
    expect(row.tone).toBe('warn');
    expect(row.state).toMatch(/min left$/);
  });

  it('blocks at the point the upload would be refused', () => {
    const row = lengthRow((capMinutes + 5) * 60_000);
    expect(row.tone).toBe('blocked');
    expect(row.state).toBe('Full');
    expect(row.detail).toMatch(/Stop now/);
  });
});

describe('screenRow', () => {
  it('promises the screen-off guarantee only where the service exists', () => {
    const withService = screenRow(true);
    expect(withService.tone).toBe('ok');
    expect(withService.detail).toMatch(/switch it off/i);
  });

  it('warns instead of promising on a build without it', () => {
    const without = screenRow(false);
    expect(without.tone).toBe('warn');
    expect(without.detail).toMatch(/can stop the recording/i);
  });

  it('says the screen stays on either way — that part is always true', () => {
    expect(screenRow(true).state).toBe('Stays on');
    expect(screenRow(false).state).toBe('Stays on');
  });
});

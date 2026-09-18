import {
  LECTURE_SEGMENT_MS,
  cumulativeLectureCost,
  formatLectureSegmentStamp,
  insertLectureSegmentLine,
  latestLectureSessionId,
  lectureSegmentCreditCost,
  lectureSegmentFileName,
  lectureSegmentKey,
  lectureSegmentLabel,
  lectureSegmentMeta,
  lectureSegmentRows,
  lectureSegmentTranscriptLine,
  lectureSegmentsSummaryLine,
  lectureSegmentsTotalCost,
  nextLectureSegmentSeq,
  planLectureSegments,
  priorRecordedMs,
  recordedMsFromSegments,
  resolveLectureResume,
  shouldRotateLectureSegment,
  sortLectureSegments,
} from './lectureSegments';
import { getLectureTranscriptionCost } from './aiCredits';

const MIN = 60_000;

describe('planLectureSegments', () => {
  it('is empty for a take that recorded nothing', () => {
    expect(planLectureSegments(0)).toEqual([]);
    expect(planLectureSegments(-1)).toEqual([]);
    expect(planLectureSegments(Number.NaN)).toEqual([]);
  });

  it('keeps a take shorter than one segment in one piece', () => {
    expect(planLectureSegments(90_000)).toEqual([
      { seq: 1, startOffsetMs: 0, durationMs: 90_000 },
    ]);
  });

  it('rotates every five minutes and leaves the tail short', () => {
    const plan = planLectureSegments(12 * MIN);
    expect(plan).toEqual([
      { seq: 1, startOffsetMs: 0, durationMs: LECTURE_SEGMENT_MS },
      { seq: 2, startOffsetMs: 5 * MIN, durationMs: LECTURE_SEGMENT_MS },
      { seq: 3, startOffsetMs: 10 * MIN, durationMs: 2 * MIN },
    ]);
  });

  it('does not grow an empty tail on an exact boundary', () => {
    const plan = planLectureSegments(10 * MIN);
    expect(plan).toHaveLength(2);
    expect(plan[1]).toEqual({ seq: 2, startOffsetMs: 5 * MIN, durationMs: LECTURE_SEGMENT_MS });
  });

  it('covers the take with no gaps and no overlaps', () => {
    for (const totalMs of [1_000, 47 * MIN, 99 * MIN, 5 * MIN + 1]) {
      const plan = planLectureSegments(totalMs);
      let cursor = 0;
      for (const item of plan) {
        expect(item.startOffsetMs).toBe(cursor);
        cursor += item.durationMs;
      }
      expect(cursor).toBe(totalMs);
      expect(plan.map((row) => row.seq)).toEqual(plan.map((_, index) => index + 1));
    }
  });

  it('rotates only once the open segment has run its full length', () => {
    expect(shouldRotateLectureSegment(LECTURE_SEGMENT_MS - 1)).toBe(false);
    expect(shouldRotateLectureSegment(LECTURE_SEGMENT_MS)).toBe(true);
    expect(shouldRotateLectureSegment(Number.NaN)).toBe(false);
  });
});

describe('pricing', () => {
  it('has cost nothing before anything is recorded', () => {
    expect(cumulativeLectureCost(0)).toBe(0);
    expect(cumulativeLectureCost(-5)).toBe(0);
    // ...unlike a REQUEST, which always costs at least one.
    expect(getLectureTranscriptionCost(0)).toBe(1);
  });

  it('charges the first segment of a take', () => {
    expect(lectureSegmentCreditCost(0, 5 * MIN)).toBe(1);
  });

  it('charges nothing for a segment inside a block already paid for', () => {
    expect(lectureSegmentCreditCost(5 * MIN, 5 * MIN)).toBe(0);
    expect(lectureSegmentCreditCost(10 * MIN, 5 * MIN)).toBe(0);
  });

  it('charges the segment that opens the next block', () => {
    expect(lectureSegmentCreditCost(15 * MIN, 5 * MIN)).toBe(1);
    expect(lectureSegmentCreditCost(30 * MIN, 5 * MIN)).toBe(1);
  });

  it('never charges for a segment of no length', () => {
    expect(lectureSegmentCreditCost(20 * MIN, 0)).toBe(0);
    expect(lectureSegmentCreditCost(20 * MIN, Number.NaN)).toBe(0);
  });

  it('never goes negative when a clock moves backwards', () => {
    expect(lectureSegmentCreditCost(-10 * MIN, 5 * MIN)).toBe(1);
    expect(lectureSegmentCreditCost(40 * MIN, -1)).toBe(0);
  });

  /**
   * THE proof. If this ever fails, students are being charged for resilience.
   */
  it('costs exactly what the same lecture in one take costs — 47 minutes', () => {
    const durations = planLectureSegments(47 * MIN).map((row) => row.durationMs);
    expect(durations).toHaveLength(10);
    expect(lectureSegmentsTotalCost(durations)).toBe(getLectureTranscriptionCost(47 * MIN));
    expect(lectureSegmentsTotalCost(durations)).toBe(4);
    // The naive per-segment charge is what this replaces.
    const naive = durations.reduce((sum, ms) => sum + getLectureTranscriptionCost(ms), 0);
    expect(naive).toBe(10);
  });

  it('costs exactly the one-take price at every minute up to the cap', () => {
    for (let minutes = 1; minutes <= 180; minutes += 1) {
      const totalMs = minutes * MIN;
      const durations = planLectureSegments(totalMs).map((row) => row.durationMs);
      expect(lectureSegmentsTotalCost(durations)).toBe(getLectureTranscriptionCost(totalMs));
    }
  });

  it('costs the one-take price for uneven segments too (pause, rotate, stop)', () => {
    const durations = [4 * MIN, 5 * MIN, 90_000, 5 * MIN, 5 * MIN, 30_000];
    const total = durations.reduce((sum, ms) => sum + ms, 0);
    expect(lectureSegmentsTotalCost(durations)).toBe(getLectureTranscriptionCost(total));
  });

  it('stays inside the per-request cap on an absurdly long take', () => {
    const durations = planLectureSegments(6 * 60 * MIN).map((row) => row.durationMs);
    expect(lectureSegmentsTotalCost(durations)).toBe(getLectureTranscriptionCost(6 * 60 * MIN));
    expect(lectureSegmentsTotalCost(durations)).toBeLessThanOrEqual(10);
  });
});

describe('stamps', () => {
  it('reads as the recorder clock under an hour', () => {
    expect(formatLectureSegmentStamp(0)).toBe('0:00');
    expect(formatLectureSegmentStamp(5 * MIN)).toBe('5:00');
    expect(formatLectureSegmentStamp(45 * MIN + 7_000)).toBe('45:07');
  });

  it('switches to h:mm:ss so a long transcript stays parseable', () => {
    expect(formatLectureSegmentStamp(60 * MIN)).toBe('1:00:00');
    expect(formatLectureSegmentStamp(65 * MIN + 4_000)).toBe('1:05:04');
  });

  it('treats a nonsense offset as the start', () => {
    expect(formatLectureSegmentStamp(-1)).toBe('0:00');
    expect(formatLectureSegmentStamp(Number.NaN)).toBe('0:00');
  });

  it('writes a stamped line, and nothing at all for empty text', () => {
    expect(lectureSegmentTranscriptLine(5 * MIN, '  Mitochondria.  ')).toBe('[5:00] Mitochondria.');
    expect(lectureSegmentTranscriptLine(5 * MIN, '   ')).toBe('');
  });
});

describe('insertLectureSegmentLine', () => {
  it('starts the transcript when there is nothing yet', () => {
    expect(insertLectureSegmentLine('', 0, 'One.')).toBe('[0:00] One.');
    expect(insertLectureSegmentLine('   ', 0, 'One.')).toBe('[0:00] One.');
  });

  it('appends a segment that comes after everything written', () => {
    const body = insertLectureSegmentLine('[0:00] One.', 5 * MIN, 'Two.');
    expect(body).toBe('[0:00] One.\n\n[5:00] Two.');
  });

  it('puts a retried segment back in recorded order', () => {
    let body = '[0:00] One.';
    body = insertLectureSegmentLine(body, 10 * MIN, 'Three.');
    body = insertLectureSegmentLine(body, 15 * MIN, 'Four.');
    // Segment 2 failed at the time and is retried last.
    body = insertLectureSegmentLine(body, 5 * MIN, 'Two.');
    expect(body).toBe('[0:00] One.\n\n[5:00] Two.\n\n[10:00] Three.\n\n[15:00] Four.');
  });

  it('replaces rather than duplicates a segment sent twice', () => {
    let body = insertLectureSegmentLine('', 0, 'One.');
    body = insertLectureSegmentLine(body, 5 * MIN, 'Two.');
    body = insertLectureSegmentLine(body, 5 * MIN, 'Two, corrected.');
    expect(body).toBe('[0:00] One.\n\n[5:00] Two, corrected.');
    expect(body.match(/\[5:00\]/g)).toHaveLength(1);
  });

  it('leaves unstamped prose the student typed where it is', () => {
    const body = insertLectureSegmentLine('Some heading\n\n[0:00] One.', 5 * MIN, 'Two.');
    expect(body).toBe('Some heading\n\n[0:00] One.\n\n[5:00] Two.');
  });

  it('orders past an hour, where the stamp shape changes', () => {
    let body = insertLectureSegmentLine('', 60 * MIN, 'Hour one.');
    body = insertLectureSegmentLine(body, 55 * MIN, 'Before it.');
    expect(body).toBe('[55:00] Before it.\n\n[1:00:00] Hour one.');
  });

  it('changes nothing for an empty segment transcript', () => {
    expect(insertLectureSegmentLine('[0:00] One.', 5 * MIN, '')).toBe('[0:00] One.');
  });
});

describe('the row shape', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'att-1',
    type: 'audio',
    fileName: 'lecture-n1-1.webm',
    extractedText: 'One.',
    createdAt: '2026-09-18T09:00:00.000Z',
    metadata: {
      storagePath: 'u1/lecture-n1-1.webm',
      lectureSegment: {
        sessionId: 'sA',
        seq: 1,
        startOffsetMs: 0,
        durationMs: 5 * MIN,
        status: 'done',
      },
      ...over,
    },
  });

  it('reads a well-formed segment', () => {
    expect(lectureSegmentMeta(row())).toEqual({
      sessionId: 'sA',
      seq: 1,
      startOffsetMs: 0,
      durationMs: 5 * MIN,
      status: 'done',
    });
  });

  it('is not a segment when the block is absent, partial or not audio', () => {
    expect(lectureSegmentMeta(null)).toBeNull();
    expect(lectureSegmentMeta({ type: 'audio', metadata: {} })).toBeNull();
    expect(lectureSegmentMeta({ ...row(), type: 'pdf' })).toBeNull();
    expect(lectureSegmentMeta(row({ lectureSegment: { sessionId: '', seq: 1, startOffsetMs: 0, durationMs: 1 } }))).toBeNull();
    expect(lectureSegmentMeta(row({ lectureSegment: { sessionId: 'sA', seq: 0, startOffsetMs: 0, durationMs: 1 } }))).toBeNull();
    expect(lectureSegmentMeta(row({ lectureSegment: { sessionId: 'sA', seq: 1, startOffsetMs: -1, durationMs: 1 } }))).toBeNull();
  });

  it('treats an unknown status as pending rather than done', () => {
    const meta = lectureSegmentMeta(
      row({ lectureSegment: { sessionId: 'sA', seq: 1, startOffsetMs: 0, durationMs: 1, status: 'wat' } })
    );
    expect(meta?.status).toBe('pending');
  });

  it('leaves an old single-take recording alone', () => {
    const legacy = { id: 'a', type: 'audio', metadata: { storagePath: 'u1/lecture-1.webm' } };
    expect(lectureSegmentMeta(legacy)).toBeNull();
    expect(lectureSegmentRows([legacy])).toEqual([]);
  });

  it('sorts a note’s segments into recorded order', () => {
    const rows = lectureSegmentRows([
      row({ lectureSegment: { sessionId: 'sA', seq: 3, startOffsetMs: 10 * MIN, durationMs: MIN, status: 'done' } }),
      row({ lectureSegment: { sessionId: 'sA', seq: 1, startOffsetMs: 0, durationMs: 5 * MIN, status: 'done' } }),
      row({ lectureSegment: { sessionId: 'sA', seq: 2, startOffsetMs: 5 * MIN, durationMs: 5 * MIN, status: 'pending' } }),
    ]);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it('keeps two takes apart', () => {
    const rows = sortLectureSegments([
      { sessionId: 'sB', seq: 1, startOffsetMs: 0 },
      { sessionId: 'sA', seq: 2, startOffsetMs: 5 * MIN },
      { sessionId: 'sA', seq: 1, startOffsetMs: 0 },
    ]);
    expect(rows.map((r) => `${r.sessionId}#${r.seq}`)).toEqual(['sA#1', 'sA#2', 'sB#1']);
    expect(latestLectureSessionId(lectureSegmentRows([]))).toBeNull();
  });
});

describe('sequencing and the resume clock', () => {
  const seg = (sessionId: string, seq: number, startOffsetMs: number, over: Partial<Record<string, unknown>> = {}) =>
    ({
      sessionId,
      seq,
      startOffsetMs,
      durationMs: 5 * MIN,
      status: 'done' as const,
      transcript: 'text',
      ...over,
    }) as Parameters<typeof resolveLectureResume>[0]['rows'][number];

  it('continues the sequence, never reusing a number', () => {
    expect(nextLectureSegmentSeq([])).toBe(1);
    expect(nextLectureSegmentSeq([{ seq: 1 }, { seq: 2 }, { seq: 3 }])).toBe(4);
    // A gap (a segment whose upload never landed) still advances.
    expect(nextLectureSegmentSeq([{ seq: 1 }, { seq: 4 }])).toBe(5);
  });

  it('restores the clock from the far end of the last segment', () => {
    expect(recordedMsFromSegments([])).toBe(0);
    expect(
      recordedMsFromSegments([
        { startOffsetMs: 0, durationMs: 5 * MIN },
        { startOffsetMs: 5 * MIN, durationMs: 2 * MIN },
      ])
    ).toBe(7 * MIN);
  });

  it('prices a segment against its own take only, and only what came before', () => {
    const rows = [
      { sessionId: 'sA', seq: 1, durationMs: 5 * MIN },
      { sessionId: 'sA', seq: 2, durationMs: 5 * MIN },
      { sessionId: 'sB', seq: 1, durationMs: 40 * MIN },
    ];
    expect(priorRecordedMs(rows, 'sA', 3)).toBe(10 * MIN);
    expect(priorRecordedMs(rows, 'sA', 2)).toBe(5 * MIN);
    expect(priorRecordedMs(rows, 'sA', 1)).toBe(0);
    expect(priorRecordedMs(rows, 'sB', 1)).toBe(0);
  });

  it('offers nothing when the note has no segments', () => {
    expect(resolveLectureResume({ rows: [] })).toEqual({ action: 'none' });
  });

  it('resumes the take this device is still recording', () => {
    const decision = resolveLectureResume({
      rows: [seg('sA', 1, 0), seg('sA', 2, 5 * MIN, { status: 'pending', transcript: '' })],
      activeSessionId: 'sA',
    });
    expect(decision).toEqual({
      action: 'resume',
      sessionId: 'sA',
      nextSeq: 3,
      recordedMs: 10 * MIN,
      untranscribed: 1,
    });
  });

  it('offers recovery for an interrupted take with work outstanding', () => {
    const decision = resolveLectureResume({
      rows: [seg('sA', 1, 0), seg('sA', 2, 5 * MIN, { status: 'failed' })],
    });
    expect(decision).toEqual({
      action: 'recover',
      sessionId: 'sA',
      nextSeq: 3,
      recordedMs: 10 * MIN,
      untranscribed: 1,
    });
  });

  it('offers nothing for a take that finished cleanly', () => {
    expect(
      resolveLectureResume({ rows: [seg('sA', 1, 0), seg('sA', 2, 5 * MIN)] })
    ).toEqual({ action: 'none' });
  });

  it('only ever looks at the newest take', () => {
    const decision = resolveLectureResume({
      rows: [seg('sA', 1, 0, { status: 'failed' }), seg('sB', 1, 0)],
    });
    expect(decision).toEqual({ action: 'none' });
  });
});

describe('keys, names and copy', () => {
  it('identifies a segment by note, take and place', () => {
    expect(lectureSegmentKey('n1', 'sA', 3)).toBe('n1:sA:3');
  });

  it('builds a file name a student can recognise, with no path in it', () => {
    expect(lectureSegmentFileName('n1', 2, 'webm')).toBe('lecture-n1-2.webm');
    expect(lectureSegmentFileName('n1', 2, 'M4A')).toBe('lecture-n1-2.m4a');
    expect(lectureSegmentFileName('n1', 2, '../../etc')).toBe('lecture-n1-2.etc');
    expect(lectureSegmentFileName('n1', 2, '')).toBe('lecture-n1-2.webm');
  });

  it('labels a row with the span it covers', () => {
    expect(lectureSegmentLabel({ seq: 2, startOffsetMs: 5 * MIN, durationMs: 5 * MIN })).toBe(
      'Segment 2 · 5:00–10:00'
    );
  });

  it('counts the segments and dates them from the first one', () => {
    expect(lectureSegmentsSummaryLine([{ createdAt: '2026-09-18T09:00:00.000Z' }])).toBe(
      '1 segment recorded on 18 Sep 2026'
    );
    expect(
      lectureSegmentsSummaryLine([
        { createdAt: '2026-09-18T09:00:00.000Z' },
        { createdAt: '2026-09-18T09:05:00.000Z' },
      ])
    ).toBe('2 segments recorded on 18 Sep 2026');
  });

  it('falls back to today when a row carries no date', () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    expect(lectureSegmentsSummaryLine([{}], now)).toContain('Jan 2026');
  });
});

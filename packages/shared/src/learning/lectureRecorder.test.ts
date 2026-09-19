import {
  LECTURE_CHUNK_PAUSE_MS,
  applyLectureSegmentToChunks,
  growLectureChunks,
  initialLectureDrawer,
  lectureChunkStampMs,
  lectureDrawerIsLive,
  lectureDrawerReducer,
  lectureTabPillLabels,
  sealLectureChunks,
  type LectureDrawerEvent,
  type LectureDrawerModel,
} from './lectureRecorder';

function run(state: LectureDrawerModel, events: LectureDrawerEvent[]): LectureDrawerModel {
  return events.reduce(lectureDrawerReducer, state);
}

describe('lecture drawer state machine', () => {
  it('walks pre-check → consent → recording → saving → done', () => {
    const state = run(initialLectureDrawer(), [
      { type: 'open' },
      { type: 'start-pressed' },
    ]);
    expect(state.step).toBe('consent');

    const recording = lectureDrawerReducer(state, { type: 'consent-granted' });
    expect(recording.step).toBe('recording');
    expect(recording.consentRemembered).toBe(true);
    expect(lectureDrawerIsLive(recording)).toBe(true);

    const saving = lectureDrawerReducer(recording, { type: 'stop' });
    expect(saving.step).toBe('saving');

    const done = lectureDrawerReducer(saving, { type: 'saved' });
    expect(done.step).toBe('done');
    expect(lectureDrawerIsLive(done)).toBe(false);
  });

  it('remembers consent, so the next take starts recording straight away', () => {
    const remembered = initialLectureDrawer({ consentRemembered: true, open: true });
    expect(lectureDrawerReducer(remembered, { type: 'start-pressed' }).step).toBe('recording');
  });

  it('declining consent goes back to the pre-check and records nothing', () => {
    const asked = run(initialLectureDrawer(), [{ type: 'open' }, { type: 'start-pressed' }]);
    const declined = lectureDrawerReducer(asked, { type: 'consent-declined' });
    expect(declined.step).toBe('precheck');
    expect(declined.consentRemembered).toBe(false);
  });

  it('minimises and expands only while recording, and always expands on stop', () => {
    const recording = run(initialLectureDrawer({ consentRemembered: true }), [
      { type: 'open' },
      { type: 'start-pressed' },
    ]);
    const minimised = lectureDrawerReducer(recording, { type: 'minimise' });
    expect(minimised.minimised).toBe(true);
    expect(lectureDrawerReducer(minimised, { type: 'expand' }).minimised).toBe(false);

    // The saving copy has nowhere to live on a 120×56 widget.
    expect(lectureDrawerReducer(minimised, { type: 'stop' }).minimised).toBe(false);

    const done = run(recording, [{ type: 'stop' }, { type: 'saved' }]);
    expect(lectureDrawerReducer(done, { type: 'minimise' })).toBe(done);
  });

  it('closing a running take minimises it instead of dropping the transcript', () => {
    const recording = run(initialLectureDrawer({ consentRemembered: true }), [
      { type: 'open' },
      { type: 'start-pressed' },
    ]);
    const closed = lectureDrawerReducer(recording, { type: 'close' });
    expect(closed.open).toBe(true);
    expect(closed.minimised).toBe(true);

    const idle = lectureDrawerReducer(initialLectureDrawer({ open: true }), { type: 'close' });
    expect(idle.open).toBe(false);
  });

  it('resumes from done back into the same take', () => {
    const done = run(initialLectureDrawer({ consentRemembered: true }), [
      { type: 'open' },
      { type: 'start-pressed' },
      { type: 'stop' },
      { type: 'saved' },
    ]);
    expect(lectureDrawerReducer(done, { type: 'resume' }).step).toBe('recording');
    // Resume is only offered from done: a pre-check cannot jump into a take.
    expect(lectureDrawerReducer(initialLectureDrawer(), { type: 'resume' }).step).toBe('precheck');
  });
});

describe('tab pill labels', () => {
  it('reads Record until a take runs, then Transcript', () => {
    const idle = lectureTabPillLabels({ recording: false, enhancing: false, hasEnhanced: false });
    expect(idle.map((row) => row.id)).toEqual([
      'notes',
      'enhanced',
      'materials',
      'audio',
      'record',
    ]);
    expect(idle[4].label).toBe('🎙 Record');
    expect(idle[4].emphasis).toBe('ink');

    const live = lectureTabPillLabels({ recording: true, enhancing: false, hasEnhanced: false });
    expect(live[4].label).toBe('≡ Transcript');
  });

  it('greys Enhanced Notes until notes exist, and spins only while enhancing', () => {
    const empty = lectureTabPillLabels({ recording: false, enhancing: false, hasEnhanced: false });
    expect(empty[1].disabled).toBe(true);
    expect(empty[1].hint).toBeTruthy();

    const busy = lectureTabPillLabels({ recording: false, enhancing: true, hasEnhanced: false });
    expect(busy[1].label).toBe('⟳ Generating…');
    expect(busy[1].disabled).toBe(false);

    // The reference's bug: a failed enhance left the tab spinning. Here the
    // label is a function of `enhancing`, so clearing it restores the word.
    const failed = lectureTabPillLabels({ recording: false, enhancing: false, hasEnhanced: false });
    expect(failed[1].label).toBe('Enhanced Notes');
  });
});

describe('transcript chunks', () => {
  it('grows one chunk in place while speech continues', () => {
    let chunks = growLectureChunks({ chunks: [], text: 'The', atMs: 6_000 });
    chunks = growLectureChunks({ chunks, text: 'The mitochondrion', atMs: 7_000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('The mitochondrion');
    expect(chunks[0].startMs).toBe(6_000);
    expect(chunks[0].endMs).toBe(7_000);
  });

  it('starts a new chunk after a pause of two seconds', () => {
    let chunks = growLectureChunks({ chunks: [], text: 'One', atMs: 1_000 });
    chunks = growLectureChunks({
      chunks,
      text: 'Two',
      atMs: 1_000 + LECTURE_CHUNK_PAUSE_MS,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[1].startMs).toBe(3_000);
  });

  it('starts a new chunk at a segment boundary however short the gap', () => {
    let chunks = growLectureChunks({ chunks: [], text: 'One', atMs: 1_000 });
    chunks = growLectureChunks({ chunks, text: 'Two', atMs: 1_100, boundary: true });
    expect(chunks).toHaveLength(2);
  });

  it('replaces the captions of a span with the segment transcript, once', () => {
    let chunks = growLectureChunks({ chunks: [], text: 'roughly what was said', atMs: 10_000 });
    chunks = applyLectureSegmentToChunks({
      chunks,
      seq: 1,
      startOffsetMs: 0,
      durationMs: 300_000,
      text: 'Exactly what was said.',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].source).toBe('segment');
    expect(chunks[0].text).toBe('Exactly what was said.');

    // A retry of the same segment rewrites its card rather than adding one.
    chunks = applyLectureSegmentToChunks({
      chunks,
      seq: 1,
      startOffsetMs: 0,
      durationMs: 300_000,
      text: 'Exactly what was said, second time.',
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Exactly what was said, second time.');
  });

  it('keeps segments in recorded order when one lands late', () => {
    let chunks = applyLectureSegmentToChunks({
      chunks: [],
      seq: 2,
      startOffsetMs: 300_000,
      durationMs: 300_000,
      text: 'second',
    });
    chunks = applyLectureSegmentToChunks({
      chunks,
      seq: 1,
      startOffsetMs: 0,
      durationMs: 300_000,
      text: 'first',
    });
    expect(chunks.map((row) => row.text)).toEqual(['first', 'second']);
  });

  it('stamps from the start while live and from the end once saved', () => {
    const chunks = sealLectureChunks(
      growLectureChunks({ chunks: [], text: 'words', atMs: 108_000 })
    );
    expect(lectureChunkStampMs(chunks[0], false)).toBe(108_000);
    expect(lectureChunkStampMs(chunks[0], true)).toBe(108_000);

    // A chunk that grew for a while is stamped where it ENDED once saved, and
    // where it started while the take was still running.
    const grown = growLectureChunks({
      chunks: growLectureChunks({ chunks: [], text: 'a', atMs: 100_000 }),
      text: 'a b',
      atMs: 101_500,
    });
    expect(grown).toHaveLength(1);
    expect(lectureChunkStampMs(sealLectureChunks(grown)[0], true)).toBe(101_500);
    expect(lectureChunkStampMs(grown[0], false)).toBe(100_000);
  });
});

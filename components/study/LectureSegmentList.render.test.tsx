import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LectureAudioSegments, LectureTranscriptSegments } from './LectureSegmentList';
import type { LectureSegmentUi } from '../../stores/lectureRecordingStore';

/**
 * What the two segment lists must SAY, not how they look.
 *
 * The three sentences that carry the feature: a stamped card per five minutes,
 * "Listening…" only under the segment still open, and — on a card that failed —
 * that the audio is already saved, with a Retry that belongs to that card
 * alone. A student who reads "this part did not transcribe" and cannot tell
 * whether the recording survived has been told nothing useful.
 */
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const visibleText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const MIN = 60_000;

const segment = (over: Partial<LectureSegmentUi> & { seq: number }): LectureSegmentUi => ({
  startOffsetMs: (over.seq - 1) * 5 * MIN,
  durationMs: 5 * MIN,
  stamp: over.stamp ?? `${(over.seq - 1) * 5}:00`,
  status: 'done',
  transcript: `part ${over.seq}`,
  ...over,
});

describe('the live transcript list', () => {
  it('shows one stamped card per segment, in recorded order', () => {
    const html = render(
      <LectureTranscriptSegments
        segments={[segment({ seq: 1 }), segment({ seq: 2 }), segment({ seq: 3 })]}
        onRetry={vi.fn()}
      />
    );
    const text = visibleText(html);
    expect(text).toContain('0:00');
    expect(text).toContain('5:00');
    expect(text).toContain('10:00');
    expect(text).toContain('part 1');
    expect(text.indexOf('part 1')).toBeLessThan(text.indexOf('part 3'));
  });

  it('shows "Listening…" only while a take is running', () => {
    const done = render(
      <LectureTranscriptSegments segments={[segment({ seq: 1 })]} onRetry={vi.fn()} />
    );
    expect(visibleText(done)).not.toContain('Listening…');

    const live = render(
      <LectureTranscriptSegments
        segments={[segment({ seq: 1 })]}
        recording
        liveCaptions="rough words so far"
        onRetry={vi.fn()}
      />
    );
    expect(visibleText(live)).toContain('Listening…');
    expect(visibleText(live)).toContain('rough words so far');
  });

  it('says what the captions are for, when there are none yet', () => {
    const html = render(
      <LectureTranscriptSegments segments={[]} recording onRetry={vi.fn()} />
    );
    expect(visibleText(html)).toContain('replaced by the real transcript');
  });

  it('promises the audio is safe on a card that failed, and offers Retry there', () => {
    const html = render(
      <LectureTranscriptSegments
        segments={[
          segment({ seq: 1 }),
          segment({ seq: 2, status: 'failed', transcript: '', error: 'Network died' }),
        ]}
        onRetry={vi.fn()}
      />
    );
    const text = visibleText(html);
    expect(text).toContain('The audio is saved');
    expect(text).toContain('Network died');
    expect(html).toContain('aria-label="Retry transcribing the part at 5:00"');
    // Exactly one Retry: a failure belongs to its own segment.
    expect(html.match(/Retry transcribing the part/g)).toHaveLength(1);
  });

  it('does not pretend a segment still in flight has words', () => {
    const html = render(
      <LectureTranscriptSegments
        segments={[segment({ seq: 1, status: 'transcribing', transcript: '' })]}
        onRetry={vi.fn()}
      />
    );
    const text = visibleText(html);
    expect(text).toContain('Transcribing…');
    expect(text).toContain('arrive when it finishes');
  });
});

describe('the Audio files tab', () => {
  it('counts the segments and dates them', () => {
    const html = render(
      <LectureAudioSegments
        noteId="note-1"
        segments={[
          segment({ seq: 1, attachmentId: 'att-1', createdAt: '2026-09-18T09:00:00.000Z' }),
          segment({ seq: 2, attachmentId: 'att-2', createdAt: '2026-09-18T09:05:00.000Z' }),
        ]}
      />
    );
    const text = visibleText(html);
    expect(text).toContain('Audio recordings');
    expect(text).toContain('2 segments recorded on 18 Sep 2026');
  });

  it('labels each row with the span of the lecture it covers', () => {
    const html = render(
      <LectureAudioSegments
        noteId="note-1"
        segments={[segment({ seq: 2, attachmentId: 'att-2' })]}
      />
    );
    expect(visibleText(html)).toContain('Segment 2 · 5:00–10:00');
  });

  it('says a segment is still being saved rather than showing a dead player', () => {
    const html = render(
      <LectureAudioSegments noteId="note-1" segments={[segment({ seq: 1, status: 'uploading' })]} />
    );
    expect(visibleText(html)).toContain('still being saved');
  });

  it('is honest about a lecture with no recording at all', () => {
    const html = render(<LectureAudioSegments noteId="note-1" segments={[]} />);
    expect(visibleText(html)).toContain('No recording is saved on this lecture yet.');
  });
});

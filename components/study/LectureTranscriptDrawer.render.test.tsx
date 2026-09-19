import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  growLectureChunks,
  initialLectureDrawer,
  lectureDrawerReducer,
  type LectureDrawerModel,
} from '@lantern/shared';
import {
  LectureMinimisedWidget,
  LectureTranscriptDrawer,
} from './LectureTranscriptDrawer';
import { LectureTabPill } from './LectureTabPill';
import { lectureTabPillLabels } from '@lantern/shared';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const visibleText = (html: string) => html.replace(/<[^>]*>/g, '');

const PRE_CHECK = {
  levelDb: -20,
  quality: { grade: 'great', label: 'Great', reason: 'Clear and loud enough.' },
  internet: { grade: 'great', label: 'Great', reason: 'Fast enough to upload.' },
  devices: [{ deviceId: 'mic-1', label: 'MacBook Air Microphone' }],
  selectedDeviceId: 'mic-1',
  selectDevice: () => undefined,
  error: null,
  listening: true,
} as never;

const drawerAt = (step: LectureDrawerModel['step']): LectureDrawerModel => {
  let state = initialLectureDrawer({ consentRemembered: step !== 'consent', open: true });
  if (step === 'consent') state = lectureDrawerReducer(state, { type: 'start-pressed' });
  if (step === 'recording' || step === 'saving' || step === 'done') {
    state = lectureDrawerReducer(state, { type: 'recording-started' });
  }
  if (step === 'saving' || step === 'done') state = lectureDrawerReducer(state, { type: 'stop' });
  if (step === 'done') state = lectureDrawerReducer(state, { type: 'saved' });
  return state;
};

const renderDrawer = (step: LectureDrawerModel['step'], chunks = CHUNKS) =>
  render(
    <LectureTranscriptDrawer
      drawer={drawerAt(step)}
      preCheck={PRE_CHECK}
      consent={<p>I can record this lecture.</p>}
      canStart
      chunks={chunks}
      sealed={step === 'done'}
      elapsedMs={143_000}
      onEnhance={() => undefined}
      enhanceCost="1 AI use"
      onClose={() => undefined}
      onOpenSettings={() => undefined}
      onStart={() => undefined}
      onConsent={() => undefined}
      onStop={() => undefined}
      onMinimise={() => undefined}
      onResume={() => undefined}
    />
  );

const CHUNKS = growLectureChunks({
  chunks: growLectureChunks({ chunks: [], text: 'The second law again.', atMs: 7_000 }),
  text: 'Entropy never falls.',
  atMs: 108_000,
});

describe('transcript drawer states', () => {
  it('shows the pre-check with the honest consent copy above it', () => {
    const html = renderDrawer('precheck');
    expect(visibleText(html)).toContain('I can record this lecture.');
    expect(html).toContain('aria-label="Start recording"');
    expect(visibleText(html)).toContain('Transcript');
  });

  it('asks for consent in the reference’s words, with both answers', () => {
    const text = visibleText(renderDrawer('consent'));
    expect(text).toContain('Recording consent');
    expect(text).toContain('Ensure all participants consent to being recorded');
    expect(text).toContain('Yes, record now');
    expect(text).toContain('No');
  });

  it('draws the chunk cards, the listening dot and the black pill while recording', () => {
    const html = renderDrawer('recording');
    const text = visibleText(html);
    expect(text).toContain('The second law again.');
    expect(text).toContain('Entropy never falls.');
    // Mono stamps, in their own 40px column.
    expect(html).toContain('font-mono');
    expect(text).toContain('0:07');
    expect(text).toContain('● Listening…');
    expect(html).toContain('aria-label="Stop recording"');
    expect(text).toContain('2:23');
    expect(text).toContain('Minimize transcript');
  });

  it('promises nothing is lost while saving, and greys Resume', () => {
    const text = visibleText(renderDrawer('saving'));
    expect(text).toContain('Saving your recording');
    expect(text).toContain('Please wait while we save your transcript and audio…');
    expect(renderDrawer('saving')).toContain('disabled=""');
  });

  it('offers notes from the transcript, the quality row and Resume when done', () => {
    const text = visibleText(renderDrawer('done'));
    expect(text).toContain('Create notes from transcript?');
    expect(text).toContain('✨ Enhance notes · 1 AI use');
    expect(text).toContain('🎙 Great');
    expect(text).toContain('📶 Great');
    expect(text).toContain('🎙 Resume');
  });

  it('uses tokens rather than the reference’s hexes', () => {
    const html = renderDrawer('recording');
    expect(html).toContain('bg-lantern-background-secondary');
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe('minimised widget', () => {
  it('keeps the clock, the stop and a way back to the drawer', () => {
    const html = render(
      <LectureMinimisedWidget
        elapsedMs={143_000}
        levelDb={-18}
        qualityLabel="Great"
        onStop={() => undefined}
        onExpand={() => undefined}
      />
    );
    expect(visibleText(html)).toContain('2:23');
    expect(visibleText(html)).toContain('Great');
    expect(html).toContain('aria-label="Stop recording"');
    expect(html).toContain('aria-label="Expand transcript"');
  });
});

describe('tab pill labels follow the take', () => {
  it('reads Transcript while recording and Generating while enhancing', () => {
    const recording = render(
      <LectureTabPill
        items={lectureTabPillLabels({ recording: true, enhancing: false, hasEnhanced: true })}
        value="record"
        onChange={() => undefined}
      />
    );
    expect(visibleText(recording)).toContain('≡ Transcript');

    const enhancing = render(
      <LectureTabPill
        items={lectureTabPillLabels({ recording: false, enhancing: true, hasEnhanced: false })}
        value="notes"
        onChange={() => undefined}
      />
    );
    expect(visibleText(enhancing)).toContain('⟳ Generating…');

    // …and the label comes straight back when the enhance ends, however it
    // ended. That is the reference's stuck-spinner bug, fixed at the source.
    const after = render(
      <LectureTabPill
        items={lectureTabPillLabels({ recording: false, enhancing: false, hasEnhanced: false })}
        value="notes"
        onChange={() => undefined}
      />
    );
    expect(visibleText(after)).toContain('Enhanced Notes');
    expect(visibleText(after)).not.toContain('Generating');
  });
});

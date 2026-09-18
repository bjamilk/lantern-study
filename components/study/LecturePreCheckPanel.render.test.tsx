import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  LECTURE_SPOKEN_LANGUAGES,
  LECTURE_TRANSCRIBE_TARGETS,
  classifyLectureAudioQuality,
  classifyLectureInternet,
} from '@lantern/shared/utils/lectureAudio';
import { LecturePreCheckPanel } from './LecturePreCheckPanel';
import { LectureRecorderSettings } from './LectureRecorderSettings';
import { LectureLevelMeter, LECTURE_LEVEL_SILENT_CAPTION } from './LectureLevelMeter';
import type { LecturePreCheck } from '../../hooks/useLecturePreCheck';

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const visibleText = (html: string) => html.replace(/<[^>]*>/g, ' ');

const preCheckWith = (overrides: Partial<LecturePreCheck> = {}): LecturePreCheck => ({
  levelDb: null,
  quality: classifyLectureAudioQuality({ rmsDb: null }),
  internet: classifyLectureInternet({ online: true, effectiveType: '4g', rttMs: 40 }),
  devices: [
    { deviceId: 'built-in', label: 'MacBook Air Microphone (Built-in)' },
    { deviceId: 'usb-1', label: 'Blue Yeti' },
  ],
  selectedDeviceId: 'built-in',
  selectDevice: vi.fn(),
  error: null,
  listening: true,
  ...overrides,
});

const panel = (overrides: Partial<LecturePreCheck> = {}, props: Record<string, unknown> = {}) =>
  render(
    <LecturePreCheckPanel
      preCheck={preCheckWith(overrides)}
      consent={<span>I can record this lecture.</span>}
      onOpenSettings={() => undefined}
      onStart={() => undefined}
      canStart
      {...props}
    />
  );

describe('the level meter', () => {
  it('says in words that it has heard nothing yet', () => {
    const html = panel();
    expect(visibleText(html)).toContain(LECTURE_LEVEL_SILENT_CAPTION);
  });

  it('stops saying it once a reading arrives', () => {
    const html = panel({ levelDb: -20, quality: classifyLectureAudioQuality({ rmsDb: -20 }) });
    expect(visibleText(html)).not.toContain(LECTURE_LEVEL_SILENT_CAPTION);
    expect(visibleText(html)).toContain('We are picking up audio.');
  });

  it('lights no bars for no reading and reports that to a screen reader', () => {
    const html = render(<LectureLevelMeter levelDb={null} />);
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('role="meter"');
  });

  it('lights bars in proportion to the level', () => {
    const quiet = render(<LectureLevelMeter levelDb={-45} />);
    const loud = render(<LectureLevelMeter levelDb={-5} />);
    const valueOf = (html: string) => Number(/aria-valuenow="(\d+)"/.exec(html)?.[1]);
    expect(valueOf(quiet)).toBeLessThan(valueOf(loud));
  });
});

describe('the status card', () => {
  it('says Checking rather than Great before anything is measured', () => {
    const text = visibleText(
      panel({
        quality: classifyLectureAudioQuality({ rmsDb: null }),
        internet: classifyLectureInternet({ online: true }),
      })
    );
    expect(text).toContain('Audio quality:');
    expect(text).toContain('Internet:');
    expect(text).toContain('Checking');
    expect(text).not.toContain('Great');
  });

  it('names the reason a quality is not Great', () => {
    const text = visibleText(panel({ quality: classifyLectureAudioQuality({ rmsDb: -50 }) }));
    expect(text).toContain('Poor');
    expect(text).toContain('too quiet — move closer');
  });

  it('lists the microphones once permission has been granted', () => {
    const html = panel();
    expect(html).toContain('MacBook Air Microphone (Built-in)');
    expect(html).toContain('Blue Yeti');
    expect(html).toContain('id="lecture-mic-device"');
  });

  it('says it has no microphones to list rather than showing an empty select', () => {
    const html = panel({ devices: [] });
    expect(html).not.toContain('id="lecture-mic-device"');
    expect(visibleText(html)).toContain('Reading the microphones on this computer');
  });

  it('shows a microphone failure in the words the student can act on', () => {
    const html = panel({
      devices: [],
      error: 'Microphone permission is blocked. Allow mic access for this site, then retry.',
    });
    expect(visibleText(html)).toContain('Microphone permission is blocked');
  });
});

describe('the Start button', () => {
  it('is enabled once consent is ticked and we are online', () => {
    expect(panel()).not.toContain('disabled=""');
  });

  it('is disabled offline, and says why', () => {
    const html = panel({ internet: classifyLectureInternet({ online: false }) });
    expect(html).toContain('disabled=""');
    expect(visibleText(html)).toContain('You are offline.');
  });

  it('is disabled before the consent box is ticked', () => {
    const html = panel({}, { canStart: false });
    expect(html).toContain('disabled=""');
    expect(visibleText(html)).toContain('Tick the box above');
  });

  it('carries a name, unlike the reference recorder', () => {
    expect(panel()).toContain('aria-label="Start recording"');
  });

  it('keeps the consent line the caller passed, unchanged', () => {
    expect(visibleText(panel())).toContain('I can record this lecture.');
  });
});

describe('the settings popover', () => {
  const settings = (over: Record<string, unknown> = {}) =>
    render(
      <LectureRecorderSettings
        languages={{ spokenLanguage: 'auto', transcribeTo: 'same' }}
        onChangeLanguages={() => undefined}
        devices={[{ deviceId: 'built-in', label: 'MacBook Air Microphone (Built-in)' }]}
        selectedDeviceId="built-in"
        onSelectDevice={() => undefined}
        onClose={() => undefined}
        {...over}
      />
    );

  it('offers every language the shared registry offers, and no others', () => {
    const html = settings();
    for (const row of LECTURE_SPOKEN_LANGUAGES) {
      expect(html).toContain(`value="${row.id}"`);
      expect(html).toContain(row.label);
    }
    const options = Array.from(html.matchAll(/<option value="([^"]*)"/g)).map((m) => m[1]);
    // The two selects plus the mic: every language id, both targets, one device.
    expect(options).toEqual([
      ...LECTURE_SPOKEN_LANGUAGES.map((row) => row.id),
      ...LECTURE_TRANSCRIBE_TARGETS.map((row) => row.id),
      'built-in',
    ]);
  });

  it('offers only the two transcribe targets Whisper can produce', () => {
    const text = visibleText(settings());
    expect(text).toContain('Same as spoken');
    expect(text).toContain('English is the only language we can translate a lecture INTO');
    // No third target may creep in: the picker is built from the shared list.
    expect(LECTURE_TRANSCRIBE_TARGETS).toHaveLength(2);
  });

  it('says why it cannot list microphones instead of showing an empty picker', () => {
    const html = settings({ devices: [] });
    expect(html).not.toContain('id="lecture-settings-mic"');
    expect(visibleText(html)).toContain('once you have allowed mic access');
  });
});

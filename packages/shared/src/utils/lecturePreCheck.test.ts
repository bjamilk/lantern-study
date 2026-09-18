/**
 * The recorder pre-check, as arithmetic.
 *
 * These are the functions both the browser panel and the phone card draw from,
 * so the assertions here are the only thing that keeps "Great" meaning the
 * same thing on the two platforms. The one rule they all encode: a reading we
 * do not have is `unknown`, never an optimistic default.
 */
import {
  DEFAULT_LECTURE_SPOKEN_LANGUAGE,
  LECTURE_CLIPPING_FAIR_RATIO,
  LECTURE_CLIPPING_POOR_RATIO,
  LECTURE_LEVEL_BAR_FLOOR_DB,
  LECTURE_SPOKEN_LANGUAGES,
  LECTURE_TRANSCRIBE_TARGETS,
  classifyLectureAudioQuality,
  classifyLectureInternet,
  isLectureSpokenLanguageId,
  lectureLevelBarCount,
  lectureLevelBarFraction,
  lectureLevelWord,
  lectureSpokenLanguageLabel,
  needsWhisperTranslation,
  normalizeLectureSpokenLanguage,
  normalizeLectureTranscribeTarget,
  whisperLanguageParam,
} from './lectureAudio';

describe('lecture level meter', () => {
  it('has no word for a reading it does not have', () => {
    expect(lectureLevelWord(null)).toBeNull();
    expect(lectureLevelWord(undefined)).toBeNull();
    expect(lectureLevelWord(Number.NaN)).toBeNull();
  });

  it('names each band', () => {
    expect(lectureLevelWord(-60)).toBe('Silent');
    expect(lectureLevelWord(-45)).toBe('Silent');
    expect(lectureLevelWord(-40)).toBe('Quiet');
    expect(lectureLevelWord(-30)).toBe('Quiet');
    expect(lectureLevelWord(-20)).toBe('Good');
    expect(lectureLevelWord(-8)).toBe('Loud');
    expect(lectureLevelWord(0)).toBe('Loud');
  });

  it('draws an empty bar rather than a guessed one', () => {
    expect(lectureLevelBarFraction(null)).toBe(0);
    expect(lectureLevelBarCount(null, 12)).toBe(0);
  });

  it('clamps the bar to 0..1 and lights whole bars', () => {
    expect(lectureLevelBarFraction(LECTURE_LEVEL_BAR_FLOOR_DB - 40)).toBe(0);
    expect(lectureLevelBarFraction(20)).toBe(1);
    expect(lectureLevelBarCount(0, 12)).toBe(12);
    expect(lectureLevelBarCount(-30, 12)).toBe(6);
  });
});

describe('classifyLectureAudioQuality', () => {
  it('says it is still checking before the first reading', () => {
    const result = classifyLectureAudioQuality({ rmsDb: null });
    expect(result.grade).toBe('unknown');
    expect(result.label).toBe('Checking');
  });

  it('calls a clear voice Great', () => {
    expect(classifyLectureAudioQuality({ rmsDb: -20, clippingRatio: 0 })).toEqual({
      grade: 'great',
      label: 'Great',
      reason: 'clear enough to transcribe',
    });
  });

  it('blames clipping before quietness, because the fix is the opposite', () => {
    const result = classifyLectureAudioQuality({
      rmsDb: -50,
      clippingRatio: LECTURE_CLIPPING_POOR_RATIO,
    });
    expect(result.grade).toBe('poor');
    expect(result.reason).toBe('clipping — move back');
  });

  it('calls a silent room Poor and says what to do', () => {
    const result = classifyLectureAudioQuality({ rmsDb: -50 });
    expect(result.grade).toBe('poor');
    expect(result.reason).toBe('too quiet — move closer');
  });

  it('calls a thin signal Fair', () => {
    expect(classifyLectureAudioQuality({ rmsDb: -35 }).grade).toBe('fair');
    expect(classifyLectureAudioQuality({ rmsDb: -35 }).reason).toBe('quiet — move closer');
  });

  it('calls a hot signal Fair', () => {
    expect(classifyLectureAudioQuality({ rmsDb: -5 }).reason).toBe('very loud — move back');
    expect(
      classifyLectureAudioQuality({ rmsDb: -20, clippingRatio: LECTURE_CLIPPING_FAIR_RATIO })
        .reason
    ).toBe('a little loud — move back');
  });

  it('treats an unmeasurable clipping ratio as none rather than as clipping', () => {
    expect(classifyLectureAudioQuality({ rmsDb: -20, clippingRatio: null }).grade).toBe('great');
    expect(classifyLectureAudioQuality({ rmsDb: -20, clippingRatio: Number.NaN }).grade).toBe(
      'great'
    );
  });
});

describe('classifyLectureInternet', () => {
  it('reports offline as a fact, with the honest consequence', () => {
    const result = classifyLectureInternet({ online: false });
    expect(result.grade).toBe('offline');
    expect(result.reason).toContain('transcribing needs a connection');
  });

  it('does not claim a speed a browser never reported', () => {
    const result = classifyLectureInternet({ online: true });
    expect(result.grade).toBe('unknown');
    expect(result.label).toBe('Checking');
  });

  it('calls a fast connection Great', () => {
    expect(classifyLectureInternet({ online: true, effectiveType: '4g', rttMs: 50 }).grade).toBe(
      'great'
    );
    expect(classifyLectureInternet({ online: true, probeMs: 120 }).grade).toBe('great');
  });

  it('calls a slow radio or a slow round trip Fair', () => {
    expect(classifyLectureInternet({ online: true, effectiveType: '3g' }).grade).toBe('fair');
    expect(classifyLectureInternet({ online: true, effectiveType: 'slow-2g' }).grade).toBe('fair');
    expect(classifyLectureInternet({ online: true, effectiveType: '4g', rttMs: 900 }).grade).toBe(
      'fair'
    );
    expect(classifyLectureInternet({ online: true, probeMs: 2000 }).grade).toBe('fair');
  });

  it('never grades a negative or non-finite reading', () => {
    expect(classifyLectureInternet({ online: true, rttMs: -5 }).grade).toBe('unknown');
    expect(classifyLectureInternet({ online: true, probeMs: Number.NaN }).grade).toBe('unknown');
  });
});

describe('lecture language allowlist', () => {
  it('offers Auto-detect first and nine named languages', () => {
    expect(LECTURE_SPOKEN_LANGUAGES[0]?.id).toBe('auto');
    expect(LECTURE_SPOKEN_LANGUAGES).toHaveLength(10);
  });

  it('uses ISO-639-1 codes, which is what Groq accepts', () => {
    for (const row of LECTURE_SPOKEN_LANGUAGES) {
      if (row.id === 'auto') continue;
      expect(row.id).toMatch(/^[a-z]{2}$/);
    }
  });

  it('narrows anything off the list to auto-detect', () => {
    expect(normalizeLectureSpokenLanguage('klingon')).toBe(DEFAULT_LECTURE_SPOKEN_LANGUAGE);
    expect(normalizeLectureSpokenLanguage({ id: 'en' })).toBe('auto');
    expect(normalizeLectureSpokenLanguage(null)).toBe('auto');
    expect(isLectureSpokenLanguageId('en')).toBe(true);
    expect(isLectureSpokenLanguageId('EN')).toBe(false);
  });

  it('sends no language at all for auto-detect', () => {
    expect(whisperLanguageParam('auto')).toBeUndefined();
    expect(whisperLanguageParam('nonsense')).toBeUndefined();
    expect(whisperLanguageParam('yo')).toBe('yo');
  });

  it('labels a language it knows and falls back otherwise', () => {
    expect(lectureSpokenLanguageLabel('ha')).toBe('Hausa');
    expect(lectureSpokenLanguageLabel('zz')).toBe('Auto-detect');
  });
});

describe('transcribe-to target', () => {
  it('offers only the two Whisper can actually do', () => {
    expect(LECTURE_TRANSCRIBE_TARGETS.map((row) => row.id)).toEqual(['same', 'en']);
  });

  it('narrows any other target to same-as-spoken', () => {
    expect(normalizeLectureTranscribeTarget('yo')).toBe('same');
    expect(normalizeLectureTranscribeTarget(undefined)).toBe('same');
    expect(normalizeLectureTranscribeTarget('en')).toBe('en');
  });

  it('only translates when the two languages actually differ', () => {
    expect(needsWhisperTranslation('yo', 'en')).toBe(true);
    expect(needsWhisperTranslation('en', 'en')).toBe(false);
    expect(needsWhisperTranslation('yo', 'same')).toBe(false);
    // Auto-detect + English: we cannot know it is already English, so we ask.
    expect(needsWhisperTranslation('auto', 'en')).toBe(true);
  });
});

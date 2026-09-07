import {
  NARRATION_NO_VOICE_COPY,
  narrationBlockedReason,
  narrationSpeechErrorCopy,
  probeSpeechAvailability,
  speechAvailabilityFromVoices,
  narrationTileHint,
  narrationTitle,
  narrationUnavailableCopy,
} from './narrationModel';

describe('narrationUnavailableCopy', () => {
  it('treats "nobody has asked yet" as a state with a door, not a failure', () => {
    const copy = narrationUnavailableCopy('not_generated');
    expect(copy.canGenerate).toBe(true);
    expect(copy.title).toBe('Not read yet');
    expect(copy.detail).not.toMatch(/error|failed|sorry/i);
  });

  it('says a missing migration is the server, not the student, and offers nothing', () => {
    const copy = narrationUnavailableCopy('schema_missing');
    expect(copy.canGenerate).toBe(false);
    expect(copy.detail).toMatch(/Nothing is wrong with your document/);
  });

  it('never offers to spend credits on a document that cannot be read', () => {
    for (const reason of ['unsupported', 'preview_pending', 'source_missing', 'unreadable'] as const) {
      expect(narrationUnavailableCopy(reason).canGenerate).toBe(false);
    }
  });
});

describe('narrationTileHint', () => {
  it('prints the cost and the page ceiling', () => {
    expect(narrationTileHint('2 AI uses', 20, false)).toBe('2 AI uses · up to 20 pages');
    expect(narrationTileHint('3 AI uses', 1, false)).toBe('3 AI uses · up to 1 page');
  });

  it('stops quoting a price once the reading exists', () => {
    expect(narrationTileHint('3 AI uses', 40, true)).toBe('Already read — play it again free');
  });

  it('falls back to the bare cost when nobody has counted the pages', () => {
    expect(narrationTileHint('2 AI uses', 0, false)).toBe('2 AI uses');
  });
});

describe('narrationBlockedReason', () => {
  const base = {
    hasDocument: true,
    pagesPending: false,
    shortOfCredits: false,
    alreadyRunning: false,
    alreadyRead: false,
  };

  it('is open when a document is there and there is credit for it', () => {
    expect(narrationBlockedReason(base)).toBeNull();
  });

  it('names what the student cannot change first', () => {
    expect(narrationBlockedReason({ ...base, hasDocument: false, shortOfCredits: true })).toBe(
      'Only PDFs and slide decks have pages'
    );
    expect(narrationBlockedReason({ ...base, pagesPending: true })).toBe(
      'Still reading the document'
    );
    expect(narrationBlockedReason({ ...base, alreadyRunning: true })).toBe('Already being read');
  });

  it('never blocks a reading that has already been paid for', () => {
    expect(narrationBlockedReason({ ...base, shortOfCredits: true })).toBe(
      'Not enough AI uses left today'
    );
    expect(narrationBlockedReason({ ...base, shortOfCredits: true, alreadyRead: true })).toBeNull();
  });
});

describe('narrationTitle', () => {
  it('names the note when there is one, and never renders a blank heading', () => {
    expect(narrationTitle('  Enzymes  ')).toBe('Reading · Enzymes');
    expect(narrationTitle('')).toBe('Reading this document');
    expect(narrationTitle(null)).toBe('Reading this document');
  });
});

describe('speech availability', () => {
  it('counts an empty voice list as no engine, not as an unknown', () => {
    expect(speechAvailabilityFromVoices([])).toBe('none');
    expect(speechAvailabilityFromVoices([{ identifier: 'en-GB' }])).toBe('available');
  });

  it('treats a rejection or a shape we did not expect as no engine', () => {
    // The caller passes a rejection in as null; anything non-array is not
    // evidence the phone can speak.
    expect(speechAvailabilityFromVoices(null)).toBe('none');
    expect(speechAvailabilityFromVoices(undefined)).toBe('none');
    expect(speechAvailabilityFromVoices({ voices: 3 })).toBe('none');
  });

  it('tells a voiceless phone what to do and where the words already are', () => {
    expect(NARRATION_NO_VOICE_COPY.detail).toMatch(/no voice installed to read aloud/i);
    expect(NARRATION_NO_VOICE_COPY.detail).toMatch(/text-to-speech engine in Android settings/i);
    expect(NARRATION_NO_VOICE_COPY.detail).toMatch(/read the page text here/i);
  });
});

describe('probeSpeechAvailability', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers from the voice list when the engine replies', async () => {
    await expect(probeSpeechAvailability(async () => [{ identifier: 'en-GB' }], 50)).resolves.toBe(
      'available'
    );
    await expect(probeSpeechAvailability(async () => [], 50)).resolves.toBe('none');
  });

  it('reads a rejection, or a probe that throws outright, as no voice', async () => {
    await expect(probeSpeechAvailability(() => Promise.reject(new Error('no tts')), 50)).resolves.toBe(
      'none'
    );
    await expect(
      probeSpeechAvailability(() => {
        throw new Error('module missing');
      }, 50)
    ).resolves.toBe('none');
  });

  it('gives up on a probe that never answers, which is what a phone with no engine does', async () => {
    jest.useFakeTimers();
    const never = new Promise<unknown>(() => undefined);
    const answer = probeSpeechAvailability(() => never, 8000);
    jest.advanceTimersByTime(7999);
    // Still waiting: the engine may be a slow cold start.
    let settled = false;
    void answer.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(answer).resolves.toBe('none');
  });
});

describe('narrationSpeechErrorCopy', () => {
  it('names the paragraph, not the document, and never blames the student', () => {
    const copy = narrationSpeechErrorCopy();
    expect(copy.title).toBe('That paragraph would not play');
    expect(copy.detail).toMatch(/could not read that paragraph/i);
    expect(copy.detail).not.toMatch(/you /i);
  });

  it('prefers the reason the engine gave', () => {
    expect(narrationSpeechErrorCopy('No voice for this language.').detail).toBe(
      'No voice for this language.'
    );
  });
});

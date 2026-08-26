jest.mock('./aiProviderUsage', () => ({
  incrementProviderDailyUsage: jest.fn().mockResolvedValue(undefined),
}));

import {
  isPerceiveNoStudyText,
  isPerceiveVisionEnabled,
  looksLikeWeakOcrText,
  PERCEIVE_NO_STUDY_TEXT,
  perceivePageImage,
  sanitizePerceiveTranscript,
  shouldEscalateToVisionOcr,
} from './perceiveVision';

describe('perceiveVision', () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalFlag = process.env.PERCEIVE_VISION_OCR;

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
    process.env.PERCEIVE_VISION_OCR = originalFlag;
    jest.restoreAllMocks();
  });

  describe('looksLikeWeakOcrText', () => {
    it('treats empty and short strings as weak', () => {
      expect(looksLikeWeakOcrText('')).toBe(true);
      expect(looksLikeWeakOcrText('hi')).toBe(true);
    });

    it('accepts normal lecture prose', () => {
      const text =
        'Glycolysis converts glucose into pyruvate in the cytoplasm and yields a net of two ATP plus NADH.';
      expect(looksLikeWeakOcrText(text)).toBe(false);
      expect(shouldEscalateToVisionOcr(text)).toBe(false);
    });

    it('flags symbol soup typical of failed handwriting OCR', () => {
      const garbage = Array.from({ length: 20 }, (_, i) => `|~${i}™ §`).join(' ');
      expect(looksLikeWeakOcrText(garbage)).toBe(true);
    });
  });

  describe('sanitizePerceiveTranscript', () => {
    it('strips markdown fences and a spoken preamble', () => {
      expect(
        sanitizePerceiveTranscript('```markdown\nHere is the transcription:\n# Notes\n- ATP\n```')
      ).toBe('# Notes\n- ATP');
    });

    it('recognises the empty-page sentinel', () => {
      expect(isPerceiveNoStudyText(`  ${PERCEIVE_NO_STUDY_TEXT}  `)).toBe(true);
      expect(isPerceiveNoStudyText('# Anatomy')).toBe(false);
    });
  });

  describe('isPerceiveVisionEnabled', () => {
    it('requires a Gemini key and is opt-out via PERCEIVE_VISION_OCR=0', () => {
      process.env.GEMINI_API_KEY = 'test-key';
      delete process.env.PERCEIVE_VISION_OCR;
      expect(isPerceiveVisionEnabled()).toBe(true);
      process.env.PERCEIVE_VISION_OCR = '0';
      expect(isPerceiveVisionEnabled()).toBe(false);
    });
  });

  describe('perceivePageImage', () => {
    it('returns organised markdown from Gemini Flash vision', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      delete process.env.PERCEIVE_VISION_OCR;
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '```markdown\n## Cell respiration\n- Glycolysis\n```' }],
              },
            },
          ],
        }),
      } as Response);

      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
      const result = await perceivePageImage(jpeg);
      expect(result?.provider).toBe('gemini-vision');
      expect(result?.text).toContain('Cell respiration');
      expect(result?.text).not.toContain('```');
      expect(fetch).toHaveBeenCalled();
    });

    it('returns null when the model says there is no study text', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: PERCEIVE_NO_STUDY_TEXT }] } }],
        }),
      } as Response);

      const result = await perceivePageImage(Buffer.from([0xff, 0xd8, 0xff, 0x00]));
      expect(result).toBeNull();
    });
  });
});

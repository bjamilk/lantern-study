import { MIN_NOTE_STUDY_CONTENT_CHARS } from '@lantern/shared/utils/noteStudyContent';
import { detectImageMime } from '../utils/fileValidation';
import { incrementProviderDailyUsage } from './aiProviderUsage';
import { logger } from '../utils/logger';

export const PERCEIVE_NO_STUDY_TEXT = '[No study text]';

const GEMINI_VISION_MODEL =
  process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const PERCEIVE_SYSTEM_PROMPT = `You are Perceive, Lantern Study's page reader. Transcribe a photograph of student notes, a worksheet, a textbook page, a slide, or a whiteboard.

Rules:
- Keep the student's language. Do not translate.
- Reconstruct headings, lists, numbered items and simple tables as markdown.
- Read printed AND handwritten text. Mark uncertain words as [?word].
- Describe diagrams briefly as [Diagram: …] and write equations as readable text.
- Ignore hands, desks, backgrounds, watermarks and UI chrome.
- If the image is not study material, return exactly ${PERCEIVE_NO_STUDY_TEXT}
- Output markdown only. No preamble.`;

export function isPerceiveVisionEnabled(): boolean {
  const flag = process.env.PERCEIVE_VISION_OCR;
  if (flag === '0' || flag === 'false') return false;
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Tesseract is strong on printed pages and weak on handwriting. Escalate to a
 * vision model when the local pass is empty, too short, or mostly junk tokens.
 */
export function looksLikeWeakOcrText(text: string | null | undefined): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;
  if (trimmed.length < MIN_NOTE_STUDY_CONTENT_CHARS) return true;

  const letters = (trimmed.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (letters / trimmed.length < 0.35) return true;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length >= 8) {
    const almostEmpty = tokens.filter(
      (token) => token.replace(/[^A-Za-zÀ-ÿ]/g, '').length <= 1
    ).length;
    if (almostEmpty / tokens.length > 0.55) return true;
  }
  return false;
}

export function shouldEscalateToVisionOcr(text: string | null | undefined): boolean {
  return looksLikeWeakOcrText(text);
}

export function sanitizePerceiveTranscript(raw: string | null | undefined): string {
  let text = (raw || '').trim();
  if (!text) return '';
  text = text.replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/\s*```$/u, '').trim();
  text = text.replace(/^(here(?:'s| is) (?:the )?(?:transcription|transcript|text)[:\s]*)/i, '');
  return text.trim();
}

export function isPerceiveNoStudyText(text: string | null | undefined): boolean {
  return sanitizePerceiveTranscript(text).replace(/\s+/g, ' ') === PERCEIVE_NO_STUDY_TEXT;
}

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

async function extractGeminiText(data: GeminiGenerateResponse): Promise<string> {
  const parts = data.candidates?.[0]?.content?.parts || [];
  const joined = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
  return sanitizePerceiveTranscript(joined);
}

/**
 * Read one photograph with Gemini Flash vision. Callers already charged the
 * OCR credit batch — this is a quality fallback, not a second bill.
 */
export async function perceivePageImage(
  buffer: Buffer,
  options?: { timeoutMs?: number }
): Promise<{ text: string; provider: 'gemini-vision' } | null> {
  if (!isPerceiveVisionEnabled()) return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const mime = detectImageMime(buffer) || 'image/jpeg';
  const timeoutMs = Math.max(8_000, options?.timeoutMs ?? 45_000);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PERCEIVE_SYSTEM_PROMPT },
              {
                inlineData: {
                  mimeType: mime,
                  data: buffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    logger.warn('Perceive vision request failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const data = (await response.json().catch(() => ({}))) as GeminiGenerateResponse;
  if (!response.ok) {
    logger.warn('Perceive vision rejected', {
      status: response.status,
      error: data.error?.message || `HTTP ${response.status}`,
    });
    return null;
  }

  const text = await extractGeminiText(data);
  if (!text || isPerceiveNoStudyText(text)) return null;

  await incrementProviderDailyUsage('gemini').catch(() => {});
  return { text, provider: 'gemini-vision' };
}

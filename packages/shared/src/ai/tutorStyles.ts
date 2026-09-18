/**
 * Tutor styles — the companion's four personas, as prompt fragments.
 *
 * Purpose: one registry, shared by the picker (web), the per-user setting
 * (`UserSettings.tutorStyle`) and the prompt builder
 * (`aiService.companionChat`), so a style cannot exist in the menu without a
 * fragment behind it or be accepted by the server without appearing in the menu.
 *
 * Exports: `TUTOR_STYLES` (the registry, in menu order), `TutorStyleId`,
 * `DEFAULT_TUTOR_STYLE_ID`, `isTutorStyleId`, `normalizeTutorStyleId`,
 * `getTutorStyle` and `tutorStylePromptFragment`.
 *
 * What it touches: nothing. This module is pure data plus two guards, with no
 * imports, so it is safe for `settings/userSettings.ts` to import (the setting's
 * enum is defined here) without an import cycle.
 *
 * Gotchas:
 *  - A fragment is APPENDED to the companion's system prompt, after the
 *    safety, honesty, grounding and citation rules. It changes VOICE AND
 *    METHOD only. A fragment that told the model to disregard what is above it
 *    would make the registry the weakest link in the prompt, so
 *    `tutorStyles.test.ts` fails on override phrasing.
 *  - The same honesty rule governs the copy: `description` may promise a tone
 *    or a teaching method and nothing else. No style knows more, is more
 *    accurate, or reads more of the student's material than another — they all
 *    run the same model on the same context, for the same credit.
 *  - `icon` is an `AppIconName` (the clients' icon vocabulary). It is typed
 *    `string` here because that vocabulary is web/mobile-only; the web side
 *    asserts every id resolves (`TutorStylePicker.render.test.tsx`).
 */

/** The four ids. Stored in `UserSettings.tutorStyle` and sent per turn. */
export type TutorStyleId = 'default' | 'coach' | 'professor' | 'peer';

export interface TutorStyle {
  id: TutorStyleId;
  /** The name a student sees in the picker and in the header chip. */
  label: string;
  /** One line, about tone and method only — never about knowledge. */
  description: string;
  /** An `AppIconName`. See the header note. */
  icon: string;
  /**
   * 2–5 sentences appended to the END of the companion's system prompt.
   * Never a replacement for the rules above it.
   */
  prompt: string;
}

export const DEFAULT_TUTOR_STYLE_ID: TutorStyleId = 'default';

/**
 * In menu order. `default` is first because it is what every account starts on.
 */
export const TUTOR_STYLES: readonly TutorStyle[] = [
  {
    id: 'default',
    label: 'Lantern',
    description: 'Balanced explanations with a next step.',
    icon: 'sparkles',
    prompt:
      'Teach in Lantern\'s balanced voice: warm, plain and practical. Explain the idea, give one concrete example, then say what to do next. Keep the reply short enough to read in one go.',
  },
  {
    id: 'coach',
    label: 'Coach',
    description: 'Asks you to try first, then hints.',
    icon: 'flame',
    prompt:
      'Coach this student instead of answering outright. When the question is one they could work out, invite them to try first and offer one hint at a time; give the full answer once they have attempted it or asked again directly. Say what they got right before what they missed. End with one small, specific next action.',
  },
  {
    id: 'professor',
    label: 'Professor',
    description: 'Formal and precise, cites your material.',
    icon: 'school',
    prompt:
      'Use a precise, formal register. Define each term before you rely on it, and lay the reply out as a short ordered argument rather than a chat. When note excerpts are in front of you, use their wording and name the excerpt you took it from; when they are not, say plainly which part is general knowledge. Avoid slang, emoji and exclamation marks.',
  },
  {
    id: 'peer',
    label: 'Study buddy',
    description: 'Short and casual, quizzes you back.',
    icon: 'people',
    prompt:
      'Talk like a fellow student: casual, plain words, short sentences, no lecturing. Keep the reply to a few lines and skip the preamble. After answering, quiz the student back with one quick question on what was just covered. Stay friendly — never sarcastic or dismissive.',
  },
] as const;

/**
 * The one sentence the picker shows under its options.
 *
 * It exists because a persona menu invites the assumption that one option is
 * cleverer than the others. It is not: the model, the context and the credit
 * cost are identical for all four.
 */
export const TUTOR_STYLE_HONESTY_NOTE =
  'Styles change how Lantern talks, not what it knows.';

const TUTOR_STYLE_IDS: readonly string[] = TUTOR_STYLES.map((style) => style.id);

export function isTutorStyleId(value: unknown): value is TutorStyleId {
  return typeof value === 'string' && TUTOR_STYLE_IDS.includes(value);
}

/** Anything unknown — junk, an id from a newer build, an object — is `default`. */
export function normalizeTutorStyleId(value: unknown): TutorStyleId {
  return isTutorStyleId(value) ? value : DEFAULT_TUTOR_STYLE_ID;
}

export function getTutorStyle(value: unknown): TutorStyle {
  const id = normalizeTutorStyleId(value);
  return TUTOR_STYLES.find((style) => style.id === id) ?? TUTOR_STYLES[0];
}

/** The fragment for a style id, normalised. Never empty. */
export function tutorStylePromptFragment(value: unknown): string {
  return getTutorStyle(value).prompt;
}

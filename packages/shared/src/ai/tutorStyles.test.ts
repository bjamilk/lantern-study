/**
 * The tutor-style registry's invariants.
 *
 * This file is the reason a persona cannot become a prompt-injection surface:
 * every fragment is appended AFTER the companion's safety, honesty and
 * grounding rules, so a fragment that told the model to disregard what came
 * before it would silently make the picker the strongest instruction in the
 * prompt. The override-phrasing test below is the guard on that, and it is the
 * one to read first if a new style is added.
 */
import {
  DEFAULT_TUTOR_STYLE_ID,
  TUTOR_STYLES,
  TUTOR_STYLE_HONESTY_NOTE,
  getTutorStyle,
  isTutorStyleId,
  normalizeTutorStyleId,
  tutorStylePromptFragment,
} from './tutorStyles';

describe('the registry', () => {
  it('has the four styles, with unique ids', () => {
    const ids = TUTOR_STYLES.map((style) => style.id);
    expect(ids).toEqual(['default', 'coach', 'professor', 'peer']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts every account on the default style, which is in the registry', () => {
    expect(DEFAULT_TUTOR_STYLE_ID).toBe('default');
    expect(TUTOR_STYLES[0].id).toBe(DEFAULT_TUTOR_STYLE_ID);
  });

  it('gives every style a label, a description, an icon and a fragment', () => {
    for (const style of TUTOR_STYLES) {
      expect(style.label.trim().length).toBeGreaterThan(0);
      expect(style.description.trim().length).toBeGreaterThan(0);
      expect(style.icon.trim().length).toBeGreaterThan(0);
      // 2-5 sentences of instruction — not a word, not an essay.
      expect(style.prompt.trim().length).toBeGreaterThan(60);
      expect(style.prompt.length).toBeLessThan(800);
    }
  });

  it('gives every style a distinct label and fragment', () => {
    expect(new Set(TUTOR_STYLES.map((s) => s.label)).size).toBe(TUTOR_STYLES.length);
    expect(new Set(TUTOR_STYLES.map((s) => s.prompt)).size).toBe(TUTOR_STYLES.length);
  });
});

describe('a fragment may steer the voice, never override the rules above it', () => {
  // The fragment is appended LAST. Any of these phrasings would let the picker
  // outrank the safety, honesty and grounding rules it follows.
  const OVERRIDE_PHRASES = [
    'ignore previous',
    'ignore all previous',
    'ignore the above',
    'ignore prior',
    'disregard previous',
    'disregard the above',
    'forget the above',
    'forget your previous',
    'override the',
    'you are no longer',
    'system prompt',
    'regardless of any',
    'instead of the rules',
  ];

  it.each(TUTOR_STYLES.map((style) => [style.id, style.prompt] as const))(
    '%s carries no override phrasing',
    (_id, prompt) => {
      const lower = prompt.toLowerCase();
      for (const phrase of OVERRIDE_PHRASES) {
        expect(lower).not.toContain(phrase);
      }
    }
  );

  it.each(TUTOR_STYLES.map((style) => [style.id, style.description] as const))(
    '%s promises a tone or a method, never knowledge or accuracy',
    (_id, description) => {
      const lower = description.toLowerCase();
      // Honesty rule: all four run the same model on the same context for the
      // same credit, so no copy may imply one of them knows more.
      for (const claim of ['accurate', 'smarter', 'expert', 'knows more', 'better answers']) {
        expect(lower).not.toContain(claim);
      }
    }
  );

  it('says so out loud under the options', () => {
    expect(TUTOR_STYLE_HONESTY_NOTE).toContain('not what it knows');
  });
});

describe('normalising an id', () => {
  it('accepts the four', () => {
    for (const style of TUTOR_STYLES) {
      expect(isTutorStyleId(style.id)).toBe(true);
      expect(normalizeTutorStyleId(style.id)).toBe(style.id);
    }
  });

  it('falls back to default for anything else', () => {
    for (const junk of [undefined, null, '', 'tutor', 'COACH', 42, {}, [], { id: 'coach' }]) {
      expect(isTutorStyleId(junk)).toBe(false);
      expect(normalizeTutorStyleId(junk)).toBe('default');
    }
  });

  it('always resolves to a style with a non-empty fragment', () => {
    expect(getTutorStyle('nonsense').id).toBe('default');
    expect(tutorStylePromptFragment('nonsense')).toBe(TUTOR_STYLES[0].prompt);
    expect(tutorStylePromptFragment('coach')).toContain('one hint at a time');
  });
});

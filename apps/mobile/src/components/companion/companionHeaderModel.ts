/**
 * What the companion's header says — as data, so it can be tested.
 *
 * The panel is a 1,600-line component with no renderer in mobile's jest
 * (`testMatch` is `*.test.ts`, node environment), so the only way to pin a
 * header string is to make it a value first.
 *
 * WHY `Guided`. Turning Guided on changed the composer and the chips but left
 * the header reading `Lantern AI` before, during and after the guided turns
 * (SF5a device pass, check 1, defect 2), so a student mid-lesson had nothing
 * on screen saying which mode they were paying for — and the mode is carried
 * per thread, not saved, so there is nowhere else to look it up.
 *
 * The AI disclaimer is NOT part of this model: it is unconditional, and a flag
 * that could hide it is a flag that will one day hide it.
 */
export interface CompanionHeaderModel {
  /** Always the product's name. The mode rides beside it, never replaces it. */
  title: string;
  /** The pill's text, or null when the thread is in ordinary chat. */
  modeLabel: string | null;
  /** Spoken instead of the bare word, which on its own names no subject. */
  modeAccessibilityLabel: string | null;
  /** The `On: …` line, unchanged — passed through so one model owns the header. */
  subtitle: string | null;
}

export function companionHeaderModel(input: {
  mode?: 'chat' | 'guided' | null;
  subtitle?: string | null;
}): CompanionHeaderModel {
  const guided = input.mode === 'guided';
  const subtitle = (input.subtitle || '').trim();
  return {
    title: 'Lantern AI',
    modeLabel: guided ? 'Guided' : null,
    modeAccessibilityLabel: guided ? 'Guided mode is on' : null,
    subtitle: subtitle || null,
  };
}

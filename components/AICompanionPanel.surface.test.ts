/**
 * The companion panel's chrome — its header row — read out of the source.
 *
 * WHY NOT A MOUNT. `AICompanionPanel` imports the AI service, four stores, the
 * markdown renderer, the speech engine and the MediaRecorder dictation
 * lifecycle; mounting it needs ~15 module mocks that drift out of date faster
 * than the component changes, which is the reason
 * `CourseWorkspace.companionRail.surface.test.ts` gives for doing the same
 * thing one directory over. The parts that CAN be mounted honestly are, next
 * door: `companion/CompanionPrompts.render.test.tsx` mounts the pills,
 * `companion/GuidedPicker.render.test.tsx` the Guided card,
 * `companion/MessageActions.render.test.tsx` the per-answer controls.
 *
 * What is left for this file is the chrome the wave-4 parity pass rebuilt, and
 * it fails the way the regression would arrive: the thread menu collapsing back
 * into a row of ghost icons, the greeting losing the serif step, or the "+"
 * losing the accessible name that says what it makes.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const PANEL = fs.readFileSync(path.join(REPO_ROOT, 'components/AICompanionPanel.tsx'), 'utf8');

/** Collapse whitespace so an assertion survives a reformat. */
const flat = (source: string) => PANEL.replace(/\s+/g, ' ').includes(source.replace(/\s+/g, ' '));

describe('the header is one row with a thread menu, as the reference is', () => {
  it('puts the thread name in a menu trigger rather than in flat text', () => {
    expect(flat('<MenuTrigger')).toBe(true);
    // The panel's accessible name still comes from the thread title, which is
    // now inside the trigger: `aria-labelledby="ai-companion-title"` on both
    // the rail and the drawer points at it.
    expect(flat('id="ai-companion-title"')).toBe(true);
    expect(flat('{chatTitle}')).toBe(true);
  });

  it('offers switching threads, a new one, and deleting this one — in that menu', () => {
    expect(flat('<MenuItem onSelect={handleOpenHistory}')).toBe(true);
    expect(flat('<MenuItem onSelect={handleNewChat}')).toBe(true);
    expect(flat('onSelect={() => setShowClearConfirm(true)}')).toBe(true);
  });

  it('keeps "+" as its own control, named for what it makes', () => {
    expect(flat('aria-label="New chat"')).toBe(true);
  });

  it('keeps the collapse control the room passes (#126)', () => {
    // The set room passes `closable` + `onClose` + `closeLabel="Collapse
    // Lantern AI"`. Dropping this branch would make a docked panel
    // undismissable again, which is the bug #126 fixed.
    expect(flat('{(variant !== \'rail\' || closable) && (')).toBe(true);
    expect(flat("aria-label={closeLabel ?? 'Close AI companion'}")).toBe(true);
  });

  it('leaves no 44px target behind in the header', () => {
    // Every header control is an icon button; each one carries the target.
    const header = PANEL.slice(PANEL.indexOf('{/* Header.'), PANEL.indexOf('{/* Clear confirm'));
    const buttons = header.match(/<button\b/g)?.length ?? 0;
    expect(buttons).toBeGreaterThanOrEqual(2);
    expect(header.match(/min-h-\[44px\] min-w-\[44px\]/g)?.length).toBe(buttons);
  });
});

describe('the greeting', () => {
  it('greets by name in the serif display step', () => {
    // `text-title` is the step that carries `--font-display`; a `font-serif`
    // class here would be a second vocabulary for the same decision.
    expect(flat('{firstName ? `Hello, ${firstName}` : "Hi, I\'m Lantern"}')).toBe(true);
    expect(flat('<p className={`text-title')).toBe(true);
    expect(flat('How can I help?')).toBe(true);
  });

  it('takes the name from the context the model is already told, not a second source', () => {
    expect(flat("firstName={context?.userName || currentUser?.firstName || ''}")).toBe(true);
  });
});

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

describe('the composer', () => {
  const COMPOSER = PANEL.slice(PANEL.indexOf('{/* THE COMPOSER'), PANEL.indexOf('<AIDisclaimer'));

  it('puts the field and send on one row and the modifiers underneath', () => {
    // The order in the source IS the order on screen: textarea, send, then the
    // tool bar. Before wave 4 three icon buttons sat to the LEFT of the field,
    // which at 400px left the field about half the row.
    const field = COMPOSER.indexOf('<textarea');
    const send = COMPOSER.indexOf('aria-label="Send message"');
    const tools = COMPOSER.indexOf('The tool bar');
    expect(field).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(field);
    expect(tools).toBeGreaterThan(send);
  });

  it('keeps the placeholder in Lantern’s own voice', () => {
    // The reference says "Ask your AI tutor anything…"; the tutor has a name
    // here, and it is the one the panel introduces itself with.
    expect(COMPOSER).toContain("'Ask Lantern anything…'");
  });

  it('draws send at the measured 32×32', () => {
    expect(COMPOSER).toContain('h-8 w-8 items-center justify-center rounded-full');
  });

  it('keeps every tool-bar control on a 44px target', () => {
    const toolbar = COMPOSER.slice(COMPOSER.indexOf('The tool bar'));
    const buttons = toolbar.match(/<button\b/g)?.length ?? 0;
    expect(buttons).toBe(4); // image, attach, Guided, mic
    expect(toolbar.match(/min-h-\[44px\]/g)?.length).toBe(buttons);
  });

  it('keeps the Guided toggle, with its icon and its pressed state', () => {
    expect(COMPOSER).toContain('aria-pressed={guided}');
    expect(COMPOSER).toContain("<AppIcon name=\"school\" size={14} />");
  });

  it('keeps the mic, because the app really does transcribe', () => {
    // `startDictation` records with MediaRecorder and transcribes server-side;
    // this is the one reference voice control Lantern can honestly draw.
    expect(COMPOSER).toContain('startDictation()');
    expect(COMPOSER).toContain("name=\"mic\"");
  });

  it('draws no Call button, because there is no realtime voice model', () => {
    expect(PANEL).not.toMatch(/aria-label="(Start a )?[Cc]all/);
  });

  it('keeps the honesty line under the composer', () => {
    expect(PANEL).toContain('<AIDisclaimer compact />');
  });
});

describe('the tutor-style picker (F2)', () => {
  it('sits in the header, beside the thread menu', () => {
    const header = PANEL.slice(PANEL.indexOf('{/* Header.'), PANEL.indexOf('{/* Clear confirm'));
    expect(header).toContain('<TutorStylePicker');
    expect(header).toContain('value={tutorStyle}');
    expect(header).toContain('onChange={handlePickTutorStyle}');
  });

  it('shows the style as a header chip, and only when one has been picked', () => {
    // A chip over every thread is chrome that stops being read — the same
    // problem wave 4 fixed in this row. The default style shows nothing.
    expect(flat("{tutorStyle !== 'default' && (")).toBe(true);
    expect(flat('Style: {tutorStyleLabel}')).toBe(true);
  });

  it('names the style under the greeting', () => {
    expect(flat('{tutorStyleLabel} mode')).toBe(true);
  });

  it('reads the style from the account, not from component state', () => {
    // A `useState` here is how the drawer and a docked rail end up on
    // different styles: the settings blob is the single source.
    expect(flat('const tutorStyle = currentTutorStyleId(currentUser?.settings);')).toBe(true);
    expect(flat('setTutorStyle(styleId);')).toBe(true);
  });

  it('sends the style with every turn, so it applies from the NEXT message', () => {
    const enriched = PANEL.slice(
      PANEL.indexOf('const enrichedContext'),
      PANEL.indexOf('const guidedGoals')
    );
    expect(enriched).toContain('tutorStyle,');
  });
});

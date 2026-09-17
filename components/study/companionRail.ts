/**
 * How much of a set room the AI companion is allowed to take, decided from the
 * width the room ACTUALLY has rather than from the width of the window.
 *
 * WHY THIS FILE EXISTS (issue #105). `CourseWorkspace` used to dock the
 * companion whenever `window.matchMedia('(min-width: 1024px)')` matched. A media
 * query answers "how wide is the window", not "how wide is the column this
 * component is rendered into", and in this app those are very different numbers:
 * the shell puts up to 608px of persistent chrome to the left of the studio (the
 * 224px sidebar plus the 384px chats flyout, which defaults to OPEN). At a
 * 1030px viewport the query said "plenty of room" and docked a 384px rail on a
 * room that then had about 100px left for the studio; at a 1006px viewport with
 * the nav stood down it said "no room" while the studio had ~940px.
 *
 * So the decision is a pure function of ONE measured number — the width of the
 * room's own row container — and everything else is a constant declared here.
 * `hooks/useCompanionRail` does the measuring; this file does the deciding, and
 * is tested on its own (`companionRail.test.ts`).
 *
 * THE RULE, IN ONE LINE: the studio comes first. The companion docks only if
 * what is left after it still clears `COMPANION_RAIL_STUDIO_MIN`; otherwise the
 * companion becomes a 48px rail the student can expand into an overlay.
 */

/** Which of the room's two states the student's preference belongs to. */
export type CompanionRailSurface = 'home' | 'focus';

/** What the student has chosen for a surface. Persisted in `ui-storage`. */
export type CompanionRailPreference = 'open' | 'collapsed';

/** The student's stored choice per surface. */
export type CompanionRailPreferences = Record<CompanionRailSurface, CompanionRailPreference>;

/**
 * DEFAULTS, and why they differ.
 *
 * The set home is a browsing surface: StudyFetch keeps chat visible there, and
 * so do we. A studio is not — focus mode's whole claim is that the screen goes
 * to studying, so the companion starts as a rail and is one click away.
 */
export const COMPANION_RAIL_DEFAULTS: CompanionRailPreferences = {
  home: 'open',
  focus: 'collapsed',
};

/**
 * The narrowest studio we are willing to leave behind. Below this a quiz
 * question wraps to four lines and a flashcard stops being readable, which is
 * the failure the issue was filed about.
 */
export const COMPANION_RAIL_STUDIO_MIN = 560;

/** The narrowest the docked companion is ever drawn. */
export const COMPANION_RAIL_MIN_WIDTH = 384;

/** The collapsed rail: one 44×44 button centred in a 48px column. */
export const COMPANION_RAIL_COLLAPSED_WIDTH = 48;

/**
 * The docked widths, widest first. The rail grows on a roomy row the way it
 * used to grow at `xl` / `2xl`, except the number it grows on is the row's own
 * width, so a wide window with both nav columns open no longer counts as roomy.
 */
const DOCK_WIDTHS = [512, 448, COMPANION_RAIL_MIN_WIDTH] as const;

/** The docked width, in px. A union so the class lookup below stays total. */
export type CompanionRailDockWidth = (typeof DOCK_WIDTHS)[number];

/**
 * What a row of a given width can hold. Everything the layout needs to know,
 * derived once so the hook can compare two fits for equality and re-render only
 * when the ANSWER changes rather than on every observed pixel.
 */
export interface CompanionRailFit {
  /** Is there room for the 48px rail at all, studio minimum still intact? */
  fits: boolean;
  /** Is there room to dock the panel and still leave the studio its minimum? */
  canDock: boolean;
  /** The width the panel would dock at. Meaningless when `canDock` is false. */
  dockWidth: CompanionRailDockWidth;
}

/** Tailwind classes for the three docked widths. Literals, so the scanner sees them. */
export const COMPANION_RAIL_WIDTH_CLASS: Record<CompanionRailDockWidth, string> = {
  384: 'w-96',
  448: 'w-[28rem]',
  512: 'w-[32rem]',
};

/**
 * The width a row must have before the rail is drawn at all.
 *
 * Below it the companion is reached from the header's Chat button and opens as
 * the overlay drawer — which is exactly what every narrow window did before
 * this change, so a phone-shaped room is untouched.
 */
export const COMPANION_RAIL_MIN_ROW =
  COMPANION_RAIL_STUDIO_MIN + COMPANION_RAIL_COLLAPSED_WIDTH;

/** The width a row must have before the panel can dock at its narrowest. */
export const COMPANION_RAIL_DOCK_MIN_ROW =
  COMPANION_RAIL_STUDIO_MIN + COMPANION_RAIL_MIN_WIDTH;

export function companionRailFit(rowWidth: number): CompanionRailFit {
  const dockWidth =
    DOCK_WIDTHS.find((width) => rowWidth - width >= COMPANION_RAIL_STUDIO_MIN) ??
    COMPANION_RAIL_MIN_WIDTH;
  return {
    fits: rowWidth >= COMPANION_RAIL_MIN_ROW,
    canDock: rowWidth >= COMPANION_RAIL_DOCK_MIN_ROW,
    dockWidth,
  };
}

/** Two fits are the same decision when all three answers agree. */
export function sameCompanionRailFit(a: CompanionRailFit, b: CompanionRailFit): boolean {
  return a.fits === b.fits && a.canDock === b.canDock && a.dockWidth === b.dockWidth;
}

/**
 * What the room draws.
 *
 *  - `none`     — no rail. The header keeps its Chat button and the companion
 *                 is the overlay drawer, as it has always been on narrow rooms.
 *  - `collapsed`— the 48px rail. Its button expands: into the docked panel when
 *                 the row can hold one, into the overlay when it cannot.
 *  - `docked`   — today's panel, beside the studio.
 */
export type CompanionRailMode = 'none' | 'collapsed' | 'docked';

/**
 * The decision.
 *
 * `request` is a session-only override: a programmatic open ("Ask Lantern", the
 * focus bar's Chat button, an attached note) expands the rail without being the
 * student's choice of default, so it never reaches the store. The stored
 * `preference` is what a fresh room starts from.
 *
 * NOTE the asymmetry, which is deliberate: a stored `open` on a row that cannot
 * dock renders `collapsed` and NOT an overlay. A sheet thrown over the studio on
 * arrival is not what "keep the companion visible" meant; the rail button is
 * there, and it opens the overlay when the student asks for it.
 */
export function decideCompanionRail(input: {
  /** The measured row width in CSS px. */
  rowWidth: number;
  preference: CompanionRailPreference;
  request?: 'expand' | null;
}): CompanionRailMode {
  return companionRailMode(companionRailFit(input.rowWidth), input.preference, input.request);
}

/**
 * The same decision, taken from a fit the hook has already computed.
 *
 * `useCompanionRail` keeps a FIT in state rather than a width, so that a resize
 * that does not change the answer does not re-render the room; this is where it
 * turns that fit into a mode.
 */
export function companionRailMode(
  fit: CompanionRailFit,
  preference: CompanionRailPreference,
  request?: 'expand' | null
): CompanionRailMode {
  if (!fit.fits) return 'none';
  const wantsOpen = request === 'expand' || preference === 'open';
  return wantsOpen && fit.canDock ? 'docked' : 'collapsed';
}

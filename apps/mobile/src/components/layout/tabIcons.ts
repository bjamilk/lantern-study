/**
 * Which glyph each bottom tab draws, and the rule that keeps active and
 * inactive telling apart by FORM rather than by colour alone.
 *
 * The bar shipped with one outline glyph in both states and a purple tint on
 * the current one, which is exactly the failure the accessibility rule names:
 * a reader who cannot separate the two hues cannot tell where they are. The
 * current tab now draws the SAME glyph DUOTONE — `AppIcon`'s `tone="active"`,
 * an ink stroke over a tint fill — so the shape itself changes, with the bold
 * label as the third signal.
 *
 * Not every glyph survives being filled. lucide draws several as a container
 * plus interior detail, and a fill paints the detail out: `person-circle`
 * (CircleUser) becomes a plain disc with the face erased. Any icon on this
 * bar has to read filled, which is why Me uses `person` (User) — head and
 * shoulders, unmistakable at 24px in either state. The general rule, and the
 * disc fallback for the glyphs that fail it, live in ui/appIconTone.ts.
 *
 * Pure and importing nothing at runtime (both imports are types, erased at
 * compile time) so the choice is unit-tested even though the bar itself is a
 * native component this jest environment cannot render.
 */
import type { AppIconName } from '../ui/AppIcon';
import { BOTTOM_TABS, type BottomTabKey } from './tabRouting';

/** One glyph per destination, drawn outline when idle and solid when current. */
export const TAB_ICONS: Record<BottomTabKey, AppIconName> = {
  Home: 'home',
  Study: 'school',
  Chat: 'chatbubbles',
  Campus: 'business',
  Me: 'person',
};

/**
 * Glyphs that must never appear on the bar because their filled form is a
 * blob: the fill erases the interior detail that made them recognisable.
 */
export const UNFILLABLE_TAB_ICONS: readonly AppIconName[] = [
  'person-circle',
  'ellipse',
  'radio-button-off',
  'radio-button-on',
  'square',
  'checkmark-circle',
];

/** Every tab draws its own glyph — five identical shapes would be no map. */
export function tabIconsAreDistinct(): boolean {
  const names = BOTTOM_TABS.map((tab) => TAB_ICONS[tab]);
  return new Set(names).size === names.length;
}

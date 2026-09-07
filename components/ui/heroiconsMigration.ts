/**
 * The heroicons -> AppIcon translation table.
 *
 * Pure data. Nothing renders from this file: it is the map the icon sweep
 * follows, and the thing a test can hold the codebase against so the sweep
 * cannot quietly leave an icon behind. Every `@heroicons/react` component
 * imported anywhere under components/, utils/, hooks/, services/, stores/ or
 * App.tsx has an entry here, and heroiconsMigration.test.ts fails the build if
 * one appears without one.
 *
 * HOW A CALL SITE TRANSLATES
 *
 *   import { SparklesIcon } from '@heroicons/react/24/outline';
 *   <SparklesIcon className="w-5 h-5 text-red-500" />
 *
 * becomes
 *
 *   import { AppIcon } from './ui/AppIcon';
 *   <AppIcon name="sparkles" size={20} className="text-red-500" />
 *
 * Note the sizing: `w-5 h-5` is 20px, so it becomes `size={20}` (Tailwind's
 * scale is 4px per step) and NOT a class. AppIcon's `size` drives the stroke
 * ramp as well as the box; leaving the class on would shrink the glyph while
 * the stroke stayed sized for a 24px box. AppIcon warns about this in dev.
 *
 * The colour class stays exactly as it was — lucide strokes in `currentColor`.
 *
 * A `24/solid` import becomes the same name plus `filled`, EXCEPT for the
 * glyphs in SOLID_KEEPS_OUTLINE below.
 */
import type { AppIconName } from './appIconMap';

/**
 * Heroicons component name -> the app's own icon name. Both the `24/outline`
 * and `24/solid` imports of a name resolve here; the variant only decides
 * `filled`.
 */
export const HEROICON_TO_APP_ICON = {
  AcademicCapIcon: 'school',
  ArrowLeftIcon: 'arrow-back',
  // The classical-portico building, i.e. an institution — NOT the app's
  // `library` (books on a shelf), which is a different screen entirely.
  BuildingLibraryIcon: 'institution',
  DocumentTextIcon: 'document-text',
  PlusIcon: 'add',
  QrCodeIcon: 'qr-code',
  RectangleStackIcon: 'albums',
  ShoppingBagIcon: 'bag',
  SparklesIcon: 'sparkles',
  UserGroupIcon: 'people',
} as const satisfies Record<string, AppIconName>;

export type HeroiconName = keyof typeof HEROICON_TO_APP_ICON;

/**
 * Heroicons whose `24/solid` import must NOT become `filled`.
 *
 * A fill only reads as "solid" when the outline encloses the whole shape and
 * the interior carries no meaning. Two families fail that test and are listed
 * here:
 *
 *  - Containers whose interior detail IS the glyph. `circle-check` filled is a
 *    flat disc; `file-text` filled loses its lines; `house` filled loses its
 *    door. Heroicons' solid set redraws these by hand, lucide cannot.
 *  - Open paths — a tick, a chevron, an arrow, a bolt of a stroke. SVG closes
 *    them implicitly and fills a shape nobody drew, or nothing at all.
 *
 * For these the sweep drops `filled` and lets the call site's own colour class
 * carry the emphasis the solid variant was there for. Everything else — heart,
 * star, bookmark, bell, flame, play — fills cleanly.
 */
export const SOLID_KEEPS_OUTLINE: readonly HeroiconName[] = [
  'AcademicCapIcon',
  'ArrowLeftIcon',
  'DocumentTextIcon',
  'RectangleStackIcon',
  'ShoppingBagIcon',
];

/** True when a `24/solid` import of this heroicon should keep its outline. */
export function solidKeepsOutline(name: HeroiconName): boolean {
  return SOLID_KEEPS_OUTLINE.includes(name);
}

/**
 * Tailwind's spacing scale is 4px per step, so `w-5` is 20px. The sweep uses
 * this to turn a sizing class into AppIcon's `size`.
 */
export function sizeForTailwindStep(step: number): number {
  return step * 4;
}

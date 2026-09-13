import {
  DEFAULT_ACCENT_COLOR,
  isDefaultAccentColor,
} from '@lantern/shared/settings';

export interface AccentPreset {
  hex: string;
  /** Shown under the swatch; only the default swatch carries one. */
  label?: string;
}

/**
 * The user-facing accent palette. The first entry MUST be
 * `DEFAULT_ACCENT_COLOR` (the ink) so a fresh account shows a selected swatch,
 * and selecting it persists the ink — which `applyAccentToColors` reads as
 * "leave the palette alone".
 */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { hex: DEFAULT_ACCENT_COLOR, label: 'Default' },
  { hex: '#0ea5e9' },
  { hex: '#10b981' },
  { hex: '#f59e0b' },
  { hex: '#ec4899' },
  { hex: '#8b5cf6' },
];

/**
 * Whether `stored` selects `preset`. The default swatch also owns the legacy
 * indigo, so an account that has never touched the setting since the pivot
 * still shows "Default" selected instead of no selection at all.
 */
export function isPresetSelected(stored: string | null | undefined, preset: AccentPreset): boolean {
  if (preset.hex === DEFAULT_ACCENT_COLOR) return isDefaultAccentColor(stored);
  return (stored ?? '').toLowerCase() === preset.hex.toLowerCase();
}

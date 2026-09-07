/**
 * Which glyph a community row draws. Spec v3 §5.7 "Campus".
 *
 * All five kinds sit on the SAME violet — Campus is one family, and painting
 * five hues down one list is the rainbow-noise failure §5.8 names. The glyph
 * is what separates a course room from a campus from an interest group, and it
 * is the only thing that changes between rows.
 *
 * Pure, and importing only types, so the map is unit-tested and an icon name
 * that does not exist is a compile error rather than a blank square.
 */
import type { CommunityKind } from '@lantern/shared/network';
import type { AppIconName } from '../../components/ui/appIconMap';

const ICONS: Record<CommunityKind, AppIconName> = {
  /** A whole university. */
  institution: 'business',
  /** A degree programme. */
  programme: 'school',
  /** One year of one programme. */
  level: 'calendar',
  /** A course room — the one that matters most, so it gets the book. */
  course: 'book',
  /** An interest group, which is about a subject and not about an enrolment. */
  topic: 'bulb',
};

/** An unknown kind falls back to the generic room rather than to nothing. */
export function communityRowIcon(kind: CommunityKind | string): AppIconName {
  return ICONS[kind as CommunityKind] ?? 'people';
}

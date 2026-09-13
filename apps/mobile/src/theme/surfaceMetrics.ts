/**
 * The geometry of the phone shell, in dp, measured rather than invented.
 *
 * Every number here was taken off StudyFetch's Android app at 1080x2400 /
 * 420 dpi (founder direction, 2026-09-11) and converted at that device's
 * density: dp = px / 2.625. The px figure is kept in the comment beside each
 * one so a later measurement can be checked against the same source instead of
 * being argued about.
 *
 * WHY A MODULE AND NOT LITERALS AT THE CALL SITES. The same pill height has to
 * be known by the bottom bar that draws it, by the contextual row that matches
 * it and by the tests that assert it; the same panel fraction has to be known
 * by `DoorTile` and by `doorTileLayout`. Three copies of 44 drift the first
 * time one of them is nudged. Colour is NOT here — hues live in the shared
 * token file and reach this app through `useTheme()`; this module is shape
 * only, so it imports nothing and is safe in the node jest environment.
 */

/** The device the measurements were taken on. dp = px / this. */
export const MEASURED_DENSITY = 2.625;

/** Convert a measured pixel figure to dp on that device. Rounded to 0.1 dp. */
export function dpFromMeasuredPx(px: number): number {
  return Math.round((px / MEASURED_DENSITY) * 10) / 10;
}

/**
 * The bottom bar.
 *
 * There is no separate bar SURFACE: the strip is the page ground with a
 * hairline rule across its top, which is what makes the black pill read as the
 * only object on it. The lit tab is that pill — 308x116 px — carrying a WHITE
 * glyph and a WHITE label; an idle tab is a grey outline glyph at 18 dp with
 * its label underneath. Lantern keeps labels on all five (StudyFetch drops
 * the idle ones; a five-destination map cannot afford that, and the in-Study
 * row shipped without them and was the build-176 device-pass finding).
 */
export const TAB_PILL = {
  /** 308 px. The pill's width when its label fits; it may shrink, never grow. */
  maxWidth: 117,
  /** 116 px. Also the pill's diameter, since it is fully rounded. */
  height: 44,
  /** Fully rounded: half the height, not a "large" radius. */
  radius: 22,
  /** The lit glyph, white, inside the pill. */
  activeGlyphSize: 20,
  /** The idle glyph, a grey outline on the bare ground. */
  inactiveGlyphSize: 18,
} as const;

/**
 * Buttons. 240x94 px for the primary, which is 36 dp tall at radius 18 — again
 * fully rounded, so a button and a lit tab are the same object at two widths.
 * Secondary is the same box with no fill and a hairline; destructive is the
 * same box filled red.
 */
export const BUTTON = {
  /** 94 px. The one height; `sm` and `lg` step around it. */
  height: 36,
  heightSmall: 30,
  heightLarge: 44,
  /** Half of `height`. A pill, not a rounded rectangle. */
  radius: 18,
  radiusSmall: 15,
  radiusLarge: 22,
  /** 240 px total on a 2-word label, i.e. ~18 dp of air each side. */
  paddingHorizontal: 18,
} as const;

/**
 * A door — the hub tile. 493x503 px, so very nearly square, with a pastel
 * panel over the TOP 66% of its height, 27 px of padding above the
 * illustration, and a hairline border. The footer strip below the panel is
 * white and carries the title beside a small glyph tinted to the panel's hue.
 *
 * THE HARD BLACK SHADOW IS GONE (2026-09-13, founder direction). It was a
 * 5 dp `#000000` offset with no blur, and it was the single biggest remaining
 * visual divergence from the app this one is being cut to match: every hue and
 * every ink token is now identical to StudyFetch's, and then each tile was
 * given a neo-brutalist drop shadow that no StudyFetch surface has, which is
 * what made a side-by-side read as two different products (SF2 mobile evidence
 * §5.2, §6 item 8). Flat is the whole app, not the set room — the token is
 * shared and that is intended.
 *
 * It is kept as `0` rather than deleted because `DoorTile` and
 * `doorTileLayout` both reserve room for it in real layout, and a flat tile is
 * exactly that reservation at zero; removing the field would churn three files
 * and a test to express the same thing.
 */
export const DOOR_TILE = {
  /** 503/493: height as a multiple of width. A door is slightly portrait. */
  aspectRatio: 503 / 493,
  /** The pastel panel's share of the tile's height. The defining proportion. */
  panelHeightFraction: 0.66,
  /** 27 px above the illustration inside the panel. */
  panelPaddingTop: 10,
  /** Flat: no shadow at all. See the note above for why the field survives. */
  shadowOffset: 0,
  radius: 16,
  /** 28 px between two doors in a row. */
  gridGutter: 11,
  /** 33 px from the screen edge. */
  pageMargin: 13,
  /** The glyph in the white footer, tinted to the panel's hue. */
  footerGlyphSize: 18,
} as const;

/**
 * The type tile — the pastel rounded square with a BLACK glyph that stands for
 * a feature. Two sizes only: 46 dp where it leads a list row, 44 dp inside a
 * bottom sheet. The 24 dp form is the dense inline mark, kept from the old
 * disc, and 56 is the door's own mark.
 */
export const TYPE_TILE = {
  listRow: 46,
  sheetRow: 44,
  /** Radius as a share of the side: a squircle, not a circle and not a box. */
  radiusFraction: 0.3,
  /** Glyph as a share of the side. Half: the pastel is most of the mark. */
  glyphFraction: 0.5,
} as const;

/**
 * Bottom sheets. Top corners at ~23 dp, a 64x6 dp grabber centred above the
 * heading, the sheet's own ground the page CREAM (not white) so the white rows
 * inside it read as separate objects, and the heading set in the serif.
 */
export const SHEET = {
  topRadius: 23,
  grabberWidth: 64,
  grabberHeight: 6,
  grabberRadius: 3,
  /** The white rows inside the cream sheet. */
  rowRadius: 14,
  rowMinHeight: 52,
  paddingHorizontal: 16,
} as const;

/** Cards: radius 16, padding 20. One shape for every neutral container. */
export const CARD = {
  radius: 16,
  padding: 20,
} as const;

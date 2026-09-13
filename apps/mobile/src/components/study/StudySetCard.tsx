/**
 * One study set, as a row on the Study hub.
 *
 * The hub used to draw `FeatureRow`s — a disc, a title, one grey meta line —
 * while HOME drew a far richer card for the SAME object: tile, progress bar,
 * counts, "last studied". The device pass called it out ("Lantern's Home set
 * cards are richer than either list… that card belongs on the Study screen
 * too"), and the effect was that the screen named after study sets said less
 * about a set than the screen that only lists four of them.
 *
 * So this is Home's content in StudyFetch's clothes: flat white card, one
 * hairline, no hard offset shadow (the neo-brutalist shadow is the one
 * treatment no StudyFetch surface uses), a pastel tile that differs per set,
 * and a kebab that opens the set's actions instead of hiding them one level
 * deeper in the room's `More` menu.
 *
 * Presentational only. It takes numbers and strings, never a store, so the
 * screen decides what a "material" is and this decides what it looks like.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { AppIcon, T, type AppIconName } from '../ui';
import { useTheme } from '../../theme';
import {
  setCountChips,
  setTileArt,
  type SetCounts,
  type SetTileGlyph,
} from './setPresentation';
import { setTileSkin } from './setTileColors';
import { SetCoverSquare } from './SetCoverSquare';

/** Glyph per chip kind. The chips are scanned, not read, so each carries one. */
const CHIP_ICONS: Record<string, AppIconName> = {
  materials: 'document-text',
  lectures: 'mic',
  decks: 'layers',
  tests: 'clipboard',
  quizzes: 'help-circle',
};

/**
 * The tile glyph names, in the app's own icon vocabulary.
 *
 * `setPresentation.ts` names glyphs the way the design direction does
 * (`lightbulb`, `monitor`) because the same six names ship on web, where the
 * icon set is a different one. The translation lives here rather than in the
 * contract. `easel` is this set's nearest thing to a screen; there is no
 * monitor glyph mapped, and adding one to the shared icon map from this lane
 * would collide with two other lanes editing `components/ui`.
 */
export const TILE_ICONS: Record<SetTileGlyph, AppIconName> = {
  layers: 'layers',
  monitor: 'easel',
  lightbulb: 'bulb',
  book: 'book',
  flask: 'flask',
  globe: 'globe',
};

/**
 * How many chips fit on one line at the largest font-size setting before the
 * row wraps into a second line of grey. The rest collapse into `+N`.
 */
const MAX_CHIPS = 4;

export interface StudySetCardProps {
  setId: string;
  title: string;
  /** The set's own picture. Absent or unsigned, the pastel art is drawn. */
  coverPath?: string | null;
  /** A picture chosen on this device and not yet uploaded. */
  pendingCoverUri?: string | null;
  counts: SetCounts;
  /** 0-100, already clamped by the caller. */
  percent: number;
  /**
   * What the percentage MEANS. `plan` is real coverage of the set's topics;
   * `counts` is how much of the set exists, which is not mastery and must not
   * be labelled as if it were.
   */
  progressBasis: 'plan' | 'counts';
  /** "3m ago" / "Yesterday" / "" when the set has never been studied. */
  studiedLabel: string;
  /** The topic the student stopped on, when the set knows it. */
  resumeTopic?: string | null;
  onPress: () => void;
  onMenu: () => void;
  testID?: string;
}

export function StudySetCard({
  setId,
  title,
  coverPath,
  pendingCoverUri,
  counts,
  percent,
  progressBasis,
  studiedLabel,
  resumeTopic,
  onPress,
  onMenu,
  testID,
}: StudySetCardProps) {
  const { colors, isDark } = useTheme();
  const art = setTileArt(setId, title);
  const skin = setTileSkin(art.hue, isDark);
  const chips = setCountChips(counts);
  const shown = chips.slice(0, MAX_CHIPS);
  const overflow = chips.length - shown.length;
  const progressLabel =
    progressBasis === 'plan' ? `${percent}% complete` : `${percent}% set up`;

  return (
    <View
      className="rounded-lantern-xl border border-lantern-border bg-lantern-surface mb-2"
      // Flat, with one hairline. No `shadowOffset`/`elevation`: the founder's
      // reference draws set cards as paper on cream, and the hard black offset
      // shadow the room tiles carry is what makes this app photograph as a
      // different product from the one it is being matched to.
      style={{ borderColor: colors.border }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[
          title,
          chips.map((c) => c.label).join(', '),
          progressLabel,
          studiedLabel ? `Last studied ${studiedLabel}` : '',
        ]
          .filter(Boolean)
          .join('. ')}
        testID={testID}
        className="p-3 active:opacity-80"
      >
        <View className="flex-row items-start gap-3">
          {/* The set's picture stands exactly where the pastel tile stands:
              same 44 square, same 14 radius, so a hub of sets with and without
              pictures is still one aligned column. */}
          <SetCoverSquare
            coverPath={coverPath}
            pendingUri={pendingCoverUri}
            size={44}
            radius={14}
            accessibilityLabel={`${title} picture`}
            fallback={
              <View
                style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: skin.tint }}
                className="items-center justify-center"
                importantForAccessibility="no-hide-descendants"
              >
                <AppIcon name={TILE_ICONS[art.glyph]} size={22} color={skin.ink} importantForAccessibility="no" />
              </View>
            }
          />

          <View className="flex-1 min-w-0">
            <T.Body style={{ fontWeight: '600' }} numberOfLines={1}>
              {title}
            </T.Body>

            {/* The count chips. Glyph + number + noun, so the row can be
                scanned without being read. */}
            {shown.length > 0 ? (
              <View className="flex-row items-center flex-wrap gap-x-3 gap-y-1 mt-1">
                {shown.map((chip) => (
                  <View key={chip.kind} className="flex-row items-center gap-1">
                    <AppIcon
                      name={CHIP_ICONS[chip.kind] ?? 'layers'}
                      size={13}
                      color={colors.textSecondary}
                      importantForAccessibility="no"
                    />
                    <T.Caption tone="secondary" numberOfLines={1}>
                      {chip.label}
                    </T.Caption>
                  </View>
                ))}
                {overflow > 0 ? (
                  <T.Caption tone="secondary">{`+${overflow}`}</T.Caption>
                ) : null}
              </View>
            ) : (
              // An empty set says what to do next, not nothing.
              <T.Caption tone="secondary" numberOfLines={1} className="mt-1">
                No materials yet — open to import some
              </T.Caption>
            )}
          </View>

          {/* The kebab, not a bare "Delete": a destructive action must not be
              the only thing a row offers, and it must not be one stray tap. */}
          <Pressable
            onPress={onMenu}
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${title}`}
            testID={testID ? `${testID}-menu` : undefined}
            hitSlop={8}
            className="min-w-[44px] min-h-[44px] items-end justify-center -mr-1 -mt-1 active:opacity-60"
          >
            <AppIcon name="ellipsis-vertical" size={18} color={colors.textSecondary} importantForAccessibility="no" />
          </Pressable>
        </View>

        <View
          style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }}
          className="mt-3 overflow-hidden"
          importantForAccessibility="no-hide-descendants"
        >
          <View
            // The percent is clamped by the caller, so no ratio reaches the
            // geometry raw and the bar can only ever be between empty and full.
            style={{
              width: `${percent}%`,
              height: 6,
              borderRadius: 3,
              backgroundColor: colors.primaryFill,
            }}
          />
        </View>

        <View className="flex-row items-center justify-between mt-1">
          <T.Caption tone="tertiary" numberOfLines={1} className="flex-1 pr-2">
            {/* "set up" vs "complete" is load-bearing: a 75% that means "three
                of the four things a set needs exist" must never be read as
                three quarters learnt. */}
            {progressLabel}
          </T.Caption>
          {/* Only when it HAS been studied — "Last studied never" tells a
              student off for a set they have just made. */}
          {studiedLabel ? (
            <T.Caption tone="tertiary" numberOfLines={1}>
              {`Last studied ${studiedLabel}`}
            </T.Caption>
          ) : null}
        </View>

        {/* The resume pill names the topic when the set knows one, because
            "Continue" with no object is a button you have to open to
            understand. */}
        {resumeTopic ? (
          <View
            style={{ backgroundColor: colors.primaryFill }}
            className="self-start mt-3 px-3 py-1.5 rounded-full"
          >
            <T.Caption style={{ color: colors.textInverse, fontWeight: '600' }} numberOfLines={1}>
              {`Resume · ${resumeTopic}`}
            </T.Caption>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

export default StudySetCard;

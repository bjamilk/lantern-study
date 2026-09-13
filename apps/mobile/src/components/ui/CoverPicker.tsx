/**
 * Cover picker — the sheet, the optimistic tile, and the failure line.
 *
 * Three pieces, because they live in three places on the screen:
 *
 *  - `useCoverPicker(target, options)` owns the work and the state. The screen
 *    calls `controller.open()` from the kebab or the header.
 *  - `<CoverPicker controller={…} />` is the ActionSheet. Rows come from
 *    `coverPickerModel.ts`, so "Remove cover" cannot appear on a record that
 *    has none, and no "Generate" row can appear at all — there is no image
 *    generation in this app.
 *  - `<CoverFailureLine failure={…} />` goes UNDER the header, where the
 *    student is looking after pressing the thing that failed.
 *
 * The AppState guard is the non-obvious part. The system photo picker and the
 * camera are separate Android Activities that STOP this one, so AppState
 * reports 'background' the moment the chooser opens. Screens that close things
 * on background (the companion panel is one) would tear down the surface the
 * upload is reporting into. `pickerBusyRef` marks the window in which our own
 * Activity switch is not the student leaving, and `controller.isPickerBusy`
 * exposes it so a host screen can make the same exemption.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { FeatureKey } from '@lantern/shared/design';
import { ActionSheet, type ActionSheetItem } from './ActionSheet';
import { AppIcon, type AppIconName } from './AppIcon';
import { FeatureDisc, type FeatureDiscSize } from './FeatureDisc';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';
import { TYPE_TILE, useTheme } from '../../theme';
import {
  coverMenuItems,
  coverTileBox,
  coverTileSource,
  describeCoverFailure,
  type CoverFailure,
} from './coverPickerModel';
import {
  clearCover,
  pickCoverImage,
  uploadCover,
  type CoverTarget,
} from '../../services/coverUpload';

export interface CoverPickerOptions {
  /** Drives whether "Remove cover" is offered. */
  hasCover: boolean;
  /**
   * Offer "Take photo". A study set passes false: the reference's set-picture
   * block is one button into the system photo picker, and inventing a camera
   * flow it does not have is how two apps stop being the same app.
   */
  allowCamera?: boolean;
  /** Ceiling for a pick. Defaults to the deck/note 10 MB; a set passes 5 MB. */
  maxBytes?: number;
  /**
   * Persist the outcome. `coverPath` is null when the cover was removed.
   * Called AFTER the server confirms; the optimistic picture is handled here.
   */
  onApplied: (coverPath: string | null) => void;
}

export interface CoverPickerController {
  visible: boolean;
  open: () => void;
  close: () => void;
  /** The picked file, shown before the upload finishes. Null once applied. */
  pendingUri: string | null;
  busy: boolean;
  failure: CoverFailure | null;
  dismissFailure: () => void;
  /** True while OUR picker Activity is in front; see the file header. */
  isPickerBusy: () => boolean;
  items: ActionSheetItem[];
  /**
   * The two actions WITHOUT the sheet.
   *
   * A study set's settings screen draws StudyFetch's block — one `Upload
   * picture` button and a `Remove picture` link — so it needs to run the work
   * directly. A sheet of one row in front of a button that already says what
   * it does is a tap for nothing.
   */
  choose: () => void;
  remove: () => void;
}

export function useCoverPicker(
  target: CoverTarget,
  { hasCover, onApplied, allowCamera = true, maxBytes }: CoverPickerOptions
): CoverPickerController {
  const [visible, setVisible] = useState(false);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CoverFailure | null>(null);
  const pickerBusyRef = useRef(false);

  const run = useCallback(
    async (action: 'library' | 'camera' | 'remove') => {
      setFailure(null);
      if (action === 'remove') {
        setBusy(true);
        // Optimistic: the tile goes back to its pastel glyph now, not after
        // the round trip. A failure below puts the cover back by leaving the
        // stored path untouched.
        setPendingUri(null);
        try {
          await clearCover(target);
          onApplied(null);
        } catch (err) {
          setFailure(describeCoverFailure(err));
        } finally {
          setBusy(false);
        }
        return;
      }

      pickerBusyRef.current = true;
      try {
        const picked = await pickCoverImage(action, maxBytes);
        // null is a cancel or a refusal that already spoke for itself.
        if (!picked) return;
        setPendingUri(picked.localUri);
        setBusy(true);
        const result = await uploadCover(target, picked);
        onApplied(result.coverPath);
      } catch (err) {
        setPendingUri(null);
        setFailure(describeCoverFailure(err));
      } finally {
        setBusy(false);
        // Cleared a tick late: Android delivers the foreground AppState change
        // after the picker's promise resolves.
        setTimeout(() => {
          pickerBusyRef.current = false;
        }, 1200);
      }
    },
    [onApplied, target, maxBytes]
  );

  const items: ActionSheetItem[] = coverMenuItems({ hasCover, allowCamera }).map((item) => ({
    label: item.label,
    icon: item.icon as AppIconName,
    destructive: item.destructive,
    hint: item.hint,
    // Deferred a tick so the sheet's dismiss animation is not fighting the
    // picker Activity for the window.
    onPress: () => setTimeout(() => void run(item.action), 50),
  }));

  return {
    visible,
    open: () => setVisible(true),
    close: () => setVisible(false),
    pendingUri,
    busy,
    failure,
    dismissFailure: () => setFailure(null),
    isPickerBusy: () => pickerBusyRef.current,
    items,
    choose: () => void run('library'),
    remove: () => void run('remove'),
  };
}

/** The sheet itself. Render it once, anywhere in the screen. */
export function CoverPicker({
  controller,
  title = 'Cover image',
}: {
  controller: CoverPickerController;
  title?: string;
}) {
  return (
    <ActionSheet
      visible={controller.visible}
      title={title}
      items={controller.items}
      onClose={controller.close}
    />
  );
}

/**
 * The failure, in the student's words and the server's.
 *
 * One sentence always; the small print only when asked for, because "Waiting
 * on 20260913120000_cover_images.sql" is the operator's line, not theirs.
 */
export function CoverFailureLine({
  failure,
  onDismiss,
}: {
  failure: CoverFailure | null;
  onDismiss?: () => void;
}) {
  const { colors } = useTheme();
  const [showDetail, setShowDetail] = useState(false);
  // A new failure replaces the old small print rather than re-opening it.
  useEffect(() => setShowDetail(false), [failure]);
  if (!failure) return null;
  return (
    <View className="mx-4 mb-2" accessibilityLiveRegion="polite">
      <View className="flex-row items-start gap-2">
        <Text className="flex-1 text-red-600 dark:text-red-300 text-caption">
          {failure.message}
        </Text>
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <AppIcon name="close" size={14} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {failure.detail ? (
        <Pressable
          onPress={() => setShowDetail((v) => !v)}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text className="mt-0.5 text-red-600 dark:text-red-300 text-caption underline">
            {showDetail ? 'Hide details' : 'Details'}
          </Text>
        </Pressable>
      ) : null}
      {showDetail && failure.detail ? (
        <Text className="mt-0.5 text-lantern-text-secondary text-caption">{failure.detail}</Text>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ render */

/**
 * The cover as it appears on a list row.
 *
 * StudyFetch's shape: the picture FILLS the tile that the pastel square used
 * to occupy, at 4:3 and the same corner radius, with the type glyph demoted to
 * a small badge in the corner. Without a cover nothing changes — the pastel
 * `FeatureDisc` is still the mark, because a grey rectangle saying "no image"
 * is noise on a list of things that mostly have no image.
 *
 * `pendingUri` wins over `coverPath` so the picture a student just chose is on
 * screen before the upload finishes.
 */
export function CoverThumb({
  coverPath,
  pendingUri,
  feature,
  icon,
  label,
  size = 40,
}: {
  coverPath?: string | null;
  pendingUri?: string | null;
  feature: FeatureKey;
  icon: AppIconName;
  /** What the glyph means, for a reader that cannot see the picture. */
  label?: string;
  /** The FeatureDisc size this replaces. Height stays identical; 4:3 adds width. */
  size?: FeatureDiscSize;
}) {
  // `variant: 'thumb'` is the point of the 4:3 tile: the batcher signs the
  // sibling thumbnail, so a list of twenty decks does not pull twenty
  // full-size covers over a metered connection.
  const resolved = useResolvedStorageUrl(pendingUri ? null : coverPath, {
    variant: 'thumb',
  });
  const source = coverTileSource({ pendingUri, resolvedUri: resolved });

  if (source.kind === 'glyph') {
    return <FeatureDisc feature={feature} icon={icon} size={size} accessibilityLabel={label} />;
  }

  const { width, height, radius } = coverTileBox(size, TYPE_TILE.radiusFraction);
  const uri = source.uri;
  return (
    <View
      style={{ width, height, borderRadius: radius }}
      className="overflow-hidden bg-lantern-background-secondary"
      accessibilityLabel={label ? `${label} cover image` : 'Cover image'}
    >
      <Image source={{ uri }} style={{ width, height }} resizeMode="cover" />
      {/* The glyph still has to say what the row IS — a photo of a lecture
          slide does not. Demoted to a badge on a scrim so it survives a light
          picture, at the same 14 the row's other inline glyphs use. */}
      <View
        className="absolute bottom-1 left-1 rounded-md bg-black/55 p-1"
        importantForAccessibility="no-hide-descendants"
      >
        <AppIcon name={icon} size={14} color="#ffffff" />
      </View>
    </View>
  );
}

/** A header band, not a hero: 16:5. */
const COVER_BANNER_ASPECT = 16 / 5;

/**
 * The cover as it appears on a detail screen: a 16:5 banner above the title.
 *
 * 16:5 rather than 16:9 on purpose — a header band, not a hero. A taller image
 * pushes the deck's study buttons and the note's body off the first screen,
 * which is the content the student opened the record for.
 */
export function CoverBanner({
  coverPath,
  pendingUri,
  accessibilityLabel,
}: {
  coverPath?: string | null;
  pendingUri?: string | null;
  accessibilityLabel?: string;
}) {
  const resolved = useResolvedStorageUrl(pendingUri ? null : coverPath, {
    variant: 'original',
  });
  const source = coverTileSource({ pendingUri, resolvedUri: resolved });
  if (source.kind === 'glyph') return null;
  return (
    <View
      className="mx-4 mt-3 mb-3 rounded-2xl overflow-hidden bg-lantern-background-secondary"
      accessibilityLabel={accessibilityLabel || 'Cover image'}
    >
      {/* `aspectRatio` rather than a measured height: no onLayout pass, no
          fallback pixel height to invent, and the band is the same shape on
          every width from a small phone to a tablet. */}
      <Image
        source={{ uri: source.uri }}
        style={{ width: '100%', aspectRatio: COVER_BANNER_ASPECT }}
        resizeMode="cover"
      />
    </View>
  );
}

export default CoverPicker;

/**
 * A study set's own picture, in the square its pastel tile occupies.
 *
 * WHY THIS IS NOT `CoverThumb`. A deck row's cover is 4:3 with the type glyph
 * demoted to a badge, because a deck row is a row of typed objects and the
 * glyph is what keeps them typed. A SET's cover is 1:1 and carries no badge:
 * StudyFetch draws the set chip as a square photograph, and the badge there
 * would be saying "this is a set" on a screen that lists nothing else.
 *
 * The box never changes: same edge length, same radius as the tile it stands
 * in for, so a grid of sets does not reflow one card at a time while the
 * signature batcher works. Until a path resolves — and whenever it cannot be
 * signed at all — the caller's own tile is what renders, which is the rule
 * `coverTileSource` already states for every other cover in the app.
 */
import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { useResolvedCoverUrl } from '../../hooks/useResolvedStorageUrl';
import { coverTileSource } from '../ui/coverPickerModel';

export interface SetCoverSquareProps {
  coverPath?: string | null;
  /** The picture just chosen, on screen before the upload finishes. */
  pendingUri?: string | null;
  /** The pastel tile this stands in for — rendered whenever there is no cover. */
  fallback: React.ReactNode;
  /** The tile's edge length. No new sizes: pass the one the caller already draws. */
  size: number;
  /** The tile's corner radius, in px, so the two shapes are one family. */
  radius: number;
  accessibilityLabel?: string;
}

export function SetCoverSquare({
  coverPath,
  pendingUri,
  fallback,
  size,
  radius,
  accessibilityLabel,
}: SetCoverSquareProps) {
  // `variant: 'thumb'` for the same reason deck rows use it: a hub of twenty
  // sets must not pull twenty full-size covers over a metered connection.
  const resolved = useResolvedCoverUrl(pendingUri ? null : coverPath, { variant: 'thumb' });
  // A URL that signs but will not LOAD (a deleted object, a thumb that was
  // never generated) used to leave an empty box where the tile art had been.
  // `failed` sends it back to the fallback: never a blank tile.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [pendingUri, resolved]);
  const source = coverTileSource({ pendingUri, resolvedUri: failed ? null : resolved });
  if (source.kind === 'glyph') return <>{fallback}</>;
  return (
    <View
      style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }}
      className="bg-lantern-background-secondary"
      accessibilityLabel={accessibilityLabel || 'Set picture'}
    >
      <Image
        source={{ uri: source.uri }}
        style={{ width: size, height: size }}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

export default SetCoverSquare;

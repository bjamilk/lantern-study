/**
 * The picture the voice is talking about.
 *
 * Deliberately NOT `WalkthroughPageViewer`: that one shows a whole page of
 * text under the image, which is the right thing when you are READING and the
 * wrong thing when something is reading TO you — the words being spoken are
 * already on screen, below this, highlighted. So this frame is the image, a
 * short text fallback, and nothing else.
 *
 * The image URL is short-lived and signed. It is never cached and never
 * retried: a URL that has expired will not come back by trying again, and a
 * retry loop behind a spinner just burns battery. When there is no picture the
 * frame says why in one line and the reading carries on — losing the slide is
 * not losing the lesson, and it is exactly what an offline replay looks like.
 */

import React, { useEffect, useState } from 'react';
import { Image, View, useWindowDimensions } from 'react-native';
import { Body, Caption } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';

/** Most document pages are taller than they are wide; A4 is 1:1.41. */
const PAGE_ASPECT = 1.414;

/** How much of a page's text to show under a missing picture. */
const FALLBACK_TEXT_LINES = 6;

export function NarrationPageFrame({
  pageIndex,
  imageUrl,
  text,
}: {
  pageIndex: number;
  imageUrl?: string;
  text?: string;
}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [imageUrl, pageIndex]);

  const showImage = Boolean(imageUrl) && !imageFailed;
  // 32 = the screen's own horizontal padding on both sides.
  const imageWidth = Math.max(0, width - 32);
  const trimmed = (text || '').trim();

  if (showImage) {
    return (
      <Image
        source={{ uri: imageUrl as string }}
        style={{
          width: imageWidth,
          // Shorter than the walk-through's full page: the player needs room
          // for the paragraph and the controls under it without scrolling.
          height: imageWidth * PAGE_ASPECT * 0.62,
          borderRadius: 12,
          backgroundColor: colors.surface,
        }}
        resizeMode="contain"
        accessibilityLabel={`Page ${pageIndex + 1}`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <View className="p-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface">
      <View className="flex-row items-center gap-2 mb-2">
        <AppIcon name="document" size={18} color={colors.textSecondary} />
        <Caption tone="secondary">{`Page ${pageIndex + 1} — showing the words, no picture`}</Caption>
      </View>
      {trimmed ? (
        <Body numberOfLines={FALLBACK_TEXT_LINES} style={{ color: colors.textSecondary }}>
          {trimmed}
        </Body>
      ) : (
        <Caption tone="secondary">Nothing on this page but what is being read.</Caption>
      )}
    </View>
  );
}

export default NarrationPageFrame;

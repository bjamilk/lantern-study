/**
 * One page of the document, as the student reads it.
 *
 * The image is the page and the text is the fallback, in that order, and the
 * fallback is not an error state: a page image is rendered lazily on the
 * server and a render that failed still answers with text (the pages route
 * swallows it on purpose). So a missing `imageUrl` shows the page's words
 * rather than a broken frame, and a page with NEITHER says it is blank instead
 * of leaving an empty rectangle the student has to interpret.
 *
 * The signed URL is short-lived. It is never cached anywhere in this component
 * — it arrives with the page and dies with it — which is the same lesson the
 * chat photos taught (a frozen signed URL that stopped resolving after a day).
 */

import React, { useEffect, useState } from 'react';
import { Image, View, useWindowDimensions } from 'react-native';
import { Body, Caption } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import type { WalkthroughPage } from './walkthroughModel';

/** Most document pages are taller than they are wide; A4 is 1:1.41. */
const PAGE_ASPECT = 1.414;

export function WalkthroughPageViewer({ page }: { page: WalkthroughPage | undefined }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  // The image is trusted to load until it says otherwise, and one failure
  // falls through to the text for good — a retry loop on a signed URL that
  // has expired just burns battery behind a spinner.
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [page?.imageUrl, page?.pageIndex]);

  if (!page) {
    return (
      <View className="items-center justify-center py-10">
        <Caption tone="secondary">This page could not be loaded.</Caption>
      </View>
    );
  }

  const text = (page.text || '').trim();
  const showImage = Boolean(page.imageUrl) && !imageFailed;
  // 32 = the screen's own horizontal padding on both sides.
  const imageWidth = Math.max(0, width - 32);

  return (
    <View>
      {showImage ? (
        <Image
          source={{ uri: page.imageUrl as string }}
          style={{
            width: imageWidth,
            height: imageWidth * PAGE_ASPECT,
            borderRadius: 12,
            backgroundColor: colors.surface,
          }}
          resizeMode="contain"
          accessibilityLabel={`Page ${page.pageIndex + 1}`}
          onError={() => setImageFailed(true)}
        />
      ) : null}

      {text ? (
        <View
          className="mt-3 p-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface"
          accessibilityLabel={`Text of page ${page.pageIndex + 1}`}
        >
          {!showImage ? (
            <Caption tone="secondary" className="mb-2">
              Showing this page as text.
            </Caption>
          ) : null}
          <Body selectable style={{ color: colors.text }}>
            {text}
          </Body>
        </View>
      ) : !showImage ? (
        <View className="mt-3 p-6 rounded-lantern-xl border border-lantern-border bg-lantern-surface items-center">
          <AppIcon name="document" size={22} color={colors.textSecondary} />
          <Caption tone="secondary" className="mt-2 text-center">
            Nothing readable on this page — no picture and no text.
          </Caption>
        </View>
      ) : (
        <Caption tone="secondary" className="mt-2">
          No readable text on this page.
        </Caption>
      )}
    </View>
  );
}

export default WalkthroughPageViewer;

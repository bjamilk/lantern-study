import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { COMMUNITY_BOARD_COPY } from '@lantern/shared/network';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';
import { ChatImageThumbnail } from '../chat/ChatMessageBody';
import { BOARD_GIF_COPY, isGifUpload } from '../../utils/boardAttachments';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

/** Same chip shape the board card already uses for its media affordance. */
const CHIP_CLASS =
  'self-start min-h-[44px] flex-row items-center rounded-full border border-lantern-border px-3';
const CHIP_ICON_COLOR = '#94a3b8';

function Chip({
  label,
  accessibilityLabel,
  onPress,
  icon = 'image',
  dim = false,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress?: () => void;
  icon?: AppIconName;
  dim?: boolean;
}) {
  const body = (
    <>
      <AppIcon name={icon} size={14} color={CHIP_ICON_COLOR} />
      <Text
        className={`ml-1.5 text-[12px] ${dim ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}
      >
        {label}
      </Text>
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel ?? label} className={CHIP_CLASS}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      className={CHIP_CLASS}
    >
      {body}
    </Pressable>
  );
}

/**
 * A board photo, resolved on READ.
 *
 * The url stored in `messages.text` (or `messages.image_url`) is a REFERENCE,
 * not something to hand to `<Image>`. It was signed when the photo was
 * uploaded and `clampSignedUrlTtl` caps every signed URL at 24 hours, so a day
 * later that string is a 400. `ChatImageThumbnail` answers a failed load with
 * `return null`, which is how a board post silently lost its photo with no
 * error anywhere on either platform.
 *
 * `useResolvedStorageUrl` re-signs through POST /api/v1/storage/signed-url[s]:
 * `parseStorageObjectUrl` strips the dead `sign/` prefix and the query, so
 * even an expired url still yields {bucket, path} and is re-authorised against
 * board membership. Resolves that land in the same tick are batched into one
 * request, so a post with twenty comment photos costs one call, not twenty.
 *
 * When it genuinely cannot resolve, this says so. A missing photo is a fact
 * the reader is entitled to, not something to hide.
 */
export function BoardImage({
  url,
  accessibilityLabel,
  maxWidth = 240,
  maxHeight,
  lowDataMode = false,
  variant,
}: {
  url?: string | null;
  accessibilityLabel: string;
  maxWidth?: number;
  maxHeight?: number;
  /**
   * Low-data mode does not download until asked, and then reads the 480px
   * sibling thumb that every chat upload already generates. Web has behaved
   * this way since the board shipped; this is the mobile half of that parity.
   */
  lowDataMode?: boolean;
  /**
   * Which stored variant to read. Board LIST cards pass `'thumb'` — the 480px
   * `<path>.thumb.webp` that `processImageForUpload` already writes for every
   * chat upload and that, until this phase, nothing ever asked for. The post
   * screen leaves it undefined and gets the full image.
   */
  variant?: 'thumb' | 'original';
}) {
  const [revealed, setRevealed] = useState(false);

  /**
   * A GIF has no usable thumb: `processImageForUpload` writes a STATIC
   * first-frame `.thumb.webp`, so rendering the thumb variant inline would
   * show a frozen frame that looks like a broken animation. The only honest
   * options are the whole file or a chip, and the whole file is never free —
   * a passthrough GIF is not resized, so twenty of them in a list is the
   * reader's entire data bill. So: a chip wherever a thumb was wanted, the
   * real (animating) file once they ask for it.
   */
  const isGif = isGifUpload({ uri: url });
  const wantsThumb = (variant ?? (lowDataMode ? 'thumb' : 'original')) === 'thumb';
  const gated = (lowDataMode || (isGif && wantsThumb)) && !revealed;
  const effectiveVariant: 'thumb' | 'original' = isGif ? 'original' : wantsThumb ? 'thumb' : 'original';

  // `null` while gated: the hook signs nothing, so tap-to-load is a real
  // promise — no bytes leave the network until the reader asks.
  const resolved = useResolvedStorageUrl(gated ? null : url, { variant: effectiveVariant });

  if (!url) return null;

  const tapLabel = isGif
    ? `${BOARD_GIF_COPY.gif} · ${COMMUNITY_BOARD_COPY.photoTapToLoad}`
    : COMMUNITY_BOARD_COPY.photoTapToLoad;

  if (gated) {
    return (
      <Chip
        label={tapLabel}
        accessibilityLabel={`${accessibilityLabel}. ${tapLabel}`}
        onPress={() => setRevealed(true)}
      />
    );
  }

  if (resolved === null) {
    return <Chip label={COMMUNITY_BOARD_COPY.photoUnavailable} dim />;
  }

  if (resolved === undefined) {
    return <Chip label={COMMUNITY_BOARD_COPY.photoLoading} dim />;
  }

  return (
    <ChatImageThumbnail
      uri={resolved}
      accessibilityLabel={isGif ? `${accessibilityLabel}, ${BOARD_GIF_COPY.gif}` : accessibilityLabel}
      maxWidth={maxWidth}
      {...(maxHeight ? { maxHeight } : {})}
      unavailableLabel={COMMUNITY_BOARD_COPY.photoUnavailable}
    />
  );
}

export default BoardImage;

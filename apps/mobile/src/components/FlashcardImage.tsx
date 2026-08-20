import React from 'react';
import { Image } from 'react-native';
import { useResolvedStorageUrl } from '../hooks/useResolvedStorageUrl';

/**
 * Renders a picture attached to an ordinary (non-occlusion) card. Storage
 * paths need resolving to a signed URL first, and nothing is drawn until that
 * resolves so the card never flashes a broken image. Same contract as the
 * private FlashcardImage inside SwipeableFlashcard — this one exists so study
 * modes outside the swipe review (cram, learn) can show the picture too.
 */
export function FlashcardImage({ url }: { url?: string | null }) {
  const uri = useResolvedStorageUrl(url ?? undefined);
  if (!url || !uri) return null;
  return (
    <Image
      source={{ uri }}
      style={{ width: '100%', height: 180, borderRadius: 12, marginBottom: 12 }}
      resizeMode="contain"
    />
  );
}

export default FlashcardImage;

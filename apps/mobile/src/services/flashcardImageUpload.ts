import * as ImagePicker from 'expo-image-picker';
import { uploadFlashcardImageBase64 } from './api';
import { prepareImageBase64ForUpload } from '../utils/prepareImage';

export interface PickedFlashcardImage {
  /** Local URI, shown immediately so the picture appears before the upload finishes. */
  localUri: string;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
}

/**
 * Ask for a picture from the library.
 *
 * Returns null when the user backs out or declines access, so callers can treat
 * "no image" and "cancelled" the same way instead of handling a thrown error.
 */
export async function pickFlashcardImage(): Promise<PickedFlashcardImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsMultipleSelection: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const mimeType = asset.mimeType || 'image/jpeg';
  const extension = mimeType.split('/')[1] || 'jpg';
  return {
    localUri: asset.uri,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    mimeType,
    fileName: asset.fileName || `flashcard-${Date.now()}.${extension}`,
  };
}

/**
 * Upload a picked image and return the stored URL to persist on the card.
 *
 * The asset is resized to the flashcard budget and sent as base64 JSON, which
 * is what POST /flashcards/upload-image accepts. The resize matters as well as
 * the encoding: base64 inflates by a third and the route rejects anything over
 * 10 MB.
 */
export async function uploadPickedFlashcardImage(
  image: PickedFlashcardImage,
  _userId: string,
  deckId?: string
): Promise<string> {
  const prepared = await prepareImageBase64ForUpload(image.localUri, 'flashcard', {
    fileName: image.fileName,
    mimeType: image.mimeType,
  });
  const result = await uploadFlashcardImageBase64({
    fileName: prepared.fileName,
    base64Data: prepared.base64Data,
    contentType: prepared.contentType,
    folder: deckId,
  });
  return result.url;
}

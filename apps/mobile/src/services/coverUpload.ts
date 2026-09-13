/**
 * Deck and note cover images — pick, upload, clear.
 *
 * The wire format is base64 JSON, not multipart. That is not a preference:
 * React Native's `FormData` file part needs a `{ uri }` blob the Hermes fetch
 * builds from a content:// path, which is exactly the path that goes stale
 * behind the picker on Android. `flashcardImageUpload.ts` learned this first;
 * covers use the same shape — `{ base64Data, fileName, contentType }` — and
 * the same 10 MB ceiling the server enforces.
 *
 * The image is re-encoded to the `marketplace` budget (1600px, q0.80) before
 * it is read. A cover is displayed at 4:3 on a list tile and 16:5 on a header;
 * shipping the phone's full 12 MP original would cost a student megabytes to
 * upload and then again on every read.
 */
import * as ImagePicker from 'expo-image-picker';
import { api } from './api';
import { prepareImageBase64ForUpload } from '../utils/prepareImage';
import { appAlert } from '../components/ui/appDialog';
import { coverRequestPath, validateCoverAsset } from '../components/ui/coverPickerModel';

/**
 * What the two cover routes answer with.
 *
 * Declared here rather than imported: the shared package defines the same
 * shape as `CoverImageResult` but does not re-export it from `api/index.ts`,
 * and that barrel belongs to the server half of this change.
 */
export interface CoverImageResult {
  coverPath: string;
  coverUrl: string;
  coverThumbUrl: string | null;
}

/** What the two cover routes take. */
export interface CoverUploadPayload {
  base64Data: string;
  fileName: string;
  contentType: string;
}

/**
 * A pick, ready to send, plus the on-device URI it came from.
 *
 * `localUri` is what makes the update optimistic: the tile shows THIS picture
 * the moment it is chosen, rather than the pastel placeholder until a signed
 * URL comes back over a campus connection.
 */
export interface PickedCoverImage extends CoverUploadPayload {
  localUri: string;
}

/**
 * Which record a cover belongs to.
 *
 * Decks and notes have identical routes; a STUDY SET's hangs off
 * `/users/me/study-sets/:id/cover` and takes a 5 MB ceiling rather than 10,
 * because that is the number its own settings block prints.
 */
export type CoverTargetKind = 'deck' | 'note' | 'study-set';

export interface CoverTarget {
  kind: CoverTargetKind;
  id: string;
}

/**
 * Ask for a picture and return it ready to upload.
 *
 * Returns null for every outcome that is not an error a person needs to read:
 * a declined permission (already explained by `appAlert` here), a cancelled
 * picker, or an asset the local rules refuse (explained the same way). Callers
 * treat null as "nothing to do" and only handle throws.
 */
export async function pickCoverImage(
  source: 'library' | 'camera',
  /** Ceiling for THIS pick. A study set passes its own 5 MB. */
  maxBytes?: number
): Promise<PickedCoverImage | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (permission.status !== 'granted') {
    appAlert(
      'Permission needed',
      source === 'camera'
        ? 'Camera access is required to photograph a cover.'
        : 'Photo library access is required to choose a cover.'
    );
    return null;
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.85, exif: false })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          exif: false,
          allowsMultipleSelection: false,
        });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const problem = validateCoverAsset(asset, maxBytes);
  if (problem) {
    appAlert('Cannot use that image', problem);
    return null;
  }

  const prepared = await prepareImageBase64ForUpload(asset.uri, 'marketplace', {
    fileName: asset.fileName,
    mimeType: asset.mimeType,
  });
  return {
    localUri: prepared.uri || asset.uri,
    base64Data: prepared.base64Data,
    fileName: prepared.fileName,
    contentType: prepared.contentType,
  };
}

/**
 * Send a picked cover.
 *
 * Returns the server's `coverPath` plus the two signed URLs. Persist the PATH
 * only: the URLs expire in 24h, which is the bug that killed chat photos
 * (`storageUrls.ts`), so every later read re-signs through the batcher.
 */
export async function uploadCover(
  target: CoverTarget,
  payload: CoverUploadPayload
): Promise<CoverImageResult> {
  // Rebuilt field by field rather than spread: a `PickedCoverImage` also
  // carries `localUri`, and a file:// path has no business on the wire.
  // Throws on an empty id rather than posting `/notes//cover`.
  coverRequestPath(target);
  const body: CoverUploadPayload = {
    base64Data: payload.base64Data,
    fileName: payload.fileName,
    contentType: payload.contentType,
  };
  if (target.kind === 'deck') return api.uploadDeckCover(target.id, body);
  if (target.kind === 'study-set') return api.uploadStudySetCover(target.id, body);
  return api.uploadNoteCover(target.id, body);
}

/** Drop a cover. The record keeps everything else. */
export async function clearCover(target: CoverTarget): Promise<void> {
  coverRequestPath(target);
  if (target.kind === 'deck') await api.clearDeckCover(target.id);
  else if (target.kind === 'study-set') await api.clearStudySetCover(target.id);
  else await api.clearNoteCover(target.id);
}

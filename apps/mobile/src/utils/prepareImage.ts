// The legacy entry point: readAsStringAsync was removed from the new
// expo-file-system API in SDK 54 and now throws when called through it.
// DeckDetailScreen already imports the legacy module for the same reason.
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  GIF_MIME_TYPE,
  base64ByteLength,
  gifFileName,
  gifSizeRefusal,
  isGifUpload,
} from './boardAttachments';

export type MobileImageBudget =
  | 'avatar'
  | 'flashcard'
  | 'question'
  | 'chat'
  | 'marketplace'
  | 'notePhoto'
  | 'companyLogo'
  | 'paymentProof'
  | 'chatWallpaper';

const BUDGETS: Record<
  MobileImageBudget,
  { maxDimension: number; compress: number }
> = {
  avatar: { maxDimension: 256, compress: 0.8 },
  flashcard: { maxDimension: 1600, compress: 0.8 },
  question: { maxDimension: 1600, compress: 0.8 },
  chat: { maxDimension: 1600, compress: 0.8 },
  marketplace: { maxDimension: 1600, compress: 0.8 },
  notePhoto: { maxDimension: 2000, compress: 0.82 },
  companyLogo: { maxDimension: 512, compress: 0.82 },
  paymentProof: { maxDimension: 1600, compress: 0.8 },
  // Cover-fits a 1080-wide phone with headroom: ~150-350 KB on disk and ~8 MB
  // decoded. Do not raise it, and do not reuse notePhoto (2000px) — this file
  // stays resident behind a scrolling list.
  chatWallpaper: { maxDimension: 1440, compress: 0.75 },
};

export type PreparedMobileImage = {
  uri: string;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
  /**
   * True when the original bytes are being uploaded untouched (an animated
   * GIF). The caller must then enforce the GIF byte cap itself, because
   * nothing downstream will shrink the file.
   */
  passthrough?: boolean;
};

/**
 * Which budgets may hand original bytes through instead of re-encoding.
 *
 * Only `chat` — the budget board posts, board comments, group chat and DMs all
 * share. An avatar, a flashcard visual or a marketplace photo is displayed at
 * a fixed small size and has no reason to carry an animation, and passing a
 * 5 MB GIF through into an avatar would be paid for on every screen that
 * renders it.
 */
const PASSTHROUGH_BUDGETS: ReadonlySet<MobileImageBudget> = new Set(['chat']);

/**
 * Resize + compress a local image URI before upload.
 * Falls back to the original URI if manipulation fails.
 * Never enlarges images smaller than the budget.
 *
 * An animated GIF on a passthrough budget is returned untouched:
 * `ImageManipulator` has no animated output format, so re-encoding it (which
 * this function did unconditionally) keeps frame one and silently throws the
 * animation away. See `utils/boardAttachments.ts` for the second half of that
 * trap, in the picker.
 */
export async function prepareImageForUpload(
  uri: string,
  budgetKey: MobileImageBudget,
  options?: { fileName?: string | null; mimeType?: string | null },
): Promise<PreparedMobileImage> {
  const budget = BUDGETS[budgetKey];
  const fallbackName = options?.fileName || `upload-${Date.now()}.jpg`;

  if (
    PASSTHROUGH_BUDGETS.has(budgetKey) &&
    isGifUpload({ uri, mimeType: options?.mimeType, fileName: options?.fileName })
  ) {
    return {
      uri,
      mimeType: GIF_MIME_TYPE,
      fileName: gifFileName(options?.fileName),
      passthrough: true,
    };
  }

  try {
    const probe = await ImageManipulator.manipulateAsync(uri, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const actions: ImageManipulator.Action[] = [];
    const maxEdge = Math.max(probe.width || 0, probe.height || 0);
    if (maxEdge > budget.maxDimension) {
      if ((probe.width || 0) >= (probe.height || 0)) {
        actions.push({ resize: { width: budget.maxDimension } });
      } else {
        actions.push({ resize: { height: budget.maxDimension } });
      }
    }

    const result =
      actions.length > 0
        ? await ImageManipulator.manipulateAsync(probe.uri, actions, {
            compress: budget.compress,
            format: ImageManipulator.SaveFormat.JPEG,
          })
        : await ImageManipulator.manipulateAsync(uri, [], {
            compress: budget.compress,
            format: ImageManipulator.SaveFormat.JPEG,
          });

    const baseName = fallbackName.replace(/\.[^/.]+$/, '') || 'upload';
    return {
      uri: result.uri,
      mimeType: 'image/jpeg',
      fileName: `${baseName}.jpg`,
      width: result.width,
      height: result.height,
    };
  } catch {
    return {
      uri,
      mimeType: options?.mimeType || 'image/jpeg',
      fileName: fallbackName,
    };
  }
}

/** Prepare then read as base64 for API uploads. */
export async function prepareImageBase64ForUpload(
  uri: string,
  budgetKey: MobileImageBudget,
  options?: { fileName?: string | null; mimeType?: string | null },
): Promise<{
  uri: string;
  fileName: string;
  contentType: string;
  base64Data: string;
  byteLength: number;
  passthrough: boolean;
}> {
  const prepared = await prepareImageForUpload(uri, budgetKey, options);

  // A passthrough GIF is never resized, so it is refused BEFORE it is read
  // into a base64 string — a 20 MB pick would otherwise become a ~27 MB JS
  // string on a 2 GB phone just to be rejected a line later. `getInfoAsync` is
  // best-effort: the base64 length below is the backstop when it says nothing.
  if (prepared.passthrough) {
    // `size` is always on a `FileInfo` whose `exists` is true — there is no
    // opt-in option for it in the legacy API.
    const info = await FileSystem.getInfoAsync(prepared.uri).catch(() => null);
    const refusal = gifSizeRefusal(
      info && info.exists && typeof info.size === 'number' ? info.size : null,
    );
    if (refusal) throw new Error(refusal);
  }

  const base64Data = await FileSystem.readAsStringAsync(prepared.uri, {
    encoding: 'base64',
  });
  if (!base64Data) {
    throw new Error('Could not read the selected image.');
  }

  const byteLength = base64ByteLength(base64Data);
  if (prepared.passthrough) {
    const refusal = gifSizeRefusal(byteLength);
    if (refusal) throw new Error(refusal);
  }

  return {
    uri: prepared.uri,
    fileName: prepared.fileName,
    contentType: prepared.mimeType,
    base64Data,
    byteLength,
    passthrough: !!prepared.passthrough,
  };
}

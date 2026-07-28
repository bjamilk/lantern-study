import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

export type MobileImageBudget =
  | 'avatar'
  | 'flashcard'
  | 'question'
  | 'chat'
  | 'marketplace'
  | 'notePhoto'
  | 'companyLogo'
  | 'paymentProof';

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
};

export type PreparedMobileImage = {
  uri: string;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
};

/**
 * Resize + compress a local image URI before upload.
 * Falls back to the original URI if manipulation fails.
 * Never enlarges images smaller than the budget.
 */
export async function prepareImageForUpload(
  uri: string,
  budgetKey: MobileImageBudget,
  options?: { fileName?: string | null; mimeType?: string | null },
): Promise<PreparedMobileImage> {
  const budget = BUDGETS[budgetKey];
  const fallbackName = options?.fileName || `upload-${Date.now()}.jpg`;
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
}> {
  const prepared = await prepareImageForUpload(uri, budgetKey, options);
  const base64Data = await FileSystem.readAsStringAsync(prepared.uri, {
    encoding: 'base64',
  });
  if (!base64Data) {
    throw new Error('Could not read the selected image.');
  }
  return {
    uri: prepared.uri,
    fileName: prepared.fileName,
    contentType: prepared.mimeType,
    base64Data,
  };
}

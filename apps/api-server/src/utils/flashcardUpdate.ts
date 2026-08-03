/**
 * Build a DB update payload that respects flashcards.check_flashcard_fields:
 * - CLOZE: cloze_text NOT NULL, front/back must be NULL
 * - BASIC: front/back NOT NULL
 * - IMAGE_OCCLUSION: image_url + front NOT NULL
 *
 * Clients historically send front:'' / back:null for cloze edits; empty string
 * is not NULL and would 500 on update.
 */
export function buildFlashcardUpdateData(
  cardType: string,
  updates: {
    front?: string | null;
    back?: string | null;
    clozeText?: string | null;
    imageUrl?: string | null;
    occlusionData?: unknown;
    srsData?: unknown;
    tags?: string[];
  },
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};

  if (updates.clozeText !== undefined) updateData.cloze_text = updates.clozeText;
  if (updates.imageUrl !== undefined) updateData.image_url = updates.imageUrl;
  if (updates.occlusionData !== undefined)
    updateData.occlusion_data = updates.occlusionData;
  if (updates.srsData !== undefined) updateData.srs_data = updates.srsData;
  if (updates.tags !== undefined) updateData.tags = updates.tags;

  if (cardType === "CLOZE") {
    if (
      updates.front !== undefined ||
      updates.back !== undefined ||
      updates.clozeText !== undefined
    ) {
      // Enforce constraint regardless of client sending '' / null / omitted fields.
      updateData.front = null;
      updateData.back = null;
    }
  } else {
    if (updates.front !== undefined) updateData.front = updates.front;
    if (updates.back !== undefined) updateData.back = updates.back;
  }

  return updateData;
}

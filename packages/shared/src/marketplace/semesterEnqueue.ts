import { STUDY_PACK_DRAFT_CREDITS } from './studyPacks';

export function maxSelectablePacks(
  creditsRemaining: number,
  costPerPack: number = STUDY_PACK_DRAFT_CREDITS,
): number {
  if (!Number.isFinite(creditsRemaining) || creditsRemaining <= 0 || costPerPack <= 0) return 0;
  return Math.floor(creditsRemaining / costPerPack);
}

/**
 * Fire existing POST /ai/study-pack/draft one course at a time.
 * Parallel POSTs each pass their own credit reserve and leave a ragged batch.
 */
export async function enqueueSemesterDraftsSequentially<T>(
  selected: Array<{ courseId: string; suggestedTitle: string }>,
  createDraft: (input: { courseId: string; title: string }) => Promise<T>,
): Promise<{ ok: number; failed: number; stopped: boolean; errors: string[] }> {
  let ok = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const pack of selected) {
    try {
      await createDraft({ courseId: pack.courseId, title: pack.suggestedTitle });
      ok += 1;
    } catch (err) {
      failed += 1;
      errors.push(err instanceof Error ? err.message : String(err));
      return { ok, failed, stopped: true, errors };
    }
  }
  return { ok, failed, stopped: false, errors };
}

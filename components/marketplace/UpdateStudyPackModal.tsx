import React, { useCallback, useEffect, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import { type StudyPackContentInput } from '@lantern/shared/marketplace';
import { RIGHTS_ATTESTATION_TEXT } from '@lantern/shared/moderation';
import { fetchMyStudyPacks, updateStudyPackContent } from '../../services/supabase';

/**
 * Push an update to a study pack you already sell (Phase 2 · G).
 *
 * The server has supported republish-as-update since packs shipped — version
 * bump, optimistic lock, and the buyer-side update-pull that both clients
 * already render — but NO client ever called it. A seller could publish a pack
 * and then never fix a typo in it, while buyers had an "Update available"
 * affordance that could never light up.
 *
 * Attestation is re-required on every update, because the content is changing
 * and the original attestation covered different material.
 */
export interface UpdateStudyPackModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Freshly built content from the deck/note this pack was made from. */
  content: StudyPackContentInput;
  /** Pre-select this pack when the caller knows which one. */
  defaultListingId?: string | null;
}

type MyPack = { listingId: string; title: string; version: number };

export const UpdateStudyPackModal: React.FC<UpdateStudyPackModalProps> = ({
  isOpen,
  onClose,
  content,
  defaultListingId,
}) => {
  const [packs, setPacks] = useState<MyPack[]>([]);
  const [listingId, setListingId] = useState<string>(defaultListingId || '');
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = (await fetchMyStudyPacks()) as unknown as MyPack[];
      setPacks(rows || []);
      if (!defaultListingId && rows?.length === 1) setListingId(rows[0].listingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your study packs');
    }
  }, [defaultListingId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  const counts = {
    flashcards: content.flashcards?.length || 0,
    questions: content.questions?.length || 0,
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!listingId) {
      setError('Choose which pack to update.');
      return;
    }
    if (!attested) {
      setError('Please confirm you have the right to share this material.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await updateStudyPackContent(listingId, content, {
        attestation: true,
        aiAssisted: false,
      });
      setDone(result.version);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the pack');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-pack-title"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-lantern-border bg-lantern-background p-5"
      >
        <div className="mb-3 flex items-start gap-2">
          <AppIcon name="refresh" size={20} className="mt-0.5 shrink-0 text-lantern-primary" aria-hidden />
          <div>
            <h2 id="update-pack-title" className="text-base font-semibold text-lantern-text">
              Push an update
            </h2>
            <p className="text-xs text-lantern-text-secondary">
              Everyone who bought this pack gets an “Update available” prompt.
            </p>
          </div>
        </div>

        {done != null ? (
          <>
            <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              Updated to version {done}. Buyers will be offered the new content.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-9 min-h-[44px] rounded-lg bg-lantern-primary px-4 text-sm font-medium text-white sm:min-h-[36px]"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="mb-1 block text-xs font-medium text-lantern-text" htmlFor="pack-select">
              Which pack?
            </label>
            <select
              id="pack-select"
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
              className="mb-3 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm text-lantern-text"
            >
              <option value="">Select a study pack…</option>
              {packs.map((p) => (
                <option key={p.listingId} value={p.listingId}>
                  {p.title} (v{p.version})
                </option>
              ))}
            </select>

            {packs.length === 0 && !error && (
              <p className="mb-3 text-xs text-lantern-text-secondary">
                You haven&apos;t published a study pack yet.
              </p>
            )}

            <p className="mb-3 text-xs text-lantern-text-secondary">
              This will replace the pack&apos;s content with {counts.flashcards} card
              {counts.flashcards === 1 ? '' : 's'}
              {counts.questions ? ` and ${counts.questions} questions` : ''}.
            </p>

            <label className="mb-3 flex items-start gap-2 text-xs text-lantern-text-secondary">
              <input
                type="checkbox"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
                className="mt-0.5"
              />
              <span>{RIGHTS_ATTESTATION_TEXT}</span>
            </label>

            {error && (
              <p className="mb-2 text-xs text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="h-9 min-h-[44px] rounded-lg px-3 text-sm text-lantern-text-secondary sm:min-h-[36px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !listingId || !attested}
                className="h-9 min-h-[44px] rounded-lg bg-lantern-primary px-4 text-sm font-medium text-white disabled:opacity-60 sm:min-h-[36px]"
              >
                {busy ? 'Updating…' : 'Push update'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
};

export default UpdateStudyPackModal;

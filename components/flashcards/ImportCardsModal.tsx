import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import { Button } from '../ui';
import Modal from '../ui/Modal';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { createDeckWithCards } from '../../services/apiEndpoints';
import { fetchAllFlashcards, mapDeckFromApi } from '../../services/supabase';
import {
  IMPORT_FILE_ACCEPT,
  batchDeckName,
  describeImportPlan,
  planCardImport,
  readImportFile,
  type ImportPlan,
  type ImportedCard,
} from './importPlanner';

interface ImportCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the first deck created, so the caller can open it. */
  onImported?: (deckId: string, deckName: string) => void;
}

const PLACEHOLDER = `Mitochondria\tThe powerhouse of the cell
Osmosis\tWater moving across a semi-permeable membrane`;

/**
 * The zero-credit door into Flashcards.
 *
 * Everything up to Save happens in this browser: the file is read here, the
 * parsing is the shared one, and the card count on screen is the count that
 * will be written. No AI use is spent, and none is offered — a student with an
 * exported deck should never have to buy their own cards back.
 */
export const ImportCardsModal: React.FC<ImportCardsModalProps> = ({ isOpen, onClose, onImported }) => {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [deckName, setDeckName] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showToast = useToastStore((s) => s.showToast);
  const currentUserId = useAuthStore((s) => s.currentUser?.id);

  // Keyed on the text alone: typing a deck name must not re-parse 200 cards on
  // every keystroke, so the name is applied to the finished plan instead.
  const parsed: ImportPlan = useMemo(() => planCardImport(text, { fileName }), [text, fileName]);
  const plan: ImportPlan = useMemo(
    () => (deckName.trim() ? { ...parsed, deckName: deckName.trim().slice(0, 80) } : parsed),
    [parsed, deckName]
  );

  const reset = useCallback(() => {
    setText('');
    setFileName(undefined);
    setDeckName('');
    setError(null);
    setProgress(null);
  }, []);

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const content = await readImportFile(file);
      setText(content);
      setFileName(file.name);
      // The file names the deck until the student types over it.
      setDeckName((current) => current || planCardImport(content, { fileName: file.name }).deckName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    }
  };

  const handleSave = async () => {
    if (plan.cards.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    setProgress({ done: 0, total: plan.batches.length });

    const name = (deckName.trim() || plan.deckName).slice(0, 80);
    // One key per import per batch: a retry after a dropped connection replays
    // the first write instead of minting a second deck.
    const runKey = `import:${Date.now().toString(36)}`;
    let firstDeck: { id: string; name: string } | null = null;
    let savedCards = 0;

    try {
      for (let i = 0; i < plan.batches.length; i++) {
        const batch = plan.batches[i]!;
        const response = await createDeckWithCards({
          clientKey: `${runKey}:${i}`,
          name: batchDeckName(name, i, plan.batches.length),
          description: `Imported ${batch.length} card${batch.length === 1 ? '' : 's'}`,
          cards: batch.map(toApiCard),
        } as Parameters<typeof createDeckWithCards>[0]);

        const rawDeck = response?.deck as (Record<string, unknown> & { id?: string }) | undefined;
        const cards = Array.isArray(response?.flashcards) ? response.flashcards : [];
        savedCards += cards.length;
        if (rawDeck?.id) {
          const deck = mapDeckFromApi(rawDeck);
          useFlashcardStore
            .getState()
            .updateDecks((prev) => (prev.some((d) => d.id === deck.id) ? prev : [...prev, deck]));
          if (!firstDeck) firstDeck = { id: deck.id, name: deck.name };
        }
        setProgress({ done: i + 1, total: plan.batches.length });
      }

      if (!firstDeck) throw new Error('The deck did not come back from the server.');

      try {
        useFlashcardStore.getState().setFlashcards(await fetchAllFlashcards(undefined, currentUserId));
      } catch {
        // The cards are saved; a failed refresh is a stale list, not lost work.
      }

      showToast(
        `${savedCards} card${savedCards === 1 ? '' : 's'} imported into ${firstDeck.name}.`,
        'success'
      );
      onImported?.(firstDeck.id, firstDeck.name);
      reset();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "We couldn't save those cards. Check your connection and try again."
      );
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const previewCards = plan.cards.slice(0, 3);
  const summary = describeImportPlan(plan);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabelledBy="import-cards-modal-title"
      ariaDescribedBy="import-cards-modal-summary"
      maxWidthClass="max-w-2xl"
      loading={saving}
      closeOnBackdrop={!saving}
      alignClass="items-end sm:items-center"
      paddingClass="p-0 sm:p-4"
      panelClassName="rounded-t-2xl sm:rounded-lg max-h-[min(92dvh,920px)]"
    >
      <div className="flex justify-between items-center mb-1">
        <h2
          id="import-cards-modal-title"
          className="text-heading font-semibold text-lantern-text flex items-center"
        >
          <AppIcon name="document-text" size={24} className="mr-2 text-lantern-primary" aria-hidden />
          Import cards
        </h2>
        <button
          type="button"
          onClick={handleClose}
          disabled={saving}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:opacity-50"
          aria-label="Close import cards dialog"
        >
          <AppIcon name="close" size={24} aria-hidden />
        </button>
      </div>
      <p className="text-caption text-lantern-text-secondary mb-4">
        Bring a deck over from Anki or Quizlet. Free — no AI uses, and the reading happens on this
        device, so it works offline right up to the save.
      </p>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={saving}>
            <AppIcon name="upload" size={16} />
            Choose a file
          </Button>
          <span className="text-caption text-lantern-text-secondary">
            {fileName ? fileName : '.txt, .csv or a Lantern .json export'}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept={IMPORT_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        <div>
          <label htmlFor="import-text" className="block text-body font-medium text-lantern-text mb-1">
            Or paste the export
          </label>
          <textarea
            id="import-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(undefined);
            }}
            rows={6}
            spellCheck={false}
            className="w-full p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text text-body font-mono focus:ring-2 focus:ring-lantern-primary focus:border-transparent min-h-[7rem] max-h-[28dvh]"
            placeholder={PLACEHOLDER}
          />
        </div>

        <div>
          <label htmlFor="import-deck-name" className="block text-body font-medium text-lantern-text mb-1">
            Deck name
          </label>
          <input
            id="import-deck-name"
            type="text"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            maxLength={80}
            placeholder={plan.deckName}
            className="w-full min-h-[44px] px-3 border border-lantern-border rounded-lantern bg-lantern-surface text-lantern-text text-body focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
          />
        </div>

        <div
          id="import-cards-modal-summary"
          className="rounded-lantern border border-lantern-border bg-lantern-background-secondary p-3"
          role="status"
        >
          <p className="text-body text-lantern-text">{summary}</p>
          {plan.warnings.map((warning) => (
            <p key={warning} className="text-caption text-lantern-text-secondary mt-1">
              {warning}
            </p>
          ))}
          {previewCards.length > 0 && (
            <ul className="mt-2 space-y-1">
              {previewCards.map((card, index) => (
                <li key={`${card.front}-${index}`} className="text-caption text-lantern-text-secondary">
                  <span className="text-lantern-text">{card.front}</span>
                  {card.back ? ` — ${card.back}` : ''}
                </li>
              ))}
            </ul>
          )}
          {plan.cards.length > 0 && (
            <p className="text-caption text-lantern-text-muted mt-2">
              They arrive as new cards, so your daily new-card limit still decides how many you see
              in one session.
            </p>
          )}
        </div>

        {error && (
          <p className="text-caption text-lantern-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 sticky bottom-0 bg-lantern-surface">
          <span className="text-caption text-lantern-text-secondary">
            {progress
              ? `Saving deck ${progress.done + (progress.done < progress.total ? 1 : 0)} of ${progress.total}…`
              : 'Costs no AI uses.'}
          </span>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={handleClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || plan.cards.length === 0}>
              {saving && <AppIcon name="refresh" size={16} className="animate-spin" aria-hidden />}
              {saving
                ? 'Saving…'
                : `Import ${plan.cards.length || ''} card${plan.cards.length === 1 ? '' : 's'}`.trim()}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/**
 * The card shape `POST /decks/with-cards` accepts.
 *
 * The FSRS seeds the planner attached are deliberately NOT sent: the route
 * takes no SRS field, and the server stores a new card with none — which is
 * the same "never scheduled" state, so the first review lands on the initial
 * FSRS branch either way.
 */
function toApiCard(card: ImportedCard) {
  return card.type === 'CLOZE'
    ? { type: 'CLOZE' as const, clozeText: card.clozeText || card.front, back: card.back, tags: card.tags }
    : { type: 'BASIC' as const, front: card.front, back: card.back, tags: card.tags };
}

export default ImportCardsModal;

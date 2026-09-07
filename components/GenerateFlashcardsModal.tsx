import React, { useEffect, useMemo, useState } from 'react';
import { AppIcon } from './ui/AppIcon';
import {
  describeGenerationPlan,
  planGenerationRequest,
  previewCard,
  type FlashcardGenerationOptions,
} from '@lantern/shared/flashcards';
import { useToastStore } from '../stores/toastStore';
import Modal from './ui/Modal';
import AIUsageInline from './AIUsageInline';
import {
  PLACEHOLDER_SAMPLE,
  STYLE_CHOICES,
  SERVER_MAX_GENERATION_COUNT,
  clampToServerCount,
  describeCardMix,
  sampleFromNotes,
  supportedCountPresets,
  type FlashcardGenerationStyle,
} from './flashcards/generationOptions';
import { useGenerationPreferences } from './flashcards/useGenerationPreferences';

export interface GenerateFlashcardsSubmitOptions {
  style: FlashcardGenerationStyle;
}

interface GenerateFlashcardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * `options` is optional so an older caller that only wants notes and a count
   * still type-checks; it carries the one steer the route reads besides count.
   */
  onSubmit: (notes: string, count: number, options?: GenerateFlashcardsSubmitOptions) => void;
  isGenerating: boolean;
}

const CHIP_BASE =
  'min-h-[44px] px-4 rounded-lantern border text-body font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary';
const CHIP_ON = 'border-lantern-primary bg-lantern-primary/10 text-lantern-primary';
const CHIP_OFF = 'border-lantern-border bg-lantern-surface text-lantern-text hover:bg-lantern-background-secondary';

const GenerateFlashcardsModal: React.FC<GenerateFlashcardsModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isGenerating,
}) => {
  const [notes, setNotes] = useState('');
  const { options, setOptions, remember } = useGenerationPreferences();
  const [style, setStyle] = useState<FlashcardGenerationStyle>('concise');
  /**
   * The custom field holds raw text while it is being typed. Clamping on every
   * keystroke turned "15" into 10 the moment the 1 landed, so the field is
   * clamped when it is left, not while it is used.
   */
  const [countText, setCountText] = useState('');
  const presets = supportedCountPresets();

  // A fresh open starts on an empty textarea but keeps the remembered choices.
  useEffect(() => {
    if (isOpen) {
      setNotes('');
      setCountText('');
    }
  }, [isOpen]);

  // A number still being typed counts too: a student who types 18 and presses
  // Generate without leaving the field should get 18, not the last chip.
  const effectiveOptions: FlashcardGenerationOptions = useMemo(
    () =>
      countText.trim() === ''
        ? options
        : { ...options, count: clampToServerCount(Number(countText)) },
    [options, countText]
  );

  const plan = useMemo(
    () => planGenerationRequest(effectiveOptions, { notes, style }),
    [effectiveOptions, notes, style]
  );

  const sample = useMemo(() => sampleFromNotes(notes), [notes]);
  const preview = useMemo(
    () => previewCard(effectiveOptions, sample ?? PLACEHOLDER_SAMPLE),
    [effectiveOptions, sample]
  );

  const setCount = (count: number) => {
    const next: FlashcardGenerationOptions = { ...options, count: clampToServerCount(count) };
    setOptions(next);
    setCountText('');
  };

  const commitTypedCount = () => {
    if (countText.trim() === '') return;
    setCount(Number(countText));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!plan.ok) {
      useToastStore.getState().showToast(plan.blockedReason || 'Add some material first.', 'error');
      return;
    }
    // Remembered only on a run that actually starts, so a cancelled fiddle
    // does not become the setting.
    remember(effectiveOptions);
    onSubmit(notes, plan.body.count, { style });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="generate-cards-modal-title"
      ariaDescribedBy="generate-cards-modal-price"
      maxWidthClass="max-w-2xl"
      loading={isGenerating}
      closeOnBackdrop={!isGenerating}
      alignClass="items-end sm:items-center"
      paddingClass="p-0 sm:p-4"
      panelClassName="rounded-t-2xl sm:rounded-lg max-h-[min(92dvh,920px)]"
    >
      <div className="flex justify-between items-center mb-3">
        <h2
          id="generate-cards-modal-title"
          className="text-heading font-semibold text-lantern-text flex items-center"
        >
          <AppIcon name="sparkles" size={24} className="mr-2 text-lantern-primary" aria-hidden />
          Generate flashcards
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={isGenerating}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:opacity-50"
          aria-label="Close generate flashcards dialog"
        >
          <AppIcon name="close" size={24} aria-hidden />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="notes" className="block text-body font-medium text-lantern-text mb-1">
            Your material
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={7}
            className="w-full p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text text-body focus:ring-2 focus:ring-lantern-primary focus:border-transparent min-h-[8rem] max-h-[32dvh]"
            placeholder="Paste your lecture notes, a chapter summary, or any text here…"
            required
          />
        </div>

        <fieldset>
          <legend className="text-body font-medium text-lantern-text mb-1">How many cards</legend>
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((count) => (
              <button
                key={count}
                type="button"
                aria-pressed={options.count === count}
                onClick={() => setCount(count)}
                className={`${CHIP_BASE} ${options.count === count ? CHIP_ON : CHIP_OFF}`}
              >
                {count}
              </button>
            ))}
            <label htmlFor="cardCount" className="sr-only">
              Number of cards
            </label>
            <input
              type="number"
              id="cardCount"
              value={countText === '' ? options.count : countText}
              onChange={(e) => setCountText(e.target.value)}
              onBlur={commitTypedCount}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTypedCount();
                }
              }}
              min={10}
              max={SERVER_MAX_GENERATION_COUNT}
              className="w-24 min-h-[44px] px-3 border border-lantern-border rounded-lantern bg-lantern-surface text-lantern-text text-body focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            />
          </div>
          <p className="text-caption text-lantern-text-secondary mt-1">{describeCardMix(effectiveOptions)}</p>
        </fieldset>

        <fieldset>
          <legend className="text-body font-medium text-lantern-text mb-1">Answers</legend>
          <div className="flex flex-wrap gap-2">
            {STYLE_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                aria-pressed={style === choice.value}
                onClick={() => setStyle(choice.value)}
                className={`${CHIP_BASE} ${style === choice.value ? CHIP_ON : CHIP_OFF}`}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <p className="text-caption text-lantern-text-secondary mt-1">
            {STYLE_CHOICES.find((c) => c.value === style)?.hint}
          </p>
        </fieldset>

        <div className="rounded-lantern border border-lantern-border bg-lantern-background-secondary p-3">
          <p className="text-label uppercase text-lantern-text-secondary mb-1">
            {sample ? 'A card from your material' : 'What a card looks like'}
          </p>
          <p className="text-body text-lantern-text">{preview.front}</p>
          <p className="text-caption text-lantern-text-secondary mt-1">{preview.back}</p>
          <p className="text-caption text-lantern-text-muted mt-2">
            Built here from what you pasted. It costs nothing and is not what the AI will write.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 sticky bottom-0 bg-lantern-surface">
          <div className="flex flex-col gap-0.5">
            <AIUsageInline cost={plan.cost} />
            <span id="generate-cards-modal-price" className="text-caption text-lantern-text-secondary">
              {describeGenerationPlan(plan)} — the same {plan.costLabel} at every count.
            </span>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="min-h-[44px] px-4 py-2 text-body font-medium text-lantern-text bg-lantern-background-secondary border border-lantern-border rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isGenerating || !plan.ok}
              className="min-h-[44px] px-4 py-2 text-body font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-lg shadow-sm flex items-center justify-center disabled:opacity-50"
            >
              {isGenerating && <AppIcon name="refresh" size={16} className="mr-2 animate-spin" aria-hidden />}
              {isGenerating ? 'Generating…' : 'Generate cards'}
            </button>
          </div>
        </div>
        {!plan.ok && notes.trim().length > 0 && (
          <p className="text-caption text-lantern-text-secondary" role="status">
            {plan.blockedReason}
          </p>
        )}
      </form>
    </Modal>
  );
};

export default GenerateFlashcardsModal;

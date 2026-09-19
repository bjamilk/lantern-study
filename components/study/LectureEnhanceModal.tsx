import React from 'react';
import { NOTES_STUDIO_DEPTHS } from '@lantern/shared';
import {
  SMART_NOTES_SKILL_HINT_EXAMPLES,
  SMART_NOTES_SKILL_HINT_MAX_CHARS,
  type SmartNotesDepth,
} from '@lantern/shared/utils/smartNotes';
import { SMART_NOTES_CREDIT_COST, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import { Button, Modal, Select } from '../ui';

/**
 * "Enhance notes" as a MODAL rather than a row of controls wedged under the
 * tabs.
 *
 * The controls themselves are #141's, unchanged and still priced: the depth
 * chips carry their own AI-use cost, the skill hint and the attached material
 * are free because a sentence in a prompt is not a second call. What changes is
 * where they live — the editor column is the lecture, and a three-row control
 * panel permanently parked in it is the "dashboard with a document in it" this
 * lane is undoing.
 *
 * The price line is stated twice on purpose: on each chip (what THAT depth
 * costs) and on the button (what pressing it will cost now). Lantern shows the
 * price before the spend, every time; the reference shows none.
 */

export interface LectureEnhanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  depth: SmartNotesDepth;
  onDepthChange: (depth: SmartNotesDepth) => void;
  skillHint: string;
  onSkillHintChange: (hint: string) => void;
  /** Notes in this set that can be read alongside the transcript. */
  attachableNotes: Array<{ id: string; title?: string | null }>;
  contextNoteId: string;
  onContextNoteChange: (id: string) => void;
  onSubmit: () => void;
  writing?: boolean;
  cost: string;
}

export const LectureEnhanceModal: React.FC<LectureEnhanceModalProps> = ({
  isOpen,
  onClose,
  depth,
  onDepthChange,
  skillHint,
  onSkillHintChange,
  attachableNotes,
  contextNoteId,
  onContextNoteChange,
  onSubmit,
  writing,
  cost,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    ariaLabelledBy="lecture-enhance-title"
    maxWidthClass="max-w-lg"
    loading={writing}
  >
    <h2 id="lecture-enhance-title" className="text-title text-lantern-text">
      Enhance notes
    </h2>
    <p className="mt-1 text-body text-lantern-text-secondary">
      Write notes from this lecture&rsquo;s transcript and what you typed.
    </p>

    <div className="mt-4 space-y-4">
      <div>
        <p className="text-label uppercase text-lantern-text-secondary">
          What type of notes would you like?
        </p>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Notes depth">
          {NOTES_STUDIO_DEPTHS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={depth === option.id}
              onClick={() => onDepthChange(option.id)}
              className={`min-h-[44px] rounded-full border px-3 text-body ${
                depth === option.id
                  ? 'border-lantern-primary bg-lantern-primary-fill text-white'
                  : 'border-lantern-border bg-lantern-surface text-lantern-text hover:border-lantern-text-tertiary'
              }`}
            >
              {option.label}
              <span className="ml-1 text-caption font-normal opacity-80">
                · {formatCreditCost(SMART_NOTES_CREDIT_COST[option.id])}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="lecture-skill-hint"
          className="block text-caption text-lantern-text-secondary"
        >
          How much do you already know? (optional)
        </label>
        <input
          id="lecture-skill-hint"
          value={skillHint}
          maxLength={SMART_NOTES_SKILL_HINT_MAX_CHARS}
          onChange={(event) => onSkillHintChange(event.target.value)}
          placeholder="e.g. I know the basics but not the maths"
          className="min-h-[44px] w-full rounded-xl border border-lantern-border bg-lantern-background px-3 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
        />
        <div className="flex flex-wrap gap-2">
          {SMART_NOTES_SKILL_HINT_EXAMPLES.map((example) => (
            <button
              key={example.id}
              type="button"
              onClick={() => onSkillHintChange(example.text)}
              className="min-h-[44px] rounded-full border border-lantern-border bg-lantern-surface px-3 text-body text-lantern-text hover:border-lantern-text-tertiary"
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>

      {attachableNotes.length > 0 ? (
        <div className="space-y-2">
          <label
            htmlFor="lecture-context-note"
            className="block text-caption text-lantern-text-secondary"
          >
            Attach a material — the notes will use it together with the transcript
          </label>
          <Select
            id="lecture-context-note"
            value={contextNoteId}
            onChange={(event) => onContextNoteChange(event.target.value)}
            className="min-h-[44px] w-full"
          >
            <option value="">None</option>
            {attachableNotes.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title || 'Untitled note'}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
    </div>

    <div className="mt-6 flex flex-wrap justify-end gap-2">
      <Button variant="secondary" onClick={onClose} disabled={writing}>
        Cancel
      </Button>
      <Button onClick={onSubmit} loading={writing} disabled={writing}>
        ✨ Enhance notes · {cost}
      </Button>
    </div>
  </Modal>
);

export default LectureEnhanceModal;

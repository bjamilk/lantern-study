import React, { useEffect, useRef, useState } from 'react';
import { Headline } from '../../ui/Headline';
import { AppIcon, type AppIconName } from '../../ui/AppIcon';
import { wizardTotalKnown, type WizardStep } from './wizardSteps';

/**
 * The frame every create-wizard screen is drawn in, and the three controls
 * the screens are built from.
 *
 * WHY ONE FRAME. The wizard asks one question per screen; "one question" is
 * only true if every screen says the same kind of thing in the same place —
 * a step count, the question in the display voice, then the answer, then a
 * single prominent button. Repeating that per screen is how a screen ends up
 * with two primary buttons and no step number.
 *
 * Touches: `CreateFromSource` and the step components beside this file.
 *
 * Gotchas:
 *  - The step title is focused when the step CHANGES, not on first mount:
 *    stealing focus as a panel appears moves a screen reader away from
 *    whatever opened it. The heading carries tabIndex -1 for that, which is
 *    why it is not in the tab order.
 *  - "of M" is drawn only when `wizardTotalKnown` says the path is fixed. On
 *    the source screen the header is a bare "Step 1": the paths are different
 *    lengths, and a total that changes when the student answers reads as a bug.
 *  - `ChoiceGroup` is a real radiogroup with roving tabindex: exactly one
 *    option is tabbable and the arrow keys move between them. Do not swap the
 *    radios for buttons with `aria-pressed` — pressed is a toggle, and these
 *    are one-of-many.
 *  - Motion is `motion-safe:` only; index.css also flattens every transition
 *    under prefers-reduced-motion.
 */

export interface WizardShellProps {
  /** Every screen this run will show — `wizardSteps(kind, source)`. */
  steps: readonly WizardStep[];
  /** Which of them is on screen. */
  index: number;
  /** The answer: fields, chips, cards. */
  children: React.ReactNode;
  /** Back / primary. The primary must be the only prominent button here. */
  actions: React.ReactNode;
  /** One quiet line under the question, when the promise needs spelling out. */
  hint?: string;
}

export const WizardShell: React.FC<WizardShellProps> = ({
  steps,
  index,
  children,
  actions,
  hint,
}) => {
  const step = steps[index] ?? steps[0];
  const titleRef = useRef<HTMLDivElement | null>(null);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (!step) return;
    // First render of the wizard: leave focus where the student put it.
    if (lastId.current === null) {
      lastId.current = step.id;
      return;
    }
    if (lastId.current === step.id) return;
    lastId.current = step.id;
    titleRef.current?.focus();
  }, [step]);

  if (!step) return null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div
        key={step.id}
        className="space-y-5 motion-safe:animate-[fadeIn_160ms_ease-out]"
      >
        <div>
          <p className="text-label uppercase text-lantern-text-secondary">
            {/* No denominator until the path is fixed — see wizardSteps. */}
            Step {index + 1}
            {wizardTotalKnown(steps) ? ` of ${steps.length}` : ''}
          </p>
          <div ref={titleRef} tabIndex={-1} className="mt-1 focus:outline-none">
            <Headline as="h2" size="title" accent={step.accent}>
              {step.question}
            </Headline>
          </div>
          {hint ? (
            <p className="mt-1 text-caption text-lantern-text-secondary">{hint}</p>
          ) : null}
        </div>
        {children}
        <div className="flex items-center gap-2 pt-1">{actions}</div>
      </div>
    </div>
  );
};

/**
 * One of many, as radios. `value` is compared with `===`, so options must
 * carry primitives.
 */
export interface ChoiceGroupProps<T extends string | number> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{
    value: T;
    label: string;
    /** The one line under the label on a card. Chips leave it out. */
    promise?: string;
    icon?: AppIconName;
  }>;
  /** `card` is the big StudyFetch choice; `chip` is the pill row. */
  variant?: 'card' | 'chip';
  className?: string;
}

export function ChoiceGroup<T extends string | number>({
  label,
  value,
  onChange,
  options,
  variant = 'chip',
  className = '',
}: ChoiceGroupProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.findIndex((option) => option.value === value);
  const selected = current < 0 ? 0 : current;

  /** Check the option at `position` and take focus with it. */
  const pick = (position: number) => {
    const option = options[position];
    if (!option) return;
    onChange(option.value);
    refs.current[position]?.focus();
  };

  const move = (delta: number) => pick((selected + delta + options.length) % options.length);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      pick(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      pick(options.length - 1);
    }
  };

  const cards = variant === 'card';

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={
        className ||
        (cards ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'flex flex-wrap gap-2')
      }
    >
      {options.map((option, position) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            ref={(node) => {
              refs.current[position] = node;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={position === selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
            className={
              cards
                ? `min-h-[44px] rounded-2xl border p-4 text-left transition-colors ${
                    on
                      ? 'border-lantern-text bg-lantern-background-secondary'
                      : 'border-lantern-border bg-lantern-surface hover:bg-lantern-background-secondary'
                  }`
                : `min-h-[44px] min-w-[44px] rounded-full border px-4 text-body transition-colors ${
                    on
                      ? 'border-lantern-text bg-lantern-background-secondary font-semibold text-lantern-text'
                      : 'border-lantern-border text-lantern-text-secondary hover:bg-lantern-background-secondary'
                  }`
            }
          >
            {cards && option.icon ? (
              <AppIcon name={option.icon} size={20} aria-hidden="true" />
            ) : null}
            <span className={cards ? 'mt-3 block text-body font-semibold' : undefined}>
              {option.label}
            </span>
            {cards && option.promise ? (
              <span className="mt-1 block text-caption text-lantern-text-secondary">
                {option.promise}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** A card that DOES something rather than selecting something. */
export const ActionCard: React.FC<{
  icon: AppIconName;
  title: string;
  promise: string;
  onClick: () => void;
}> = ({ icon, title, promise, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="min-h-[44px] rounded-2xl border border-lantern-border bg-lantern-surface p-4 text-left transition-colors hover:bg-lantern-background-secondary"
  >
    <AppIcon name={icon} size={20} aria-hidden="true" />
    <p className="mt-3 text-body font-semibold">{title}</p>
    <p className="text-caption text-lantern-text-secondary">{promise}</p>
  </button>
);

/** A toggle, as a button. Many of these can be on at once. */
export const ToggleChip: React.FC<{
  label: string;
  on: boolean;
  onClick: () => void;
}> = ({ label, on, onClick }) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={`min-h-[44px] min-w-[44px] rounded-full border px-4 text-body transition-colors ${
      on
        ? 'border-lantern-text bg-lantern-background-secondary font-semibold text-lantern-text'
        : 'border-lantern-border text-lantern-text-secondary hover:bg-lantern-background-secondary'
    }`}
  >
    {label}
  </button>
);

/**
 * The quiet half of a screen: everything that has a default worth keeping.
 * Collapsed means the defaults are what is sent, so opening it is the only
 * way to change them — never a prerequisite for finishing.
 */
export const Disclosure: React.FC<{
  label: string;
  children: React.ReactNode;
  id: string;
}> = ({ label, children, id }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex min-h-[44px] items-center gap-1 text-caption font-medium text-lantern-text-secondary hover:text-lantern-text hover:underline"
      >
        <AppIcon name={open ? 'chevron-down' : 'chevron-forward'} size={16} aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <div id={id} className="mt-2 space-y-3">
          {children}
        </div>
      ) : (
        <div id={id} hidden />
      )}
    </div>
  );
};

/** The one text input shape the wizard uses. */
export const WizardField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}> = ({ label, value, onChange, placeholder, autoFocus, onEnter }) => (
  <label className="block">
    <span className="mb-1 block text-caption text-lantern-text-secondary">{label}</span>
    <input
      value={value}
      // eslint-disable-next-line jsx-a11y/no-autofocus -- the one field on its
      // own step: the question has just been read out and this is the answer.
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && onEnter) {
          event.preventDefault();
          onEnter();
        }
      }}
      placeholder={placeholder}
      className="min-h-[44px] w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
    />
  </label>
);

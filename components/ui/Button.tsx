import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

/**
 * Primary is a SOLID INK PILL, not an indigo one (2026-09-11 direction).
 *
 * `--color-ink` inverts between themes and `--color-surface` inverts with it,
 * so `bg-lantern-ink text-lantern-surface` is a near-black pill with a white
 * label in light and a near-white pill with a near-black label in dark, from
 * ONE pair of classes. Spelling it as `dark:` overrides instead would have put
 * the same fact in two places and let them drift.
 *
 * Both pill variants are fully round (`rounded-full` below beats the size
 * step's own radius) and flat: the reference has no shadow under a button, and
 * a hairline is what separates the secondary from the paper it sits on.
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-lantern-ink text-lantern-surface hover:opacity-90 active:translate-y-px',
  secondary:
    'bg-lantern-surface border border-lantern-border text-lantern-text hover:bg-lantern-background-secondary',
  accent:
    'bg-lantern-feature-flashcards-tint text-lantern-feature-flashcards-ink hover:brightness-95',
  ghost:
    'bg-transparent text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text',
  // Destructive stays RED and stays saturated: it is the one action whose
  // colour is the warning, so it does not become an ink pill with the rest.
  // error-strong, not error: white on `--color-error` is 3.76:1 in dark.
  danger: 'bg-lantern-error-strong hover:brightness-95 text-white',
};

// Sizes are STEPS, not Tailwind's default ramp. The primary button used to
// render its label at Tailwind's 14/16 px, which is off the six-step scale AND
// froze under the app's text-size setting (the setting moves --type-scale, and
// the default ramp is rem off the root). `font-semibold` on the base class
// still wins over the step's own weight — Tailwind emits fontWeight after
// fontSize — so every variant keeps the same voice at three sizes.
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-4 py-1.5 text-caption',
  md: 'px-5 py-2.5 text-body',
  lg: 'px-7 py-3 text-heading',
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  ...props
}) => (
  <button
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/50 focus-visible:ring-offset-2 focus-visible:ring-offset-lantern-background disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0 ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    {...props}
  >
    {loading && (
      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
    )}
    {children}
  </button>
);

export default Button;

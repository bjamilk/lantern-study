import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-lantern-primary-fill hover:bg-lantern-primary-dark text-white shadow-lantern hover:shadow-lantern-md active:translate-y-px',
  secondary:
    'bg-lantern-surface/90 border border-lantern-border text-lantern-text hover:bg-lantern-background-secondary hover:border-lantern-primary/30 shadow-lantern',
  accent:
    'bg-lantern-accent hover:brightness-95 text-white shadow-lantern hover:shadow-lantern-md',
  ghost:
    'bg-transparent text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text',
  danger: 'bg-lantern-error hover:brightness-95 text-white shadow-lantern',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2.5 text-sm rounded-lantern',
  lg: 'px-6 py-3 text-base rounded-lantern',
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
    className={`inline-flex items-center justify-center gap-2 font-semibold tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-lantern-background disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0 ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    {...props}
  >
    {loading && (
      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
    )}
    {children}
  </button>
);

export default Button;

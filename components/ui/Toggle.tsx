import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  id?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
}) => {
  const toggleId = id || label?.replace(/\s+/g, '-').toLowerCase();
  const labelId = toggleId ? `${toggleId}-label` : undefined;

  return (
    <div
      className={`flex items-start gap-3 ${disabled ? 'opacity-50' : ''}`}
    >
      <button
        id={toggleId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={label ? labelId : undefined}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary ${
          checked ? 'bg-lantern-primary' : 'bg-lantern-border'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-lantern-surface rounded-full shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      {(label || description) && (
        <div id={labelId} className="flex-1 min-w-0">
          {label && <p className="text-sm font-medium text-lantern-text">{label}</p>}
          {description && <p className="text-xs text-lantern-text-secondary mt-0.5">{description}</p>}
        </div>
      )}
    </div>
  );
};

export default Toggle;

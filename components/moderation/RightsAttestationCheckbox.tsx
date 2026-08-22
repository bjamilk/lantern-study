import React from 'react';
import { LEGAL_PATHS, RIGHTS_ATTESTATION_TEXT } from '@lantern/shared';

interface RightsAttestationCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Inline error shown under the checkbox (e.g. ATTESTATION_REQUIRED_MESSAGE). */
  error?: string | null;
  id?: string;
  className?: string;
}

/**
 * The rights attestation every publish flow shows (RIGHTS_ATTESTATION_TEXT):
 * question-bank publish/republish and academic marketplace listings. The
 * trailing "Seller & Creator Terms" phrase links to /legal/seller-terms.
 */
export const RightsAttestationCheckbox: React.FC<RightsAttestationCheckboxProps> = ({
  checked,
  onChange,
  disabled = false,
  error,
  id = 'rights-attestation',
  className = '',
}) => {
  const termsPhrase = 'Seller & Creator Terms';
  const termsIndex = RIGHTS_ATTESTATION_TEXT.indexOf(termsPhrase);
  const before = termsIndex >= 0 ? RIGHTS_ATTESTATION_TEXT.slice(0, termsIndex) : RIGHTS_ATTESTATION_TEXT;
  const after = termsIndex >= 0 ? RIGHTS_ATTESTATION_TEXT.slice(termsIndex + termsPhrase.length) : '';

  return (
    <div className={className}>
      <label htmlFor={id} className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-lantern-border text-lantern-primary focus:ring-lantern-primary"
        />
        <span className="text-lantern-text-secondary">
          {before}
          {termsIndex >= 0 ? (
            <a
              href={LEGAL_PATHS['seller-terms']}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lantern-primary underline hover:no-underline"
              onClick={(e) => e.stopPropagation()}
            >
              {termsPhrase}
            </a>
          ) : null}
          {after}
        </span>
      </label>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-lantern-error">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default RightsAttestationCheckbox;

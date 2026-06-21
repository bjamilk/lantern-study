import React from 'react';

interface LanternBrandIconProps {
  className?: string;
  size?: number;
}

/** Full Lantern Study brand mark — indigo tile + yellow lantern (matches favicon). */
export const LanternBrandIcon: React.FC<LanternBrandIconProps> = ({
  className = '',
  size = 32,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden
  >
    <rect width="32" height="32" rx="8" fill="#4F46E5" />
    <path
      d="M16 6c-4.5 0-8 3.2-8 7.2 0 3.1 1.9 5.8 4.7 7l1.3 4.8 2-3.4 2 3.4 1.3-4.8c2.8-1.2 4.7-3.9 4.7-7C24 9.2 20.5 6 16 6z"
      fill="#FBBF24"
    />
    <ellipse cx="16" cy="13.2" rx="5.2" ry="3.6" fill="#FDE68A" opacity="0.85" />
  </svg>
);

export default LanternBrandIcon;

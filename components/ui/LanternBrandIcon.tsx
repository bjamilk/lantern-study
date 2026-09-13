import React from 'react';

interface LanternBrandIconProps {
  className?: string;
  size?: number;
}

/** Full Lantern Study brand mark — blue tile + white flame (matches app icon). */
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
    <rect width="32" height="32" fill="#191919" />
    <path
      fill="#FFFFFF"
      fillRule="evenodd"
      d="M16 4.9c-3.6 4.5-6.75 8.6-6.75 13.4 0 4.5 3 8.1 6.75 8.1s6.75-3.6 6.75-8.1c0-4.8-3.15-8.9-6.75-13.4zm0 7.4c-2.1 0-3.6 2.1-3.6 4.5 0 1.75 1.1 3.25 2.6 3.75l-1 3 2-1.75 2 1.75-1-3c1.5-.5 2.6-2 2.6-3.75 0-2.4-1.5-4.5-3.6-4.5z"
    />
  </svg>
);

export default LanternBrandIcon;

import React from 'react';

interface LanternIconProps {
  className?: string;
  size?: number;
}

/** Lantern Study app mark */
export const LanternIcon: React.FC<LanternIconProps> = ({ className = '', size = 24 }) => (
  <img
    src="/lantern-icon.png"
    alt=""
    width={size}
    height={size}
    className={`rounded-[22%] ${className}`}
    aria-hidden
    draggable={false}
  />
);

export default LanternIcon;

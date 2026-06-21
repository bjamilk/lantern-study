import React, { useEffect, useState } from 'react';
import { formatSaleCountdown } from '@lantern/shared/utils';

interface SaleCountdownProps {
  saleEndsAt?: string | null;
  className?: string;
}

export const SaleCountdown: React.FC<SaleCountdownProps> = ({ saleEndsAt, className = '' }) => {
  const [label, setLabel] = useState(() => formatSaleCountdown(saleEndsAt));

  useEffect(() => {
    setLabel(formatSaleCountdown(saleEndsAt));
    if (!saleEndsAt) return undefined;

    const id = window.setInterval(() => {
      setLabel(formatSaleCountdown(saleEndsAt));
    }, 60000);

    return () => window.clearInterval(id);
  }, [saleEndsAt]);

  if (!label) return null;

  return (
    <span
      className={`inline-flex items-center text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 ${className}`}
    >
      {label}
    </span>
  );
};

export default SaleCountdown;

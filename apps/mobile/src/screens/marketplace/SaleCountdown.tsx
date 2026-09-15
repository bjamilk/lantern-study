/**
 * Pill that counts down to a listing's sale end time.
 *
 * Exports: SaleCountdown.
 * Touches: formatSaleCountdown from @lantern/shared/utils. No store or API.
 *
 * Gotchas: renders nothing when the formatter returns an empty label, and the
 * refresh interval is 60s, so the label can be up to a minute stale. The timer
 * is only started when saleEndsAt is set and is cleared on unmount.
 */
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { formatSaleCountdown } from '@lantern/shared/utils';

export function SaleCountdown({
  saleEndsAt,
  className = '',
}: {
  saleEndsAt?: string | null;
  className?: string;
}) {
  const [label, setLabel] = useState(() => formatSaleCountdown(saleEndsAt));

  useEffect(() => {
    setLabel(formatSaleCountdown(saleEndsAt));
    if (!saleEndsAt) return undefined;
    const id = setInterval(() => setLabel(formatSaleCountdown(saleEndsAt)), 60000);
    return () => clearInterval(id);
  }, [saleEndsAt]);

  if (!label) return null;

  return (
    <View className={`px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 ${className}`}>
      <Text className="text-label font-semibold text-amber-800 dark:text-amber-300">{label}</Text>
    </View>
  );
}

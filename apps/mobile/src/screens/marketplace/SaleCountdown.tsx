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
      <Text className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">{label}</Text>
    </View>
  );
}

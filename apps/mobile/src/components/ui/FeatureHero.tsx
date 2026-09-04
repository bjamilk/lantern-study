import React from 'react';
import { View, Text } from 'react-native';

interface FeatureHeroProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function FeatureHero({
  title,
  subtitle,
  right,
  children,
  className = '',
}: FeatureHeroProps) {
  return (
    <View
      // No accent rail. A 3px coloured edge on the top of the card read as a
      // stray coloured shadow around the box rather than as decoration, which
      // is why the decorative rails were dropped elsewhere in the app too.
      className={`rounded-lantern-xl border border-lantern-border bg-lantern-surface mb-4 overflow-hidden ${className}`}
    >
      <View className="p-4">
        <View className="flex-row items-start justify-between gap-2 mb-2">
          <View className="flex-1 min-w-0">
            <Text className="text-xl font-bold text-lantern-text">{title}</Text>
            {subtitle ? (
              <Text className="text-sm text-lantern-text-secondary mt-0.5">{subtitle}</Text>
            ) : null}
          </View>
          {right}
        </View>
        {children}
      </View>
    </View>
  );
}

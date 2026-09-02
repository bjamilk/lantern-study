import React from 'react';
import { View } from 'react-native';
import type { OnlineStatus } from '@lantern/shared/settings';

/**
 * 10px presence dot. `hidden` renders nothing — a member who turned
 * `showOnlineStatus` off never gets a dot on any device. The label carries
 * the state for screen readers so it is never colour-only.
 */
export function OnlineDot({
  status,
  online,
  className = '',
}: {
  status?: OnlineStatus;
  /** Merged live + stored answer (`isMemberOnline`); ignored when `status` is hidden. */
  online: boolean;
  className?: string;
}) {
  if (status === 'hidden') return null;
  return (
    <View
      className={`h-[10px] w-[10px] rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'} ${className}`}
      accessibilityLabel={online ? 'Online' : 'Offline'}
      accessible
    />
  );
}

export default OnlineDot;

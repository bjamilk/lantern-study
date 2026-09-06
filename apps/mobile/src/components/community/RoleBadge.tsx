import React from 'react';
import { Text, View } from 'react-native';
import { communityRoleLabel, type CommunityRole } from '@lantern/shared/network';
import { AppIcon, type AppIconName } from '../ui/AppIcon';

/**
 * Owner = amber star, Admin = indigo shield-checkmark, Moderator = shield
 * outline — the same icon vocabulary GroupInfoModal already uses. Plain
 * members render nothing. The text label is visible AND on the
 * accessibilityLabel, so the badge is never icon-only.
 */
export function RoleBadge({ role }: { role: CommunityRole }) {
  const label = communityRoleLabel(role);
  if (!label) return null;
  const icon: AppIconName =
    role === 'owner' ? 'star' : role === 'admin' ? 'shield-checkmark' : 'shield';
  const color = role === 'owner' ? '#f59e0b' : role === 'admin' ? '#6366f1' : '#64748b';
  const tone =
    role === 'owner'
      ? 'bg-amber-100 dark:bg-amber-900/40'
      : role === 'admin'
        ? 'bg-indigo-100 dark:bg-indigo-900/40'
        : 'bg-slate-100 dark:bg-slate-800';
  const textTone =
    role === 'owner'
      ? 'text-amber-700 dark:text-amber-300'
      : role === 'admin'
        ? 'text-indigo-700 dark:text-indigo-300'
        : 'text-slate-600 dark:text-slate-300';
  return (
    <View
      className={`ml-1.5 flex-row items-center rounded-full px-1.5 py-0.5 ${tone}`}
      accessibilityLabel={label}
      accessible
    >
      <AppIcon name={icon} size={10} color={color} />
      <Text className={`ml-0.5 text-label font-semibold ${textTone}`}>{label}</Text>
    </View>
  );
}

export default RoleBadge;

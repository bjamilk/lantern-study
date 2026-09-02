import React from 'react';
import { Text, View } from 'react-native';
import { type CommunityMember } from '@lantern/shared/network';
import { resolveAvatarSrc } from '@lantern/shared/utils';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { OnlineDot } from './OnlineDot';
import { RoleBadge } from './RoleBadge';

/**
 * One roster row: 32px avatar (initials in low-data), presence dot, name,
 * role badge, programme. Phase 1 has no member profile sheet on mobile, so
 * the row is static — it still meets the 44px minimum so a future tap target
 * needs no relayout.
 */
export function MemberRow({
  member,
  online,
  lowDataMode,
}: {
  member: CommunityMember;
  /** Merged live + stored answer from `isMemberOnline`. */
  online: boolean;
  lowDataMode: boolean;
}) {
  return (
    <View
      className="flex-row items-center px-4 min-h-[48px] py-1.5"
      accessible
      accessibilityLabel={`${member.name}${member.programme ? `, ${member.programme}` : ''}${
        member.onlineStatus === 'hidden' ? '' : online ? ', online' : ', offline'
      }`}
    >
      <View className="relative">
        <ResolvedAvatar
          name={member.name}
          uri={resolveAvatarSrc(member.avatarUrl, lowDataMode)}
          size={32}
          decorative
        />
        <View className="absolute -bottom-0.5 -right-0.5 rounded-full bg-lantern-background p-[1px]">
          <OnlineDot status={member.onlineStatus} online={online} />
        </View>
      </View>
      <View className="flex-1 min-w-0 ml-3">
        <View className="flex-row items-center">
          <Text className="text-[15px] font-medium text-lantern-text shrink" numberOfLines={1}>
            {member.name}
          </Text>
          <RoleBadge role={member.role} />
        </View>
        {member.programme ? (
          <Text className="text-xs text-lantern-text-tertiary mt-0.5" numberOfLines={1}>
            {member.programme}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default MemberRow;

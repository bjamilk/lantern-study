/**
 * Campus → Communities hub. The rules live in `@lantern/shared/network`
 * (`communityHub.ts`) so web and mobile cannot describe a room two ways.
 * This file re-exports them and casts the disc glyph onto the mobile
 * `AppIcon` vocabulary.
 */
import {
  communityCardMeta as sharedCardMeta,
  communityHeaderMeta as sharedHeaderMeta,
  type CommunityCardMeta as SharedCardMeta,
  type CommunityHeaderMeta as SharedHeaderMeta,
  type CommunityKindFields,
} from '@lantern/shared/network';
import type { AppIconName } from '../../components/ui/appIconMap';

export {
  COMMUNITY_CHIPS,
  buildCommunityHub,
  communityChipLabel,
  communityChipOf,
  effectiveCommunityKind,
  matchesChip,
  type CommunityChip,
  type CommunityHubEmpty,
  type CommunityHubInput,
  type CommunityHubModel,
} from '@lantern/shared/network';

export interface CommunityCardMeta extends Omit<SharedCardMeta, 'icon'> {
  icon: AppIconName;
}

export interface CommunityHeaderMeta extends Omit<SharedHeaderMeta, 'icon'> {
  icon: AppIconName;
}

export function communityCardMeta(community: CommunityKindFields): CommunityCardMeta {
  const meta = sharedCardMeta(community);
  return { ...meta, icon: meta.icon as AppIconName };
}

export function communityHeaderMeta(
  community: CommunityKindFields,
  memberCount: number,
  onlineCount: number,
): CommunityHeaderMeta {
  const meta = sharedHeaderMeta(community, memberCount, onlineCount);
  return { ...meta, icon: meta.icon as AppIconName };
}

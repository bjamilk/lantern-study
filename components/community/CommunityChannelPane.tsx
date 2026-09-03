import React, { useEffect, useState } from 'react';
import type { CommunityRole } from '@lantern/shared/network';
import { useCommunityStore } from '../../stores/communityStore';
import CommunityBoard from './CommunityBoard';

export interface CommunityChannelPaneProps {
  slug: string;
  groupId: string;
  /**
   * The community's ONE live chat. Rendered by App (it owns the ChatWindow
   * wiring) so the lounge keeps the full chat surface, minus the study/test
   * apparatus — founder decision 1.
   */
  renderLounge: () => React.ReactNode;
  onBack: () => void;
  onOpenMembers: () => void;
  onStartStudyGroup: (prefillName?: string, fromPost?: boolean) => void;
  fallback: React.ReactNode;
}

/**
 * `/discover/c/:slug/ch/:groupId` (spec §5.2). Which surface renders is decided
 * by the community, never by the screen that navigated here:
 *
 *   groupId === communities.lounge_group_id → the live chat ("General")
 *   otherwise                               → the board
 *
 * The community is resolved here rather than read from whatever the last
 * screen happened to leave in the store, because on a cold load of this URL
 * below `md` there is no column mounted to have loaded it — and guessing wrong
 * would render the community's one chat room as a board.
 */
export const CommunityChannelPane: React.FC<CommunityChannelPaneProps> = ({
  slug,
  groupId,
  renderLounge,
  onBack,
  onOpenMembers,
  onStartStudyGroup,
  fallback,
}) => {
  const detail = useCommunityStore((s) => s.detailBySlug[slug]);
  const payload = useCommunityStore((s) => (detail ? s.channelsById[detail.id] : undefined));
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const loadChannels = useCommunityStore((s) => s.loadChannels);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [slug]);

  useEffect(() => {
    if (failed) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const resolved = detail ?? (await loadCommunity(slug));
        if (cancelled || payload) return;
        await loadChannels(resolved.id);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, detail, payload, failed, loadCommunity, loadChannels]);

  // Until the community is known, neither surface can be chosen safely.
  if (!detail && !failed) return <>{fallback}</>;

  const loungeGroupId = detail?.lounge_group_id ?? payload?.loungeGroupId ?? null;
  if (loungeGroupId && loungeGroupId === groupId) return <>{renderLounge()}</>;
  // A community we could not resolve falls back to the chat surface rather
  // than guessing "board" — the chat is the reversible mistake.
  if (failed && !detail) return <>{renderLounge()}</>;

  const viewerRole: CommunityRole | null = payload?.viewer?.role ?? detail?.viewerRole ?? null;

  return (
    <CommunityBoard
      groupId={groupId}
      communityId={detail?.id ?? ''}
      communitySlug={slug}
      communityName={detail?.name ?? 'Community'}
      viewerRole={viewerRole}
      onBack={onBack}
      onOpenMembers={onOpenMembers}
      onStartStudyGroup={onStartStudyGroup}
    />
  );
};

export default CommunityChannelPane;

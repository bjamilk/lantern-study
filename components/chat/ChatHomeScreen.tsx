/**
 * The chat home screen: what `ChatWindow` renders when no conversation is open.
 *
 * Two layouts, one screen. Desktop gets the `ChatHomePane` placeholder — the
 * conversation list already lives in the sidebar there. Small screens get the
 * full list inline, because there is no sidebar to hold it.
 *
 * Moved out of `components/ChatWindow.tsx` verbatim (lane M8b, step 3), taking
 * the top-level/sub-group memo and the recursive list renderer with it: both
 * exist only for this screen.
 *
 * Touches: `buildChatHome` from `@lantern/shared/chat` for the desktop pane's
 * model. No I/O of its own — `inquiries` is fetched by the shell and passed in.
 *
 * Gotchas:
 *  - `expandedParentGroups` deliberately stays in the SHELL and arrives as a
 *    prop. This screen unmounts the moment a conversation is opened, so owning
 *    that state here would collapse every expanded parent group on the way back
 *    — a behaviour change the extraction must not make.
 *  - inbound message requests are filtered OUT of the active DM list and shown
 *    in their own section above it; a thread counts as inbound only when
 *    somebody else requested it.
 *  - the empty state is the same `ChatHomePane`, in `compact` mode, so the two
 *    layouts cannot disagree about what "no chats yet" offers.
 */
import React from 'react';
import {
  buildChatHome,
  type ChatHomeCommunityInput,
  type ChatHomeLounge,
} from '@lantern/shared/chat';
import { ChatHomePane } from './ChatHomePane';
import GroupListItem from '../GroupListItem';
import { AppIcon } from '../ui/AppIcon';
import type { ChatItem, DMThread, Group, User } from '../../types';

export interface ChatHomeScreenProps {
  currentUser: User;
  groups: Group[];
  dmThreads: DMThread[];
  /** The viewer's communities, from the shell's prop or the community store. */
  communities: ChatHomeCommunityInput[];
  /** Buyer-side marketplace inquiries, fetched by the shell. */
  inquiries: Array<{
    id: string;
    dm_thread_id?: string | null;
    status?: string | null;
    listing?: { title?: string | null } | null;
  }>;
  /** Expanded parent groups — owned by the shell; see the gotcha above. */
  expandedParentGroups: Record<string, boolean>;
  setExpandedParentGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSelectChat?: (chat: ChatItem) => void;
  onCreateGroup?: () => void;
  onOpenNewDmModal?: () => void;
  onOpenLounge?: (lounge: ChatHomeLounge) => void;
  onOpenInquiries?: () => void;
}

export const ChatHomeScreen: React.FC<ChatHomeScreenProps> = ({
  currentUser,
  groups,
  dmThreads,
  communities,
  inquiries,
  expandedParentGroups,
  setExpandedParentGroups,
  onSelectChat,
  onCreateGroup,
  onOpenNewDmModal,
  onOpenLounge,
  onOpenInquiries,
}) => {
  // build top‑level vs subgroup map once
  const { activeTopLevelGroups, archivedTopLevelGroups, subGroupsMap } = React.useMemo(() => {
    const activeTop: Group[] = [];
    const archivedTop: Group[] = [];
    const map: Record<string, Group[]> = {};

    (groups ?? []).forEach(g => {
      if (g.parentId) {
        if (!map[g.parentId]) map[g.parentId] = [];
        map[g.parentId].push(g);
      } else {
        if (g.isArchived) archivedTop.push(g);
        else activeTop.push(g);
      }
    });

    const sortFn = (a: Group, b: Group) => a.name.localeCompare(b.name);
    activeTop.sort(sortFn);
    archivedTop.sort(sortFn);
    Object.values(map).forEach(arr => arr.sort(sortFn));

    return { activeTopLevelGroups: activeTop, archivedTopLevelGroups: archivedTop, subGroupsMap: map };
  }, [groups]);

  // recursive renderer for mobile list entries
  const renderGroupWithSubgroups = (group: Group, nestingLevel: number = 0): React.ReactNode => {
    const subGroups = subGroupsMap[group.id] || [];
    const isExpanded = !!expandedParentGroups[group.id];

    return (
      <React.Fragment key={group.id}>
        <GroupListItem
          chat={{ ...group, chatType: 'group' as const }}
          currentUser={currentUser}
          isSelected={false}
          onClick={() => onSelectChat?.({ ...group, chatType: 'group' as const })}
          showText={true}
          hasSubGroups={subGroups.length > 0}
          isExpanded={isExpanded}
          onToggleExpand={subGroups.length > 0 ? () => setExpandedParentGroups(prev => ({ ...prev, [group.id]: !prev[group.id] })) : undefined}
          nestingLevel={nestingLevel}
        />
        {isExpanded && subGroups.map(sg => renderGroupWithSubgroups(sg, nestingLevel + 1))}
      </React.Fragment>
    );
  };

  // Desktop: show placeholder
  // Mobile: show inline group/DM list for navigation
  const inboundRequestThreads = dmThreads.filter(
    (t) =>
      !t.isArchived &&
      t.status === 'pending' &&
      typeof t.requestedBy === 'string' &&
      t.requestedBy !== currentUser.id,
  );
  const activeDmThreads = dmThreads.filter(
    (t) =>
      !t.isArchived &&
      !(
        t.status === 'pending' &&
        typeof t.requestedBy === 'string' &&
        t.requestedBy !== currentUser.id
      ),
  );
  const archivedDmThreads = dmThreads.filter(t => t.isArchived);
  const totalArchived = archivedTopLevelGroups.length + archivedDmThreads.length;
  const chatHome = buildChatHome({
    currentUserId: currentUser.id,
    groups,
    dmThreads,
    communities,
    inquiries,
  });

  return (
    <div className="flex-1 flex flex-col bg-lantern-background">
      <div className="hidden md:flex flex-1">
        <ChatHomePane
          model={chatHome}
          onMessageSomeone={onOpenNewDmModal}
          onNewGroup={onCreateGroup}
          onSelectRecent={(recent) => {
            if (recent.chatType === 'dm') {
              const thread = dmThreads.find((t) => t.id === recent.id);
              if (thread) onSelectChat?.({ ...thread, chatType: 'dm' });
              return;
            }
            const group = groups.find((g) => g.id === recent.id);
            if (group) onSelectChat?.({ ...group, chatType: 'group' });
          }}
          onOpenLounge={onOpenLounge}
          onOpenInquiries={onOpenInquiries}
        />
      </div>

      {/* Mobile group list */}
      <div className="md:hidden flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-lantern-surface border-b border-lantern-border">
          <h1 className="text-lg font-bold text-lantern-text">Chats</h1>
          <div className="flex items-center gap-2">
            {onOpenNewDmModal && (
              <button onClick={onOpenNewDmModal} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-text-secondary hover:text-lantern-primary rounded-lantern hover:bg-lantern-background-secondary" title="New message">
                <AppIcon name="chatbubble-ellipses" size={20} />
              </button>
            )}
            {onCreateGroup && (
              <button onClick={onCreateGroup} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-text-secondary hover:text-lantern-primary rounded-lantern hover:bg-lantern-background-secondary" title="New group">
                <AppIcon name="add-circle" size={20} />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {activeTopLevelGroups.length === 0 &&
          activeDmThreads.length === 0 &&
          inboundRequestThreads.length === 0 ? (
            <ChatHomePane
              compact
              model={chatHome}
              onMessageSomeone={onOpenNewDmModal}
              onNewGroup={onCreateGroup}
              onOpenLounge={onOpenLounge}
              onOpenInquiries={onOpenInquiries}
            />
          ) : (
            <div className="divide-y divide-lantern-border">
              {inboundRequestThreads.length > 0 && (
                <>
                  <div className="px-4 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider bg-amber-50 dark:bg-amber-950/30">
                    Message requests ({inboundRequestThreads.length})
                  </div>
                  {inboundRequestThreads.map((thread) => (
                    <GroupListItem
                      key={thread.id}
                      chat={{ ...thread, chatType: 'dm' as const }}
                      currentUser={currentUser}
                      isSelected={false}
                      onClick={() => onSelectChat?.({ ...thread, chatType: 'dm' as const })}
                      showText={true}
                    />
                  ))}
                </>
              )}

              {/* DM threads */}
              {activeDmThreads.map(thread => (
                <GroupListItem
                  key={thread.id}
                  chat={{ ...thread, chatType: 'dm' as const }}
                  currentUser={currentUser}
                  isSelected={false}
                  onClick={() => onSelectChat?.({ ...thread, chatType: 'dm' as const })}
                  showText={true}
                />
              ))}

              {/* Active groups */}
              {activeTopLevelGroups.map(group => renderGroupWithSubgroups(group, 0))}

              {/* Archived section (groups + DMs) */}
              {totalArchived > 0 && (
                <>
                  <div className="px-4 py-2 text-xs font-semibold text-lantern-text-tertiary uppercase tracking-wider bg-lantern-background-secondary">
                    Archived ({totalArchived})
                  </div>
                  {archivedDmThreads.map(thread => (
                    <GroupListItem
                      key={thread.id}
                      chat={{ ...thread, chatType: 'dm' as const }}
                      currentUser={currentUser}
                      isSelected={false}
                      onClick={() => onSelectChat?.({ ...thread, chatType: 'dm' as const })}
                      showText={true}
                    />
                  ))}
                  {archivedTopLevelGroups.map(group => (
                    <GroupListItem
                      key={group.id}
                      chat={{ ...group, chatType: 'group' as const }}
                      currentUser={currentUser}
                      isSelected={false}
                      onClick={() => onSelectChat?.({ ...group, chatType: 'group' as const })}
                      showText={true}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatHomeScreen;

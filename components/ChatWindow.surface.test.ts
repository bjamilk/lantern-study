/**
 * The safety net for the `components/ChatWindow.tsx` decomposition (lane M8).
 *
 * `ChatWindow` is one 2,783-line function at cyclomatic 510 holding **50 pieces
 * of component state** — the worst hooks violation in the repo. Splitting it
 * into `components/chat/*` and `hooks/chat/*` is only behaviour-preserving if
 * four things survive every step:
 *
 *  1. the props App.tsx passes — the component's only input contract,
 *  2. the module's exports — `default` and nothing else; three importers
 *     (`App.tsx`, `components/AppShell.tsx`, the chat route) depend on that,
 *  3. every piece of state, with no piece dropped, renamed or duplicated. State
 *     is what moves in this refactor, and a lost `useState` is the failure mode
 *     that renders fine and then silently stops updating,
 *  4. the two things the component can render at all: the chat-home pane
 *     (`chat === null`) and a conversation.
 *
 * (1)–(3) are read out of the SOURCE rather than by mounting, for the reason
 * `apps/web/src/useAppEffects.surface.test.ts` gives: mounting this component
 * needs ~20 module mocks, and a mock that drifts is how a surface test starts
 * lying. Reading the text cannot drift. (4) *is* a mount, kept deliberately
 * shallow — `renderToStaticMarkup`, so no effect runs and no network is
 * touched; it proves the tree still composes, not what it fetches.
 *
 * The state census in (3) doubles as the extraction map: the 50 pieces are
 * grouped by the cluster each belongs to, and the grouping is what decides
 * which module each one leaves in. Six clusters were planned (composer,
 * message-list, reactions/votes, attachments, header/menu, modals); the census
 * found two more that genuinely do not fit any of them — the marketplace
 * Offers tab and the chat-home pane — so they are named rather than forced.
 *
 * Reading order for a reviewer: this file first, then `components/ChatWindow.tsx`
 * (the shell), then the modules under `components/chat/` and `hooks/chat/`.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
// Static, not dynamic: this module's import graph is ~200 files, and paying for
// it inside a test body times the test out before it asserts anything.
import ChatWindow, * as chatWindowModule from './ChatWindow';

const REPO_ROOT = path.resolve(__dirname, '..');
const SHELL = path.join(REPO_ROOT, 'components/ChatWindow.tsx');

/**
 * The modules this decomposition has moved ChatWindow's code into, newest
 * last. It is an explicit list rather than a directory scan because
 * `components/chat/` already held five unrelated modules (the gallery and
 * forward modals, the home pane, the reaction bar, the link chip) before this
 * lane started, and their state is not ChatWindow's to account for. Every M8
 * extraction adds its file here in the same commit that creates it.
 */
const EXTRACTED_MODULES: string[] = [
  'components/chat/ChatHeader.tsx',
  'components/chat/ChatHeaderMenu.tsx',
  'components/chat/MessageRow.tsx',
];

const read = (file: string) => fs.readFileSync(file, 'utf8');

/** The shell plus every module the decomposition has extracted so far. */
function decomposedSources(): string[] {
  return [
    read(SHELL),
    ...EXTRACTED_MODULES.map((relative) => read(path.join(REPO_ROOT, relative))),
  ];
}

/** Top-level keys of `interface ChatWindowProps { … }`, in declaration order. */
function propKeys(): string[] {
  const source = read(SHELL);
  const start = source.indexOf('interface ChatWindowProps {');
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  // Only column-2 keys are top level; nested object types are indented further.
  return [...body.matchAll(/^ {2}([a-zA-Z][\w]*)\??\s*:/gm)].map((match) => match[1] as string);
}

/**
 * Every piece of component state reachable from the shell, by setter name.
 * `useQuestionVisibilityMode` is counted too: it is a `useState` wearing a hook
 * name (see `hooks/useQuestionVisibilityMode.ts`), so leaving it out would let
 * the census miss a 51st piece the day someone inlines it.
 */
function stateNames(): string[] {
  const names = new Set<string>();
  for (const source of decomposedSources()) {
    for (const match of source.matchAll(/const \[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*useState/g)) {
      names.add(match[1] as string);
    }
    for (const match of source.matchAll(
      /const \[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*useQuestionVisibilityMode/g
    )) {
      names.add(match[1] as string);
    }
  }
  return [...names].sort();
}

/**
 * The 50 pieces of state in the untouched file, by cluster. Extraction moves a
 * name into another module; it may not drop one, rename one, or add one — this
 * refactor introduces no state.
 */
const STATE_CLUSTERS: Record<string, string[]> = {
  /** The main and thread composers: what is being replied to, edited, mentioned. */
  composer: [
    'replyTo',
    'seedMentionUsername',
    'editingMessage',
    'threadReplyTo',
    'threadEditingMessage',
    'threadSeedMentionUsername',
  ],
  /** The scrolling list and the thread panel that mirrors it: paging, anchors, search. */
  'message-list': [
    'isLoadingMore',
    'hasMore',
    'awaitingMessages',
    'newMessagesBelow',
    'firstUnreadId',
    'typingUserIds',
    'threadRootId',
    'threadMessages',
    'threadLoading',
    'threadSearchOpen',
    'threadSearch',
    'starredOnly',
  ],
  /** Per-message marks the viewer owns: own reactions, stars, the pinned id. */
  'reactions-votes': ['myReactions', 'starredIds', 'pinnedMessageId'],
  /** Message media: the gallery overlay and the forward picker's subject. */
  attachments: ['galleryOpen', 'forwardMessage'],
  /** The header bar and its menus, including the DM relationship they reflect. */
  'header-menu': [
    'isDropdownOpen',
    'questionFiltersOpen',
    'muteDurationsOpen',
    'questionVisibilityMode',
    'resolvedPeerPresence',
    'chatMuted',
    'chatMutedUntil',
    'muteBusy',
    'dmRequestStatus',
    'dmRequestBusy',
    'dmBlocked',
    'iBlockedThem',
    'dmBlockBusy',
  ],
  /** Modal subjects. A null here is "closed"; the modal itself is a child. */
  modals: ['reportTarget', 'showMakeOfferModal'],
  /** The Offers tab a marketplace-inquiry DM grows. Not one of the six planned
   *  clusters — it is a second application inside the component. */
  'marketplace-offers': [
    'inquiry',
    'activeOffer',
    'offerHistory',
    'activeTab',
    'showCounterInput',
    'counterValue',
    'offerLoading',
    'offerError',
    'activeOrder',
    'orderActionLoading',
  ],
  /** The `chat === null` pane: a different screen sharing the same component. */
  'chat-home': ['buyerInquiries', 'expandedParentGroups'],
};

const FROZEN_STATE = Object.values(STATE_CLUSTERS).flat().sort();

/** Frozen against the untouched 2,964-line file. App.tsx passes exactly these. */
const FROZEN_PROPS = [
  'chat',
  'messages',
  'currentUser',
  'userVotes',
  'onSendMessage',
  'onEditMessage',
  'onRemoveMessage',
  'onPeerChatRead',
  'onOpenQuestionModal',
  'onOpenGroupInfoModal',
  'onOpenTestConfigModal',
  'onOpenStudyConfigModal',
  'onVoteQuestion',
  'onFlagAsSimilar',
  'onOpenCreateSubGroupModal',
  'groups',
  'onToggleArchiveGroup',
  'onOpenAIGenerateModal',
  'onAIQuery',
  'dmThreads',
  'onSelectChat',
  'onBack',
  'onCreateGroup',
  'onOpenNewDmModal',
  'onDeleteDmThread',
  'onArchiveDmThread',
  'onUnarchiveDmThread',
  'onDmThreadStatusChange',
  'onLoadMoreMessages',
  'onLoadMoreDirectMessages',
  'unreadAnchorAt',
  'communityContext',
  'chatHomeCommunities',
  'chatHomeInquiries',
  'onOpenLounge',
  'onOpenInquiries',
  'peerPresence',
];

describe('ChatWindow surface', () => {
  it('takes exactly the props App.tsx passes', () => {
    expect(propKeys()).toEqual(FROZEN_PROPS);
  });

  it('still holds every one of the 50 pieces of state, and no new one', () => {
    expect(stateNames()).toEqual(FROZEN_STATE);
  });

  it('assigns every piece of state to exactly one cluster', () => {
    const seen = new Set<string>();
    for (const names of Object.values(STATE_CLUSTERS)) {
      for (const name of names) {
        expect(seen.has(name), `${name} is in two clusters`).toBe(false);
        seen.add(name);
      }
    }
    expect(seen.size).toBe(50);
  });

  it('exports the component as the default and nothing else', () => {
    expect(typeof chatWindowModule.default).toBe('function');
    expect(Object.keys(chatWindowModule).filter((key) => key !== 'default')).toEqual([]);
  });
});

/**
 * The render smoke test. Static markup only: `renderToStaticMarkup` runs no
 * effect, so nothing here fetches, subscribes to Realtime or touches
 * localStorage — this proves the tree composes, not what it loads.
 *
 * The mocks are the component's I/O edges (supabase, the four zustand stores,
 * the budget hook) and nothing else: children render for real, which is what
 * makes this catch a child that an extraction wired up wrong.
 */
vi.mock('../services/supabase', () => {
  // Named one by one rather than with a catch-all Proxy: a Proxy answers `then`
  // too, which makes the module namespace look thenable and hangs the ESM
  // loader forever. Every name below is one ChatWindow actually imports.
  const noop = () => Promise.resolve(null);
  const names = [
    'addMessageReaction',
    'removeMessageReaction',
    'fetchUserReactionsForGroup',
    'fetchUserReactionsForThread',
    'fetchMyInquiries',
    'fetchUserProfile',
    'getInquiryByThread',
    'fetchOffers',
    'respondToOffer',
    'updateInquiryStatus',
    'fetchOrderForInquiry',
    'updateMarketplaceOrder',
    'resumeMarketplaceOrderCheckout',
    'fetchGroupThread',
    'fetchDmThread',
    'acceptDmMessageRequest',
    'declineDmMessageRequest',
    'getDmBlockStatus',
    'blockUser',
    'unblockUser',
    'getDmMuteStatus',
    'muteDmThread',
    'unmuteDmThread',
    'getGroupMuteStatus',
    'muteGroupChat',
    'unmuteGroupChat',
  ];
  const module: Record<string, unknown> = {
    supabase: {
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
        send: () => Promise.resolve(),
        unsubscribe: () => Promise.resolve(),
      }),
      removeChannel: () => Promise.resolve(),
    },
  };
  for (const name of names) module[name] = noop;
  return module;
});

vi.mock('../stores/groupStore', () => ({
  useGroupStore: (selector: (state: unknown) => unknown) =>
    selector({ updateMessageInState: () => {} }),
}));
vi.mock('../stores/communityStore', () => ({
  useCommunityStore: (selector: (state: unknown) => unknown) => selector({ myCommunities: [] }),
}));
vi.mock('../stores/toastStore', () => ({
  useToastStore: (selector: (state: unknown) => unknown) => selector({ showToast: () => {} }),
}));
vi.mock('../stores/uiStore', () => ({
  useUIStore: () => ({ lowDataMode: false }),
}));
vi.mock('../hooks/useBudgetHandlers', () => ({
  useBudgetHandlers: () => ({ refreshBudgetTransactions: () => {} }),
}));

const currentUser = {
  id: 'u1',
  name: 'Ada Ogundele',
  username: 'ada',
  email: 'ada@example.edu',
} as never;

const baseProps = {
  messages: [],
  currentUser,
  userVotes: {},
  onSendMessage: () => {},
  onEditMessage: () => Promise.resolve(null),
  onRemoveMessage: () => Promise.resolve(null),
  onOpenQuestionModal: () => {},
  onOpenGroupInfoModal: () => {},
  onOpenTestConfigModal: () => {},
  onOpenStudyConfigModal: () => {},
  onVoteQuestion: () => {},
  onFlagAsSimilar: () => {},
  onOpenCreateSubGroupModal: () => {},
  groups: [],
  onToggleArchiveGroup: () => {},
} as never;

const groupChat = {
  id: 'g1',
  chatType: 'group',
  name: 'Pharmacology 301',
  description: 'Second years',
} as never;

describe('ChatWindow renders', () => {
  it('renders the chat-home pane when no conversation is open', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatWindow, { ...(baseProps as object), chat: null } as never)
    );
    expect(html).toContain('<div');
    // The home pane offers the two ways to start a conversation.
    expect(html).toMatch(/New (chat|message)|Start|Chats/i);
  });

  it('renders a group conversation: header, empty list, composer', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatWindow, {
        ...(baseProps as object),
        chat: groupChat,
        groups: [{ id: 'g1', name: 'Pharmacology 301', members: [] }],
      } as never)
    );
    // Header: the conversation's name.
    expect(html).toContain('Pharmacology 301');
    // List: the empty state, because `messages` is empty.
    expect(html).toContain('No messages yet');
    // Composer: the search affordance and a text entry both present.
    expect(html).toContain('aria-label="Search in chat"');
    expect(html).toMatch(/<textarea|<input/);
  });
});

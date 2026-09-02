import { AppMode, ChatItem, DMThread } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useGroupStore } from '../stores/groupStore';
import { useNotesStore } from '../stores/notesStore';
import { useUIStore } from '../stores/uiStore';
import { fetchDecks, fetchDmThreads, fetchGroups } from '../services/supabase';
import { mapDmThreadFromApi, mergeDmThreadLists } from '../utils/dmThreads';
import { ParsedAppRoute, isLibraryTabParam } from '../utils/appRoutes';

export interface HydrationResult {
  mode: AppMode | null;
  redirect?: string;
}

/** Thread ids are `${sortedUuidA}-${sortedUuidB}` — recover the peer when list race loses. */
function otherParticipantFromThreadId(threadId: string, userId: string): string | null {
  const prefix = `${userId}-`;
  const suffix = `-${userId}`;
  if (threadId.startsWith(prefix)) return threadId.slice(prefix.length) || null;
  if (threadId.endsWith(suffix)) return threadId.slice(0, -suffix.length) || null;
  return null;
}

export async function hydrateAppRoute(parsed: ParsedAppRoute): Promise<HydrationResult> {
  const ui = useUIStore.getState();
  const { mode, params, clearChat, clearDeck } = parsed;

  if (!mode) {
    return { mode: null };
  }

  if (clearChat) {
    ui.setSelectedChat(null);
  }
  if (clearDeck) {
    ui.setSelectedDeck(null);
  }

  switch (mode) {
    case AppMode.CHAT: {
      if (params.groupId) {
        const { groups } = useGroupStore.getState();
        let group = groups.find((g) => g.id === params.groupId);
        if (!group) {
          const userId = useAuthStore.getState().currentUser?.id;
          if (userId) {
            try {
              const fetched = await fetchGroups(userId);
              if (fetched) {
                useGroupStore.getState().setGroups(fetched);
              }
            } catch {
              // fall through to redirect
            }
          }
          group = useGroupStore.getState().groups.find((g) => g.id === params.groupId);
        }
        if (!group) {
          return { mode: AppMode.CHAT, redirect: '/chat' };
        }
        const chat: ChatItem = { ...group, chatType: 'group' };
        ui.setSelectedChat(chat);
      } else if (params.threadId) {
        const userId = useAuthStore.getState().currentUser?.id;
        let thread = useGroupStore.getState().dmThreads.find((t) => t.id === params.threadId);

        // Deep links often race the bootstrap threads fetch — load once before redirecting.
        if (!thread && userId) {
          try {
            const fetched = await fetchDmThreads(userId);
            if (Array.isArray(fetched)) {
              const mapped = fetched.map((t: any) => mapDmThreadFromApi(t));
              useGroupStore.getState().updateDmThreads((prev) =>
                mergeDmThreadLists(prev, mapped, 'server')
              );
              thread = useGroupStore
                .getState()
                .dmThreads.find((t) => t.id === params.threadId);
            }
          } catch {
            // fall through — may still open from optimistic/local cache below
          }
        }

        // Last resort: open from composite thread id so message fetch can proceed
        // while the threads list catches up.
        if (!thread && userId && typeof params.threadId === 'string') {
          const otherUserId = otherParticipantFromThreadId(params.threadId, userId);
          if (otherUserId && otherUserId !== userId) {
            const synthesized: DMThread = {
              id: params.threadId,
              participantIds: [userId, otherUserId].sort() as [string, string],
              participants: {},
              clientPending: true,
            };
            useGroupStore.getState().updateDmThreads((prev) =>
              prev.some((t) => t.id === params.threadId) ? prev : [...prev, synthesized]
            );
            thread = synthesized;
          }
        }

        if (!thread) {
          return { mode: AppMode.CHAT, redirect: '/chat' };
        }
        ui.setSelectedChat({ ...thread, chatType: 'dm' });
      }
      return { mode: AppMode.CHAT };
    }

    case AppMode.DECK_DETAIL: {
      if (!params.deckId) {
        return { mode: AppMode.FLASHCARDS, redirect: '/flashcards' };
      }
      const { decks } = useFlashcardStore.getState();
      let deck = decks.find((d) => d.id === params.deckId);
      if (!deck) {
        const userId = useAuthStore.getState().currentUser?.id;
        if (userId) {
          try {
            const fetched = await fetchDecks(userId, { includeShared: true });
            const mapped = (fetched || [])
              .filter((d: any) => d && d.id)
              .map((d: any) => ({
              id: d.id,
              name: d.name,
              description: d.description,
              createdAt: d.created_at || d.createdAt,
              userId: d.user_id || d.userId,
              isShared: d.is_shared || d.isShared,
            }));
            useFlashcardStore.getState().setDecks(mapped);
            deck = mapped.find((d) => d.id === params.deckId);
          } catch {
            // fall through to redirect
          }
        }
      }
      if (!deck) {
        return { mode: AppMode.FLASHCARDS, redirect: '/flashcards' };
      }
      ui.setSelectedDeck(deck);
      return { mode: AppMode.DECK_DETAIL };
    }

    case AppMode.MARKETPLACE_LISTING_DETAIL:
      if (!params.listingId) {
        return { mode: AppMode.MARKETPLACE, redirect: '/marketplace' };
      }
      ui.setSelectedMarketplaceListingId(params.listingId);
      return { mode: AppMode.MARKETPLACE_LISTING_DETAIL };

    case AppMode.MARKETPLACE_ORDER_DETAIL:
      if (!params.orderId) {
        return { mode: AppMode.MARKETPLACE_ORDERS, redirect: '/marketplace/orders' };
      }
      ui.setSelectedMarketplaceOrderId(params.orderId);
      return { mode: AppMode.MARKETPLACE_ORDER_DETAIL };

    case AppMode.SELLER_PROFILE:
      if (!params.sellerId) {
        return { mode: AppMode.MARKETPLACE, redirect: '/marketplace' };
      }
      ui.setSelectedSellerId(params.sellerId);
      return { mode: AppMode.SELLER_PROFILE };

    case AppMode.JOB_COMPANY:
      if (!params.companyId) {
        return { mode: AppMode.MARKETPLACE_JOBS, redirect: '/marketplace/jobs' };
      }
      ui.setSelectedCompanyId(params.companyId);
      return { mode: AppMode.JOB_COMPANY };

    case AppMode.MARKETPLACE_JOB_DETAIL:
      if (!params.jobId) {
        return { mode: AppMode.MARKETPLACE_JOBS, redirect: '/marketplace/jobs' };
      }
      ui.setSelectedJobId(params.jobId);
      return { mode: AppMode.MARKETPLACE_JOB_DETAIL };

    case AppMode.JOB_EMPLOYER_PIPELINE:
      if (!params.jobId) {
        return { mode: AppMode.JOB_EMPLOYER, redirect: '/marketplace/employer' };
      }
      ui.setSelectedJobId(params.jobId);
      return { mode: AppMode.JOB_EMPLOYER_PIPELINE };

    // /jobs/new carries no id, so a stale one must not survive a reload.
    case AppMode.CREATE_MARKETPLACE_JOB:
      ui.setSelectedJobId(params.jobId ?? null);
      return { mode: AppMode.CREATE_MARKETPLACE_JOB };

    case AppMode.NOTE_EDITOR: {
      if (!params.noteId) {
        return { mode: AppMode.NOTES, redirect: '/notes' };
      }
      const notesStore = useNotesStore.getState();
      const existing = notesStore.notes.find((n) => n.id === params.noteId);
      if (existing && notesStore.selectedNote?.id === params.noteId) {
        return { mode: AppMode.NOTE_EDITOR };
      }
      try {
        await notesStore.loadNote(params.noteId);
        if (!useNotesStore.getState().selectedNote) {
          return { mode: AppMode.NOTES, redirect: '/notes' };
        }
        void notesStore.loadComments(params.noteId);
      } catch {
        return { mode: AppMode.NOTES, redirect: '/notes' };
      }
      return { mode: AppMode.NOTE_EDITOR };
    }

    case AppMode.NOTES: {
      const notesStore = useNotesStore.getState();
      void notesStore.loadFolders();
      void notesStore.loadNotes();
      return { mode: AppMode.NOTES };
    }

    // The URL is the authority for the Library tab. A deep link, a Back/Forward
    // step and a reload all name the tab in the path, and that name overwrites
    // the persisted `libraryTab` — otherwise `/library/flashcards` would open on
    // Notes for anyone whose last visit ended there. Bare `/library` names no
    // tab: it adopts the persisted one and rewrites itself to that sub-path, so
    // the address bar always shows something shareable. The rewrite terminates
    // because the redirected path does name a tab.
    case AppMode.LIBRARY: {
      if (!params.libraryTab) {
        // Validated, not trusted: `libraryTab` comes back from localStorage, so a
        // stale or hand-edited value would be pasted into a path the parser then
        // refuses, and the two would bounce the user between them forever.
        const tab = isLibraryTabParam(ui.libraryTab) ? ui.libraryTab : 'notes';
        return { mode: AppMode.LIBRARY, redirect: `/library/${tab}` };
      }
      if (ui.libraryTab !== params.libraryTab) {
        ui.setLibraryTab(params.libraryTab);
      }
      return { mode: AppMode.LIBRARY };
    }

    case AppMode.BUDGET_TRACKER: {
      if (params.budgetTab === 'wallet') {
        if (ui.budgetTab !== 'wallet') ui.setBudgetTab('wallet');
      } else if (ui.budgetTab === 'wallet') {
        ui.setBudgetTab('overview');
      }
      return { mode: AppMode.BUDGET_TRACKER };
    }

    case AppMode.ADMIN:
      return { mode: AppMode.ADMIN };

    case AppMode.STUDY_ROOM:
      if (params.roomId) {
        ui.setSelectedStudyRoomId(params.roomId);
      }
      return { mode: AppMode.STUDY_ROOM };

    // `/discover/c/:slug` and `/discover/c/:slug/ch/:groupId`. The column
    // needs an active community before it can render, so a cold load seeds a
    // placeholder from the slug (CommunityColumn resolves the full record)
    // and, for a channel, selects the group through the same store path the
    // chat screen uses — read-marking and realtime then behave identically.
    case AppMode.COMMUNITY_DETAIL: {
      if (!params.slug) {
        return { mode: AppMode.DISCOVER, redirect: '/discover' };
      }
      const active = ui.activeCommunity;
      if (!active || active.slug !== params.slug) {
        ui.setActiveCommunity({ id: '', slug: params.slug, name: '', loungeGroupId: null });
      }
      if (params.groupId) {
        let group = useGroupStore.getState().groups.find((g) => g.id === params.groupId);
        if (!group) {
          const userId = useAuthStore.getState().currentUser?.id;
          if (userId) {
            try {
              const fetched = await fetchGroups(userId);
              if (fetched) {
                useGroupStore.getState().setGroups(fetched);
              }
            } catch {
              // fall through to the community home
            }
          }
          group = useGroupStore.getState().groups.find((g) => g.id === params.groupId);
        }
        if (!group) {
          useUIStore.getState().setSelectedChat(null);
          return {
            mode: AppMode.COMMUNITY_DETAIL,
            redirect: `/discover/c/${encodeURIComponent(params.slug)}`,
          };
        }
        const current = useUIStore.getState().selectedChat;
        if (!current || current.chatType !== 'group' || current.id !== group.id) {
          ui.setSelectedChat({ ...group, chatType: 'group' });
        }
      } else if (useUIStore.getState().selectedChat) {
        // The community home has no channel open. Browser Back/Forward comes
        // through here instead of `applyPreNavigationEffects`, and leaving the
        // channel selected makes realtime keep treating it as "being viewed",
        // so its unread badge never increments again.
        ui.setSelectedChat(null);
      }
      return { mode: AppMode.COMMUNITY_DETAIL };
    }

    default:
      return { mode };
  }
}

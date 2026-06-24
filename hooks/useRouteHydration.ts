import { AppMode, ChatItem } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useFlashcardStore } from '../stores/flashcardStore';
import { useGroupStore } from '../stores/groupStore';
import { useNotesStore } from '../stores/notesStore';
import { useUIStore } from '../stores/uiStore';
import { fetchDecks, fetchGroups } from '../services/supabase';
import { ParsedAppRoute } from '../utils/appRoutes';

export interface HydrationResult {
  mode: AppMode | null;
  redirect?: string;
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
        const { dmThreads } = useGroupStore.getState();
        const thread = dmThreads.find((t) => t.id === params.threadId);
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
            const mapped = (fetched || []).map((d: any) => ({
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

    case AppMode.ADMIN:
      return { mode: AppMode.ADMIN };

    default:
      return { mode };
  }
}

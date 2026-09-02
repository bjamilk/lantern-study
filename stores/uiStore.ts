/**
 * Web UI Store
 * Manages UI state including modals, app mode, theme, sidebar
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppMode, ChatItem, Deck, Flashcard, FlashcardSession, TestResult, Message, User, TestSessionData, StudySessionData, GameSession } from '../types';
import type { NoteImportProgress } from '../services/notes';
import { isEphemeralAppMode, isRoutableAppMode, type BudgetTabParam } from '../utils/appRoutes';
import { navigateForAppMode } from '../utils/appNavigation';

export interface ActiveCommunity {
  id: string;
  slug: string;
  name: string;
  loungeGroupId: string | null;
}

export interface CommunityPresenceState {
  communityId: string;
  onlineIds: string[];
  connected: boolean;
}

export interface StudyRoomJoin {
  courseId?: string | null;
  topic?: string | null;
  /** Start-a-room from inside a community: join-or-create lands everyone in its one open room. */
  communityId?: string | null;
}

interface UIState {
  // App Mode
  appMode: AppMode;
  /** Sets mode without URL navigation (used by route sync). */
  setAppModeDirect: (mode: AppMode) => void;
  setAppMode: (mode: AppMode) => void;
  
  // Selected Chat
  selectedChat: ChatItem | null;
  setSelectedChat: (chatOrUpdater: ChatItem | null | ((prev: ChatItem | null) => ChatItem | null)) => void;
  
  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  
  // Sidebar
  isSidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;

  /** Which side the unified Add-transaction sheet opens on. */
  addTransactionType: 'expense' | 'income';
  setAddTransactionType: (t: 'expense' | 'income') => void;
  toggleSidebar: () => void;

  /** When false, the Chats list is collapsed and unread rolls up to the Chats header. */
  isChatsSectionExpanded: boolean;
  setChatsSectionExpanded: (expanded: boolean) => void;
  toggleChatsSection: () => void;
  
  // Modal States
  modals: {
    createGroup: boolean;
    createDeck: boolean;
    createFlashcard: boolean;
    newDm: boolean;
    settings: boolean;
    question: boolean;
    groupInfo: boolean;
    testConfig: boolean;
    addMembers: boolean;
    notification: boolean;
    duplicateQuestion: boolean;
    addExpense: boolean;
    addIncome: boolean;
    addTransaction: boolean;
    addInvestment: boolean;
    setBudget: boolean;
    setMonthlyPlan: boolean;
    savingsGoal: boolean;
    wallet: boolean;
    financialToolkit: boolean;
    expenseSplit: boolean;
    recurring: boolean;
    createMarketplaceListing: boolean;
    editMarketplaceListing: boolean;
    testAnalysis: boolean;
    usernameRequired: boolean;
    aiGenerateQuestions: boolean;
    challenges: boolean;
  };
  openModal: (modal: keyof UIState['modals']) => void;
  closeModal: (modal: keyof UIState['modals']) => void;
  closeAllModals: () => void;

  /** Active Settings dialog tab — lives in the store so Suspense remounts don't bounce to Profile. */
  settingsTab:
    | 'profile'
    | 'academic'
    | 'notifications'
    | 'study'
    | 'appearance'
    | 'privacy'
    | 'marketplace'
    | 'dataSync'
    | 'support'
    | 'account';
  setSettingsTab: (tab: UIState['settingsTab']) => void;
  
  // Test Config
  activeTestConfigMode: 'test' | 'study' | 'game';
  setActiveTestConfigMode: (mode: 'test' | 'study' | 'game') => void;
  
  // Flashcard State
  selectedDeck: Deck | null;
  setSelectedDeck: (deck: Deck | null) => void;
  editingDeck: Deck | null;
  setEditingDeck: (deck: Deck | null) => void;
  editingFlashcard: Flashcard | null;
  setEditingFlashcard: (flashcard: Flashcard | null) => void;
  flashcardInitialDeckId: string | undefined;
  setFlashcardInitialDeckId: (id: string | undefined) => void;
  
  // Review/Cram Sessions
  activeReviewSession: FlashcardSession | null;
  setActiveReviewSession: (session: FlashcardSession | null) => void;
  activeCramSession: FlashcardSession | null;
  setActiveCramSession: (session: FlashcardSession | null) => void;
  
  // Test Results
  activeTestResult: TestResult | null;
  setActiveTestResult: (result: TestResult | null) => void;
  analyzingResult: TestResult | null;
  setAnalyzingResult: (result: TestResult | null) => void;
  
  // Duplicate Question
  duplicateInfo: { 
    newQuestionData: Omit<Message, 'id' | 'timestamp' | 'sender' | 'upvotes' | 'downvotes'>; 
    existingQuestion: Message 
  } | null;
  setDuplicateInfo: (info: UIState['duplicateInfo']) => void;
  
  // Challenge
  challengeOpponent: User | null;
  setChallengeOpponent: (user: User | null) => void;
  
  
  // Subgroup
  subgroupParentId: string | undefined;
  setSubgroupParentId: (id: string | undefined) => void;
  
  // Marketplace
  marketplaceListingCategory: 'academic' | 'student-life';
  setMarketplaceListingCategory: (category: 'academic' | 'student-life') => void;
  selectedMarketplaceListingId: string | null;
  setSelectedMarketplaceListingId: (id: string | null) => void;
  selectedMarketplaceListingInitialQuantity: number | null;
  setSelectedMarketplaceListingInitialQuantity: (qty: number | null) => void;
  selectedMarketplaceOrderId: string | null;
  setSelectedMarketplaceOrderId: (id: string | null) => void;
  editingMarketplaceListing: any | null;
  setEditingMarketplaceListing: (listing: any) => void;
  selectedSellerId: string | null;
  setSelectedSellerId: (id: string | null) => void;
  selectedJobId: string | null;
  setSelectedJobId: (id: string | null) => void;
  selectedCompanyId: string | null;
  setSelectedCompanyId: (id: string | null) => void;
  selectedStudyRoomId: string | null;
  setSelectedStudyRoomId: (id: string | null) => void;
  studyRoomJoin: StudyRoomJoin | null;
  setStudyRoomJoin: (join: StudyRoomJoin | null) => void;

  /**
   * The community whose column is out (Discord-style "server"). Set while the
   * community page or one of its channels/rooms is on screen; cleared by
   * App.tsx the moment the app leaves those modes. Never persisted — a
   * reload resolves it again from the URL.
   */
  activeCommunity: ActiveCommunity | null;
  setActiveCommunity: (community: ActiveCommunity | null) => void;
  /** Live presence for `activeCommunity`, written by the single useCommunityPresence hook. */
  communityPresence: CommunityPresenceState | null;
  setCommunityPresence: (presence: CommunityPresenceState | null) => void;

  // Online Status
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;

  // Low-Data Mode
  lowDataMode: boolean;
  setLowDataMode: (enabled: boolean) => void;

  // Note file import progress (PDF / PowerPoint)
  importProgress: NoteImportProgress | null;
  setImportProgress: (progress: NoteImportProgress | null) => void;
  clearImportProgress: () => void;

  // Library tab (notes | flashcards)
  libraryTab: 'notes' | 'flashcards';
  setLibraryTab: (tab: 'notes' | 'flashcards') => void;

  /** Budget section tab. `wallet` is URL-addressable at `/budget/wallet`. */
  budgetTab: BudgetTabParam;
  setBudgetTab: (tab: BudgetTabParam) => void;

  /**
   * Small-screen Library course rail. Persisted like the sidebar: as local
   * screen state it collapsed on every navigation, so a user browsing by course
   * had to reopen it each time they came back to the Library.
   */
  /**
   * The small-screen course drop-panel. Lives in the store so it survives
   * navigation within a session, but is deliberately NOT persisted: it is a
   * transient disclosure, and restoring it open on arrival would re-add up to
   * 50vh above the list on exactly the screens with the least room. The desktop
   * preference is `isLibraryRailCollapsed`, which IS persisted.
   */
  isLibraryRailOpen: boolean;
  setLibraryRailOpen: (open: boolean) => void;
  toggleLibraryRail: () => void;

  /**
   * Desktop Library course rail, narrowed to an icon strip. A separate flag
   * from `isLibraryRailOpen` on purpose: that one is the small-screen
   * disclosure, and every course or topic pick closes it — right for a panel
   * covering the list, wrong for a rail sitting beside it.
   */
  isLibraryRailCollapsed: boolean;
  setLibraryRailCollapsed: (collapsed: boolean) => void;
  toggleLibraryRailCollapsed: () => void;
}

const initialModals = {
  createGroup: false,
  createDeck: false,
  createFlashcard: false,
  newDm: false,
  settings: false,
  question: false,
  groupInfo: false,
  testConfig: false,
  addMembers: false,
  notification: false,
  duplicateQuestion: false,
  addExpense: false,
  addIncome: false,
  addTransaction: false,
  addInvestment: false,
  setBudget: false,
  setMonthlyPlan: false,
  savingsGoal: false,
  wallet: false,
  financialToolkit: false,
  expenseSplit: false,
  recurring: false,
  createMarketplaceListing: false,
  editMarketplaceListing: false,
  testAnalysis: false,
  usernameRequired: false,
  aiGenerateQuestions: false,
  challenges: false,
};

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // App Mode
      appMode: AppMode.CHAT,
      setAppModeDirect: (mode) => set({ appMode: mode }),
      setAppMode: (mode) => {
        if (isEphemeralAppMode(mode)) {
          set({ appMode: mode });
          return;
        }
        if (isRoutableAppMode(mode)) {
          navigateForAppMode(mode);
          return;
        }
        set({ appMode: mode });
      },
      
      // Selected Chat
      selectedChat: null,
      setSelectedChat: (chatOrUpdater) => {
        if (typeof chatOrUpdater === 'function') {
          set((state) => ({ selectedChat: chatOrUpdater(state.selectedChat) }));
        } else {
          set({ selectedChat: chatOrUpdater });
        }
      },
      
      // Theme
      theme: 'light',
      setTheme: (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        set({ theme });
      },
      toggleTheme: () => {
        const newTheme = get().theme === 'light' ? 'dark' : 'light';
        document.documentElement.classList.toggle('dark', newTheme === 'dark');
        set({ theme: newTheme });
      },
      
      // Sidebar
      isSidebarExpanded: true,
      setSidebarExpanded: (expanded) => set({ isSidebarExpanded: expanded }),
      addTransactionType: 'expense',
      setAddTransactionType: (t) => set({ addTransactionType: t }),
      toggleSidebar: () => set((state) => ({ isSidebarExpanded: !state.isSidebarExpanded })),

      isChatsSectionExpanded: true,
      setChatsSectionExpanded: (expanded) => set({ isChatsSectionExpanded: expanded }),
      toggleChatsSection: () =>
        set((state) => ({ isChatsSectionExpanded: !state.isChatsSectionExpanded })),
      
      // Modals
      modals: { ...initialModals },
      openModal: (modal) => set((state) => ({
        modals: { ...state.modals, [modal]: true },
        ...(modal === 'settings' ? { settingsTab: 'profile' as const } : {}),
      })),
      closeModal: (modal) => set((state) => ({
        modals: { ...state.modals, [modal]: false },
        ...(modal === 'settings' ? { settingsTab: 'profile' as const } : {}),
      })),
      closeAllModals: () => set({ modals: { ...initialModals }, settingsTab: 'profile' }),

      settingsTab: 'profile',
      setSettingsTab: (tab) => set({ settingsTab: tab }),
      
      // Test Config
      activeTestConfigMode: 'test',
      setActiveTestConfigMode: (mode) => set({ activeTestConfigMode: mode }),
      
      // Flashcard State
      selectedDeck: null,
      setSelectedDeck: (deck) => set({ selectedDeck: deck }),
      editingDeck: null,
      setEditingDeck: (deck) => set({ editingDeck: deck }),
      editingFlashcard: null,
      setEditingFlashcard: (flashcard) => set({ editingFlashcard: flashcard }),
      flashcardInitialDeckId: undefined,
      setFlashcardInitialDeckId: (id) => set({ flashcardInitialDeckId: id }),
      
      // Review/Cram Sessions
      activeReviewSession: null,
      setActiveReviewSession: (session) => set({ activeReviewSession: session }),
      activeCramSession: null,
      setActiveCramSession: (session) => set({ activeCramSession: session }),
      
      // Test Results
      activeTestResult: null,
      setActiveTestResult: (result) => set({ activeTestResult: result }),
      analyzingResult: null,
      setAnalyzingResult: (result) => set({ analyzingResult: result }),
      
      // Duplicate Question
      duplicateInfo: null,
      setDuplicateInfo: (info) => set({ duplicateInfo: info }),
      
      // Challenge
      challengeOpponent: null,
      setChallengeOpponent: (user) => set({ challengeOpponent: user }),
      
      
      // Subgroup
      subgroupParentId: undefined,
      setSubgroupParentId: (id) => set({ subgroupParentId: id }),
      
      // Marketplace
      marketplaceListingCategory: 'academic',
      setMarketplaceListingCategory: (category) => set({ marketplaceListingCategory: category }),
      selectedMarketplaceListingId: null,
      setSelectedMarketplaceListingId: (id) => set({ selectedMarketplaceListingId: id }),
      selectedMarketplaceListingInitialQuantity: null,
      setSelectedMarketplaceListingInitialQuantity: (qty) =>
        set({ selectedMarketplaceListingInitialQuantity: qty }),
      selectedMarketplaceOrderId: null,
      setSelectedMarketplaceOrderId: (id) => set({ selectedMarketplaceOrderId: id }),
      editingMarketplaceListing: null,
      setEditingMarketplaceListing: (listing) => set({ editingMarketplaceListing: listing }),
      selectedSellerId: null,
      setSelectedSellerId: (id) => set({ selectedSellerId: id }),
      selectedJobId: null,
      setSelectedJobId: (id) => set({ selectedJobId: id }),
      selectedCompanyId: null,
      setSelectedCompanyId: (id) => set({ selectedCompanyId: id }),
      selectedStudyRoomId: null,
      setSelectedStudyRoomId: (id) => set({ selectedStudyRoomId: id }),
      studyRoomJoin: null,
      setStudyRoomJoin: (join) => set({ studyRoomJoin: join }),

      activeCommunity: null,
      setActiveCommunity: (community) =>
        set((state) => ({
          activeCommunity: community,
          // Presence belongs to one community; drop it when the community changes.
          communityPresence:
            community && state.communityPresence?.communityId === community.id
              ? state.communityPresence
              : null,
        })),
      communityPresence: null,
      setCommunityPresence: (presence) => set({ communityPresence: presence }),

      // Online Status
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      setIsOnline: (online) => set({ isOnline: online }),

      // Low-Data Mode
      lowDataMode: true,
      setLowDataMode: (enabled) => set({ lowDataMode: enabled }),

      importProgress: null,
      setImportProgress: (progress) => set({ importProgress: progress }),
      clearImportProgress: () => set({ importProgress: null }),

      libraryTab: 'notes' as const,
      setLibraryTab: (tab) => set({ libraryTab: tab }),

      budgetTab: 'overview' as const,
      setBudgetTab: (tab) => set({ budgetTab: tab }),

      isLibraryRailOpen: false,
      setLibraryRailOpen: (open) => set({ isLibraryRailOpen: open }),
      toggleLibraryRail: () => set((state) => ({ isLibraryRailOpen: !state.isLibraryRailOpen })),

      isLibraryRailCollapsed: false,
      setLibraryRailCollapsed: (collapsed) => set({ isLibraryRailCollapsed: collapsed }),
      toggleLibraryRailCollapsed: () =>
        set((state) => ({ isLibraryRailCollapsed: !state.isLibraryRailCollapsed })),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        isSidebarExpanded: state.isSidebarExpanded,
        isChatsSectionExpanded: state.isChatsSectionExpanded,
        lowDataMode: state.lowDataMode,
        libraryTab: state.libraryTab,
        isLibraryRailCollapsed: state.isLibraryRailCollapsed,
      }),
    }
  )
);

// Listen for online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useUIStore.getState().setIsOnline(true));
  window.addEventListener('offline', () => useUIStore.getState().setIsOnline(false));
}

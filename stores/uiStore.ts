/**
 * Web UI Store
 * Manages UI state including modals, app mode, theme, sidebar
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppMode, ChatItem, Deck, Flashcard, FlashcardSession, TestResult, Message, User, TestSessionData, StudySessionData, GameSession } from '../types';
import type { NoteImportProgress } from '../services/notes';
import { isEphemeralAppMode, isRoutableAppMode } from '../utils/appRoutes';
import { navigateForAppMode } from '../utils/appNavigation';

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
    addInvestment: boolean;
    setBudget: boolean;
    setMonthlyPlan: boolean;
    savingsGoal: boolean;
    wallet: boolean;
    financialToolkit: boolean;
    expenseSplit: boolean;
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
  selectedMarketplaceOrderId: string | null;
  setSelectedMarketplaceOrderId: (id: string | null) => void;
  editingMarketplaceListing: any | null;
  setEditingMarketplaceListing: (listing: any) => void;
  selectedSellerId: string | null;
  setSelectedSellerId: (id: string | null) => void;
  
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
  addInvestment: false,
  setBudget: false,
  setMonthlyPlan: false,
  savingsGoal: false,
  wallet: false,
  financialToolkit: false,
  expenseSplit: false,
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
      toggleSidebar: () => set((state) => ({ isSidebarExpanded: !state.isSidebarExpanded })),

      isChatsSectionExpanded: true,
      setChatsSectionExpanded: (expanded) => set({ isChatsSectionExpanded: expanded }),
      toggleChatsSection: () =>
        set((state) => ({ isChatsSectionExpanded: !state.isChatsSectionExpanded })),
      
      // Modals
      modals: { ...initialModals },
      openModal: (modal) => set((state) => ({ 
        modals: { ...state.modals, [modal]: true } 
      })),
      closeModal: (modal) => set((state) => ({ 
        modals: { ...state.modals, [modal]: false } 
      })),
      closeAllModals: () => set({ modals: { ...initialModals } }),
      
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
      selectedMarketplaceOrderId: null,
      setSelectedMarketplaceOrderId: (id) => set({ selectedMarketplaceOrderId: id }),
      editingMarketplaceListing: null,
      setEditingMarketplaceListing: (listing) => set({ editingMarketplaceListing: listing }),
      selectedSellerId: null,
      setSelectedSellerId: (id) => set({ selectedSellerId: id }),
      
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
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        isSidebarExpanded: state.isSidebarExpanded,
        isChatsSectionExpanded: state.isChatsSectionExpanded,
        lowDataMode: state.lowDataMode,
        libraryTab: state.libraryTab,
      }),
    }
  )
);

// Listen for online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useUIStore.getState().setIsOnline(true));
  window.addEventListener('offline', () => useUIStore.getState().setIsOnline(false));
}

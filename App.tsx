import React, { useEffect } from 'react';
import { AppMode, DirectMessage, MessageType } from './types';
import { useUIStore } from './stores/uiStore';
import { useAuthStore } from './stores/authStore';
import { useGroupStore } from './stores/groupStore';
import { useFlashcardStore } from './stores/flashcardStore';
import { useTestStore } from './stores/testStore';
import { useBudgetStore } from './stores/budgetStore';
import { initialUserStats } from './utils/helpers';
import { getBreadcrumbs } from './utils/breadcrumbs';
import { fetchNotifications, fetchDecks, getStudySession } from './services/supabase';
import ChatWindow from './components/ChatWindow';
import QuestionModal from './components/QuestionModal';
import CreateGroupModal from './components/CreateGroupModal';
import GroupInfoModal from './components/GroupInfoModal';
import { TestConfigModal } from './components/TestConfigModal';
import { TestTakingScreen } from './components/TestTakingScreen';
import TestReviewScreen from './components/TestReviewScreen';
import DashboardScreen from './components/DashboardScreen';
import OfflineModeScreen from './components/OfflineModeScreen';
import AuthScreen from './components/AuthScreen';
import SettingsModal from './components/SettingsModal';
import { GameScreen } from './components/GameScreen';
import GameResultScreen from './components/GameResultScreen';
import DuplicateQuestionModal from './components/DuplicateQuestionModal';
import FlashcardsScreen from './components/FlashcardsScreen';
import FlashcardReviewScreen from './components/FlashcardReviewScreen';
import CramSessionScreen from './components/CramSessionScreen';
import CreateDeckModal from './components/CreateDeckModal';
import CreateFlashcardModal from './components/CreateFlashcardModal';
import NewDirectMessageModal from './components/NewDirectMessageModal';
import DeckDetailScreen from './components/DeckDetailScreen';
import AddMembersModal from './components/AddMembersModal';
import UsernameRequiredModal from './components/UsernameRequiredModal';
import NotificationModal from './components/NotificationModal';
import CreateGroupScreen from './components/CreateGroupScreen';
import BudgetTrackerScreen from './components/BudgetTrackerScreen';
import AddExpenseModal from './components/AddExpenseModal';
import AddIncomeModal from './components/AddIncomeModal';
import SetBudgetModal from './components/SetBudgetModal';
import SetMonthlyPlanModal from './components/SetMonthlyPlanModal';
import SavingsGoalModal from './components/InvestModal';
import WalletModal from './components/WalletModal';
import ExpenseSplitModal from './components/ExpenseSplitModal';
import SimulationControls from './components/SimulationControls';
import TestAnalysisModal from './components/TestAnalysisModal';
import MarketplaceScreen from './components/MarketplaceScreen';
import CreateMarketplaceListingModal from './components/CreateMarketplaceListingModal';
import MarketplaceListingDetailScreen from './components/MarketplaceListingDetailScreen';
import MyListingsScreen from './components/MyListingsScreen';
import EditMarketplaceListingModal from './components/EditMarketplaceListingModal';
import MarketplaceInquiriesScreen from './components/MarketplaceInquiriesScreen';
import SellerProfileScreen from './components/SellerProfileScreen';
import AppShell from './components/layout/AppShell';
import Breadcrumb from './components/layout/Breadcrumb';
import { useAuthHandlers } from './hooks/useAuthHandlers';
import { useGroupHandlers } from './hooks/useGroupHandlers';
import { useTestHandlers } from './hooks/useTestHandlers';
import { useGameHandlers } from './hooks/useGameHandlers';
import { useFlashcardHandlers } from './hooks/useFlashcardHandlers';
import { useBudgetHandlers } from './hooks/useBudgetHandlers';
import { useOfflineHandlers } from './hooks/useOfflineHandlers';
import { useAppEffects } from './hooks/useAppEffects';
import { useInviteLink } from './hooks/useInviteLink';
import { useAIHandlers } from './hooks/useAIHandlers';
import AIGenerateQuestionsModal from './components/AIGenerateQuestionsModal';

export const App: React.FC = () => {
    const { currentUser, setCurrentUser, isAuthLoading } = useAuthStore();
    const { groups, messages, dmThreads, directMessages, userVotes, notifications, setNotifications } = useGroupStore();
    const { testResults, offlineBundles, pendingSyncResults, userQuestionStats,
            activeTestSession, activeStudySession, activeGameSession } = useTestStore();
    const { decks, flashcards, dueCardsCount } = useFlashcardStore();
    const { transactions, budget } = useBudgetStore();

    // ensure offline deck IDs and any cached decks/flashcards are loaded on web
    useEffect(() => {
        const store = useFlashcardStore.getState();
        store.loadOfflineFromStorage();
        store.loadFromStorage?.();
    }, []);

    const {
        appMode, setAppMode,
        isSidebarExpanded, toggleSidebar,
        theme,
        modals, openModal, closeModal,
        activeTestConfigMode,
        subgroupParentId,
        selectedDeck, setSelectedDeck,
        editingDeck, editingFlashcard, flashcardInitialDeckId,
        activeReviewSession, setActiveReviewSession,
        activeCramSession,
        activeTestResult, setActiveTestResult,
        analyzingResult, setAnalyzingResult,
        challengeOpponent,
        setActiveGameSession,
        selectedChat, setSelectedChat,
        marketplaceListingCategory, setMarketplaceListingCategory,
        selectedMarketplaceListingId, setSelectedMarketplaceListingId,
        editingMarketplaceListing, setEditingMarketplaceListing,
        selectedSellerId, setSelectedSellerId,
        isOnline
    } = useUIStore();
    const {
        users, dataLoaded, setDataLoaded,
        toggleTheme, handleLogin, handleLogout, handleRegister,
        handleUpdateSettings, handleUpdateProfile, handleUpdateCurrentUserAvatar,
        handleUpdatePassword, handleDeleteAccount,
        handleSavePreset, handleDeletePreset
    } = useAuthHandlers();
    const {
        handleSelectChat, handleInitiateDm, handleSendDm, handleDeleteDmThread,
        handleArchiveDmThread, handleUnarchiveDmThread, onSendMessage,
        handleCreateSubGroup, handleCreateGroup, handleCloseCreateGroupModal,
        handleQuestionSubmit, onVoteQuestion, handleUpvoteDuplicateAndClose,
        onFlagAsSimilar, onOpenCreateSubGroupModal,
        handleUpdateGroupDetails, handleUpdateGroupAvatar,
        handleInviteMembers, handleRevokeInvitation, handleRevokePhoneInvitation,
        handlePromoteToAdmin, handleDemoteAdmin, handleDeleteGroup,
        handleToggleArchiveGroup, handleApproveMember, handleRejectMember,
        onOpenQuestionModal, onOpenGroupInfoModal,
        onOpenTestConfigModal, onOpenStudyConfigModal,
        handleChallengeUser, addNotification,
        handleMarkNotificationAsRead, handleMarkAllNotificationsAsRead
    } = useGroupHandlers({ users });
    const {
        handleTestSubmit, handleUpdateAnswer, handleChangeQuestion,
        handleToggleBookmark, handleSubmitTest, handleEndStudySession,
        handleCancelActiveSession, handlePauseSession, handleResumeSession,
        handleRetakeTest, handlePracticeFailedQuestions
    } = useTestHandlers({ addNotification });
    const { handleStartGame, handleGameAnswer, handleEndGame, handleRematch } = useGameHandlers({ addNotification, handleChallengeUser });
    const {
        isGeneratingFlashcards,
        handleSelectDeck, handleOpenCreateDeckModal, handleOpenEditDeckModal,
        handleCreateOrUpdateDeck, handleDeleteDeck,
        handleOpenCreateFlashcardModal, handleOpenEditFlashcardModal,
        handleCreateOrUpdateFlashcard, handleDeleteFlashcard,
        handleGenerateFlashcards,
        handleStartReview, handleStartCram, handleCramAnswer, handleCramIncorrect, handleEndCramSession,
        handleUpdateSrsData, handleResetDeckStatistics,
        handleExportDeck, handleImportDeck,
        handleLoadMoreFlashcards
    } = useFlashcardHandlers();

    const [deepLinkSessionId, setDeepLinkSessionId] = React.useState<string | null>(null);
    const [pendingDeepLinkJoinSessionId, setPendingDeepLinkJoinSessionId] = React.useState<string | null>(null);
    const { handleNavigateToBudgetTracker, handleSetBudget, handleAddTransaction, handleDeleteTransaction } = useBudgetHandlers();
    const { handleDownloadForOffline, handleStartOfflineSession, handleDeleteBundle, handleSyncResults } = useOfflineHandlers({ addNotification });
    useAppEffects({ dataLoaded, setDataLoaded });
    useInviteLink(currentUser?.id);
    const { isAILoading, handleAIGenerateQuestions, handleAIExplainAnswer, handleAIStudyRecommendations, handleAIAskTutor, handleAIEnhanceFlashcard } = useAIHandlers();
    const duplicateInfo = useUIStore(s => s.duplicateInfo);
    const setDuplicateInfo = useUIStore(s => s.setDuplicateInfo);
    const messagesForChat = !selectedChat ? [] : selectedChat.chatType === 'group'
        ? messages[selectedChat.id] || []
        : (directMessages[selectedChat.id] || []).map((dm: DirectMessage): any => {
            const dmThread = selectedChat as any;
            const participantInfo = dmThread?.participants?.[dm.senderId];
            const sender = users.find(u => u.id === dm.senderId)
                || groups.flatMap(g => g.members || []).find(m => m.id === dm.senderId)
                || (participantInfo ? { id: dm.senderId, name: participantInfo.name, avatarUrl: participantInfo.avatarUrl, points: 0, badges: [], stats: initialUserStats } : null)
                || { id: dm.senderId, name: 'Unknown User', points: 0, badges: [], stats: initialUserStats };
            return {
                id: dm.id, groupId: dm.threadId, timestamp: dm.timestamp,
                sender, type: MessageType.TEXT, text: dm.text, upvotes: 0, downvotes: 0,
            };
        });
    const findFirstGroup = () => groups.find(g => !g.isArchived && (messages[g.id]?.length ?? 0) > 0) || groups.find(g => !g.isArchived);
    const handleOpenQuickTest = () => { const group = findFirstGroup(); if (!group) { alert('Join or create a group first to start a test.'); return; } handleSelectChat({ ...group, chatType: 'group' }); onOpenTestConfigModal(); };
    const handleOpenQuickStudy = () => { const group = findFirstGroup(); if (!group) { alert('Join or create a group first to start a study session.'); return; } handleSelectChat({ ...group, chatType: 'group' }); onOpenStudyConfigModal(); };
    const handleFlashcardStudy = () => {
        const today = new Date().toISOString().split('T')[0];
        const best = decks.map(d => ({ deck: d, due: flashcards.filter(fc => fc.deckId === d.id && fc.srsData?.nextReviewDate && fc.srsData.nextReviewDate.split('T')[0] <= today).length })).sort((a, b) => b.due - a.due)[0];
        if (best?.deck) { handleSelectDeck(best.deck); handleStartReview(best.deck); }
        else alert('No flashcard decks available. Create a deck first.');
    };
    // Redirect invalid mode/state combinations (avoids setState during render)
    useEffect(() => {
        // guard against invalid combinations but log to help debug race conditions
        console.log('[App] mode check', { appMode, hasSession: !!activeTestSession });
        if (appMode === AppMode.TEST_ACTIVE && !activeTestSession) {
            console.warn('[App] resetting mode to CHAT because TEST_ACTIVE without activeTestSession');
            setAppMode(AppMode.CHAT);
        }
        else if (appMode === AppMode.STUDY_ACTIVE && !activeStudySession) {
            console.warn('[App] resetting mode to CHAT because STUDY_ACTIVE without activeStudySession');
            setAppMode(AppMode.CHAT);
        }
        else if (appMode === AppMode.GAME_ACTIVE && !activeGameSession) {
            console.warn('[App] resetting mode to CHAT because GAME_ACTIVE without activeGameSession');
            setAppMode(AppMode.CHAT);
        }
        else if (appMode === AppMode.GAME_RESULTS && (!activeGameSession || !activeGameSession.isComplete)) {
            console.warn('[App] resetting mode to CHAT because GAME_RESULTS invalid state');
            setAppMode(AppMode.CHAT);
        }
        else if (appMode === AppMode.TEST_REVIEW && !activeTestResult) {
            console.warn('[App] resetting mode to CHAT because TEST_REVIEW without activeTestResult');
            setAppMode(AppMode.CHAT);
        }
    }, [appMode, activeTestSession, activeStudySession, activeGameSession, activeTestResult, setAppMode]);

    // Re-fetch notifications from DB when the notification modal opens
    useEffect(() => {
        if (modals.notification && currentUser) {
            fetchNotifications(currentUser.id).then(fetched => {
                if (fetched && fetched.length > 0) {
                    setNotifications(fetched);
                }
            }).catch(() => { /* handled in service layer */ });
        }
    }, [modals.notification, currentUser, setNotifications]);
    // Deep link support for study sessions (e.g. ?studySession=<id>)
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('studySession');
        if (!sessionId) return;

        // Clean up URL so it doesn't re-trigger
        params.delete('studySession');
        const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
        window.history.replaceState({}, '', newUrl);

        setDeepLinkSessionId(sessionId);
    }, []);

    useEffect(() => {
        if (!deepLinkSessionId) return;
        if (!currentUser) return;

        (async () => {
            try {
                const session = await getStudySession(deepLinkSessionId);
                if (!session) {
                    setDeepLinkSessionId(null);
                    return;
                }

                // Ensure we have the deck loaded, then select it
                const deckId = (session as any).deck_id || (session as any).deckId;
                const found = decks.find(d => d.id === deckId);
                if (!found) {
                    const refreshed = await fetchDecks(currentUser.id, { includeShared: true });
                    const newDeck = refreshed.find(d => d.id === deckId);
                    if (newDeck) {
                        handleSelectDeck(newDeck);
                        setPendingDeepLinkJoinSessionId(deepLinkSessionId);
                        setDeepLinkSessionId(null);
                    }
                } else {
                    handleSelectDeck(found);
                    setPendingDeepLinkJoinSessionId(deepLinkSessionId);
                    setDeepLinkSessionId(null);
                }
            } catch (err) {
                console.warn('Failed to apply deep link session', err);
                setDeepLinkSessionId(null);
            }
        })();
    }, [deepLinkSessionId, currentUser, decks, handleSelectDeck]);
    if (isAuthLoading) return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
        </div>
    );
    if (!currentUser) return <AuthScreen onAuthSuccess={setCurrentUser} />;

    const mainContent = () => {
        switch (appMode) {
            case AppMode.CREATE_GROUP:
                return <CreateGroupScreen currentUser={currentUser} allUsers={users} onCreateGroup={handleCreateGroup} onBack={() => setAppMode(AppMode.CHAT)} />;
            case AppMode.CHAT:
                return <ChatWindow chat={selectedChat} messages={messagesForChat} currentUser={currentUser} userVotes={userVotes}
                    onSendMessage={onSendMessage} onOpenQuestionModal={onOpenQuestionModal}
                    onOpenGroupInfoModal={() => selectedChat && selectedChat.chatType === 'group' && onOpenGroupInfoModal()}
                    onOpenTestConfigModal={onOpenTestConfigModal} onOpenStudyConfigModal={onOpenStudyConfigModal}
                    onVoteQuestion={onVoteQuestion} onFlagAsSimilar={onFlagAsSimilar}
                    onOpenCreateSubGroupModal={onOpenCreateSubGroupModal}
                    groups={groups} onToggleArchiveGroup={handleToggleArchiveGroup}
                    onOpenAIGenerateModal={() => openModal('aiGenerateQuestions')}
                    onAIQuery={handleAIAskTutor}
                    dmThreads={dmThreads}
                    onSelectChat={handleSelectChat}
                    onBack={() => setSelectedChat(null)}
                    onCreateGroup={() => setAppMode(AppMode.CREATE_GROUP)}
                    onOpenNewDmModal={() => openModal('newDm')}
                    onDeleteDmThread={handleDeleteDmThread}
                    onArchiveDmThread={handleArchiveDmThread}
                    onUnarchiveDmThread={handleUnarchiveDmThread} />;
            case AppMode.TEST_ACTIVE:
                if (!activeTestSession) return null;
                return <TestTakingScreen mode="test" session={activeTestSession}
                    onUpdateAnswer={handleUpdateAnswer} onChangeQuestion={handleChangeQuestion}
                    onToggleBookmark={handleToggleBookmark} onSubmitTest={handleSubmitTest}
                    onSubmitOfflineTest={handleSubmitTest} onPauseSession={handlePauseSession}
                    onCancelSession={handleCancelActiveSession} />;
            case AppMode.STUDY_ACTIVE:
                if (!activeStudySession) return null;
                return <TestTakingScreen mode="study" session={activeStudySession}
                    onUpdateAnswer={handleUpdateAnswer} onChangeQuestion={handleChangeQuestion}
                    onToggleBookmark={handleToggleBookmark} onEndSession={handleEndStudySession}
                    onPauseSession={handlePauseSession} onCancelSession={handleCancelActiveSession} />;
            case AppMode.GAME_ACTIVE:
                if (!activeGameSession) return null;
                return <GameScreen session={activeGameSession} onUpdateAnswer={handleGameAnswer} />;
            case AppMode.GAME_RESULTS:
                if (!activeGameSession || !activeGameSession.isComplete) return null;
                return <GameResultScreen session={activeGameSession} currentUser={currentUser} onRematch={handleRematch}
                    onExit={() => { setActiveGameSession(null); setAppMode(AppMode.CHAT); }} />;
            case AppMode.TEST_REVIEW:
                if (!activeTestResult) return null;
                return <TestReviewScreen results={activeTestResult} allTestResults={testResults} groups={groups}
                    onExit={() => { setActiveTestResult(null); setAppMode(AppMode.CHAT); }}
                    onNavigateToDashboard={() => { setActiveTestResult(null); setAppMode(AppMode.DASHBOARD); }}
                    onRetakeTest={handleRetakeTest} onPracticeFailedQuestions={handlePracticeFailedQuestions}
                    onExplainAnswer={handleAIExplainAnswer} />;
            case AppMode.DASHBOARD:
                return <DashboardScreen theme={theme} testResults={testResults} groups={groups} currentUser={currentUser}
                    onNavigateToChat={() => setAppMode(AppMode.CHAT)} allMessages={messages}
                    userQuestionStats={userQuestionStats} onViewAnalysis={setAnalyzingResult}
                    onNavigateToFlashcards={() => setAppMode(AppMode.FLASHCARDS)}
                    onNavigateToMarketplace={() => setAppMode(AppMode.MARKETPLACE)}
                    onNavigateToCreateGroup={() => setAppMode(AppMode.CREATE_GROUP)}
                    dueCardsCount={dueCardsCount} flashcards={flashcards} pendingSyncCount={pendingSyncResults.length}
                    unreadNotificationCount={notifications.filter(n => !n.read).length}
                    onOpenQuickTest={handleOpenQuickTest} onOpenQuickStudy={handleOpenQuickStudy}
                    onGetStudyRecommendations={handleAIStudyRecommendations} />;
            case AppMode.FLASHCARDS:
                return <FlashcardsScreen decks={decks} flashcards={flashcards}
                    onOpenCreateDeck={handleOpenCreateDeckModal} onOpenCreateFlashcard={() => handleOpenCreateFlashcardModal()}
                    onSelectDeck={handleSelectDeck} onExportDeck={handleExportDeck} onImportDeck={handleImportDeck}
                    onStartStudy={handleFlashcardStudy} />;
            case AppMode.DECK_DETAIL:
                if (!selectedDeck) { setAppMode(AppMode.FLASHCARDS); return null; }
                return <DeckDetailScreen deck={selectedDeck} flashcards={flashcards}
                    onBack={() => { setAppMode(AppMode.FLASHCARDS); setSelectedDeck(null); }}
                    onStartReview={handleStartReview} onStartCram={handleStartCram}
                    onOpenCreateFlashcard={handleOpenCreateFlashcardModal} onOpenEditFlashcard={handleOpenEditFlashcardModal}
                    onDeleteFlashcard={handleDeleteFlashcard} onOpenEditDeck={handleOpenEditDeckModal}
                    onDeleteDeck={handleDeleteDeck} onGenerateFlashcards={handleGenerateFlashcards}
                    isGenerating={isGeneratingFlashcards} onResetStatistics={handleResetDeckStatistics}
                    onLoadMoreCards={handleLoadMoreFlashcards}
                    onEnhanceFlashcard={handleAIEnhanceFlashcard}
                    autoJoinSessionId={pendingDeepLinkJoinSessionId}
                    onDeepLinkHandled={() => setPendingDeepLinkJoinSessionId(null)}
                />;
            case AppMode.FLASHCARD_REVIEW:
                if (!activeReviewSession) { setAppMode(AppMode.FLASHCARDS); return null; }
                return <FlashcardReviewScreen session={activeReviewSession} onUpdateSrs={handleUpdateSrsData}
                    onEndSession={() => { setAppMode(AppMode.DECK_DETAIL); setActiveReviewSession(null); }} />;
            case AppMode.FLASHCARD_CRAM:
                if (!activeCramSession) { setAppMode(AppMode.FLASHCARDS); return null; }
                return <CramSessionScreen session={activeCramSession} onAnswer={handleCramAnswer}
                    onEndSession={handleEndCramSession} onCramIncorrect={handleCramIncorrect} />;
            case AppMode.OFFLINE_MODE:
                return <OfflineModeScreen offlineBundles={offlineBundles} pendingSyncResultsCount={pendingSyncResults.length}
                    onStartOfflineSession={handleStartOfflineSession} onDeleteBundle={handleDeleteBundle}
                    onSyncPendingResults={handleSyncResults} isOnline={isOnline} />;
            case AppMode.BUDGET_TRACKER:
                return <BudgetTrackerScreen currentUser={currentUser}
                    transactions={transactions.filter(t => t.userId === currentUser.id)}
                    budget={budget?.userId === currentUser.id ? budget : null}
                    onOpenAddExpense={() => openModal('addExpense')} onOpenAddIncome={() => openModal('addIncome')}
                    onOpenSetBudget={() => openModal('setBudget')} onDeleteTransaction={handleDeleteTransaction}
                    onToggleSidebar={toggleSidebar}
                    onOpenSetMonthlyPlan={() => openModal('setMonthlyPlan')}
                    onOpenSavingsGoal={() => openModal('savingsGoal')}
                    onOpenWallet={() => openModal('wallet')}
                    onOpenExpenseSplit={() => openModal('expenseSplit')}
                    onOpenFinancialToolkit={() => openModal('financialToolkit')} />;
            case AppMode.MARKETPLACE:
                return <MarketplaceScreen onNavigate={(screen, params) => {
                    if (screen === 'CreateMarketplaceListing') {
                        setMarketplaceListingCategory(params?.category || 'academic');
                        openModal('createMarketplaceListing');
                    } else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'MyListings') {
                        setAppMode(AppMode.MY_LISTINGS);
                    } else if (screen === 'MarketplaceInquiries') {
                        setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                    }
                }} />;
            case AppMode.MARKETPLACE_LISTING_DETAIL:
                if (!selectedMarketplaceListingId) { setAppMode(AppMode.MARKETPLACE); return null; }
                return <MarketplaceListingDetailScreen listingId={selectedMarketplaceListingId}
                    onBack={() => setAppMode(AppMode.MARKETPLACE)}
                    onNavigate={(screen, params) => {
                        if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
                        else if (screen === 'SellerProfile' && params?.userId) {
                            setSelectedSellerId(params.userId);
                            setAppMode(AppMode.SELLER_PROFILE);
                        } else if (screen === 'MarketplaceTransaction') {
                            alert('Purchase initiated! You can coordinate with the seller via direct message.');
                            setAppMode(AppMode.MARKETPLACE);
                        } else if (screen === 'MyListings') {
                            setAppMode(AppMode.MY_LISTINGS);
                        } else if (screen === 'EditMarketplaceListing' && params?.listing) {
                            setEditingMarketplaceListing(params.listing);
                            openModal('editMarketplaceListing');
                        }
                    }} />;
            case AppMode.MY_LISTINGS:
                return <MyListingsScreen onNavigate={(screen, params) => {
                    if (screen === 'CreateMarketplaceListing') {
                        setMarketplaceListingCategory(params?.category || 'academic');
                        openModal('createMarketplaceListing');
                    } else if (screen === 'EditMarketplaceListing') {
                        setEditingMarketplaceListing(params.listing);
                        openModal('editMarketplaceListing');
                    } else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'MarketplaceInquiries') {
                        setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                    }
                }} onBack={() => setAppMode(AppMode.MARKETPLACE)} />;
            case AppMode.MARKETPLACE_INQUIRIES:
                return <MarketplaceInquiriesScreen onNavigate={(screen, params) => {
                    if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
                    else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    }
                }} onBack={() => setAppMode(AppMode.MARKETPLACE)} userId={currentUser.id} />;
            case AppMode.SELLER_PROFILE:
                if (!selectedSellerId) { setAppMode(AppMode.MARKETPLACE); return null; }
                return <SellerProfileScreen userId={selectedSellerId}
                    onBack={() => { setSelectedSellerId(null); setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL); }}
                    onNavigate={(screen, params) => {
                        if (screen === 'MarketplaceListingDetail') {
                            setSelectedMarketplaceListingId(params.listingId);
                            setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                        } else if (screen === 'DirectMessages' && params?.userId) handleInitiateDm(params.userId);
                    }} />;
            case AppMode.CREATE_MARKETPLACE_LISTING:
                if (!modals.createMarketplaceListing) openModal('createMarketplaceListing');
                return <MarketplaceScreen onNavigate={(screen, params) => {
                    if (screen === 'CreateMarketplaceListing') {
                        setMarketplaceListingCategory(params?.category || 'academic');
                        openModal('createMarketplaceListing');
                    } else if (screen === 'MarketplaceListingDetail') {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'MyListings') setAppMode(AppMode.MY_LISTINGS);
                    else if (screen === 'MarketplaceInquiries') setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                }} />;
            default:
                return <div className="p-4">Mode not implemented yet.</div>;
        }
    };
    const sidebarProps = {
        currentUser, groups, dmThreads,
        selectedChatId: selectedChat?.id,
        onSelectChat: handleSelectChat,
        onNavigateToCreateGroup: () => setAppMode(AppMode.CREATE_GROUP),
        onNavigateToDashboard: () => setAppMode(AppMode.DASHBOARD),
        onNavigateToOfflineMode: () => setAppMode(AppMode.OFFLINE_MODE),
        onNavigateToFlashcards: () => { setAppMode(AppMode.FLASHCARDS); setSelectedDeck(null); },
        onNavigateToBudgetTracker: handleNavigateToBudgetTracker,
        onNavigateToMarketplace: () => setAppMode(AppMode.MARKETPLACE),
        pendingSyncCount: pendingSyncResults.length, isOnline,
        onSyncPendingResults: handleSyncResults,
        onUpdateCurrentUserAvatar: handleUpdateCurrentUserAvatar,
        onOpenSettingsModal: () => openModal('settings'),
        currentAppMode: appMode, onLogout: handleLogout,
        isExpanded: isSidebarExpanded, onToggleExpand: toggleSidebar,
        onOpenNewDmModal: () => openModal('newDm'),
        unreadNotificationCount: notifications.filter(n => !n.read).length,
        onOpenNotificationModal: () => openModal('notification'),
        activeTestSession, activeStudySession,
        onResumeSession: handleResumeSession, onCancelSession: handleCancelActiveSession,
        theme, onToggleTheme: toggleTheme, dueCardsCount,
    };
    return (
        <AppShell sidebarProps={sidebarProps} dueCardsCount={dueCardsCount}
            unreadChatCount={groups.reduce((sum, g) => sum + (g.unreadCount || 0), 0)}>
            <Breadcrumb items={getBreadcrumbs({ appMode, selectedDeck, setAppMode, setSelectedDeck, setActiveTestResult })} />
            {mainContent()}
            <CreateGroupModal isOpen={modals.createGroup} onClose={handleCloseCreateGroupModal}
                onSubmit={handleCreateSubGroup} parentId={subgroupParentId} allGroups={groups} />
            <QuestionModal isOpen={modals.question} onClose={() => closeModal('question')}
                onSubmit={handleQuestionSubmit} groupName={selectedChat?.chatType === 'group' ? selectedChat.name : ''} />
            {selectedChat?.chatType === 'group' && <GroupInfoModal
                isOpen={modals.groupInfo} onClose={() => closeModal('groupInfo')}
                group={selectedChat} currentUser={currentUser}
                onUpdateDetails={handleUpdateGroupDetails} onUpdateGroupAvatar={handleUpdateGroupAvatar}
                onPromoteToAdmin={handlePromoteToAdmin} onDemoteAdmin={handleDemoteAdmin}
                onDeleteGroup={handleDeleteGroup} onToggleArchiveGroup={handleToggleArchiveGroup}
                onChallengeUser={handleChallengeUser} onApproveMember={handleApproveMember}
                onRejectMember={handleRejectMember} onOpenAddMembersModal={() => openModal('addMembers')}
                onRevokeInvitation={handleRevokeInvitation} onRevokePhoneInvitation={handleRevokePhoneInvitation}
                onInitiateDm={handleInitiateDm} />}
            {selectedChat?.chatType === 'group' && <TestConfigModal
                isOpen={modals.testConfig} onClose={() => closeModal('testConfig')}
                group={selectedChat} allGroups={groups} mode={activeTestConfigMode}
                allMessages={messages} userQuestionStats={userQuestionStats}
                testPresets={currentUser.testPresets || []} challengeOpponent={challengeOpponent}
                onSavePreset={handleSavePreset} onDeletePreset={handleDeletePreset}
                onSubmit={(config, mode, useSpacedRepetition, selectedSubgroupIDs) => {
                    if (mode === 'game') { handleStartGame(config, useSpacedRepetition); }
                    else { handleTestSubmit(config, mode, useSpacedRepetition, selectedSubgroupIDs); }
                }} onDownloadForOffline={handleDownloadForOffline} />}
            <NewDirectMessageModal isOpen={modals.newDm} onClose={() => closeModal('newDm')}
                currentUser={currentUser} allUsers={users}
                onStartDm={(userId) => { handleInitiateDm(userId); closeModal('newDm'); }} />
            <SettingsModal isOpen={modals.settings} onClose={() => closeModal('settings')}
                currentUser={currentUser} settings={currentUser.settings}
                onUpdateSettings={handleUpdateSettings} onUpdateProfile={handleUpdateProfile}
                onUpdateAvatar={handleUpdateCurrentUserAvatar}
                onUpdatePassword={handleUpdatePassword} onLogout={handleLogout}
                onDeleteAccount={handleDeleteAccount} />
            <CreateDeckModal isOpen={modals.createDeck} onClose={() => closeModal('createDeck')}
                onSubmit={handleCreateOrUpdateDeck} editingDeck={editingDeck} />
            <CreateFlashcardModal isOpen={modals.createFlashcard} onClose={() => closeModal('createFlashcard')}
                onSubmit={handleCreateOrUpdateFlashcard} decks={decks}
                initialDeckId={flashcardInitialDeckId} editingFlashcard={editingFlashcard}
                onEnhanceFlashcard={handleAIEnhanceFlashcard} />
            {selectedChat?.chatType === 'group' && <AddMembersModal
                isOpen={modals.addMembers} onClose={() => closeModal('addMembers')}
                onSubmit={(userIds) => handleInviteMembers(selectedChat.id, userIds)}
                group={selectedChat} currentUser={currentUser} />}
            <NotificationModal isOpen={modals.notification} onClose={() => closeModal('notification')}
                notifications={notifications} onMarkAsRead={handleMarkNotificationAsRead}
                onMarkAllAsRead={handleMarkAllNotificationsAsRead}
                onNavigate={(screen, params) => {
                    if (screen === 'MarketplaceInquiries') {
                        setAppMode(AppMode.MARKETPLACE_INQUIRIES);
                    } else if (screen === 'MarketplaceListingDetail' && params?.listingId) {
                        setSelectedMarketplaceListingId(params.listingId);
                        setAppMode(AppMode.MARKETPLACE_LISTING_DETAIL);
                    } else if (screen === 'Marketplace') {
                        setAppMode(AppMode.MARKETPLACE);
                    }
                }} />
            <AddExpenseModal isOpen={modals.addExpense} onClose={() => closeModal('addExpense')} onSubmit={handleAddTransaction} />
            <AddIncomeModal isOpen={modals.addIncome} onClose={() => closeModal('addIncome')} onSubmit={handleAddTransaction} />
            <SetBudgetModal isOpen={modals.setBudget} onClose={() => closeModal('setBudget')} onSubmit={handleSetBudget} currentBudget={budget} />
            <SetMonthlyPlanModal isOpen={modals.setMonthlyPlan} onClose={() => closeModal('setMonthlyPlan')} currentBudget={budget} onSave={(categoryBudgets) => { if (budget) { handleSetBudget({ ...budget, categoryBudgets }); } }} />
            <SavingsGoalModal isOpen={modals.savingsGoal} onClose={() => closeModal('savingsGoal')} currentUserId={currentUser?.id || ''} />
            <WalletModal isOpen={modals.wallet} onClose={() => closeModal('wallet')} />
            <SimulationControls isOpen={modals.financialToolkit} onClose={() => closeModal('financialToolkit')} />
            <ExpenseSplitModal isOpen={modals.expenseSplit} onClose={() => closeModal('expenseSplit')} currentUserId={currentUser?.id || ''} currentUserName={currentUser?.name || ''} />
            {analyzingResult && <TestAnalysisModal isOpen={!!analyzingResult} onClose={() => setAnalyzingResult(null)} results={analyzingResult} />}
            {duplicateInfo && <DuplicateQuestionModal isOpen={modals.duplicateQuestion}
                onClose={() => { closeModal('duplicateQuestion'); setDuplicateInfo(null); }}
                duplicateInfo={duplicateInfo} onUpvoteAndClose={handleUpvoteDuplicateAndClose} />}
            <CreateMarketplaceListingModal isOpen={modals.createMarketplaceListing}
                onClose={() => closeModal('createMarketplaceListing')} category={marketplaceListingCategory}
                onSuccess={() => closeModal('createMarketplaceListing')} />
            {editingMarketplaceListing && <EditMarketplaceListingModal
                isOpen={modals.editMarketplaceListing}
                onClose={() => { closeModal('editMarketplaceListing'); setEditingMarketplaceListing(null); }}
                listing={editingMarketplaceListing}
                onSuccess={() => { closeModal('editMarketplaceListing'); setEditingMarketplaceListing(null); }} />}
            <AIGenerateQuestionsModal isOpen={modals.aiGenerateQuestions}
                onClose={() => closeModal('aiGenerateQuestions')}
                onSubmit={(notes, options) => handleAIGenerateQuestions(notes, options)}
                isGenerating={isAILoading} />
            {currentUser && <UsernameRequiredModal isOpen={modals.usernameRequired}
                onClose={() => closeModal('usernameRequired')} currentUser={currentUser}
                onSuccess={(username, firstName, lastName) => {
                    setCurrentUser({
                        ...currentUser, username, firstName, lastName,
                        name: firstName && lastName ? `${firstName} ${lastName}` : currentUser.name,
                    });
                    closeModal('usernameRequired');
                }} />}
        </AppShell>
    );
};

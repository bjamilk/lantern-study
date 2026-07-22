import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { useGroupStore, type Message, type GroupMember } from '../../stores/groupStore';
import { useTestStore, type TestMode } from '../../stores/testStore';
import TestConfigModal, { type TestConfigOptions, type TestConfigAvailableFilter } from '../../components/TestConfigModal';
import ChallengeModal from '../../components/ChallengeModal';
import GroupInfoModal from '../../components/GroupInfoModal';
import QuestionModal from '../../components/QuestionModal';
import AddMembersModal from '../../components/AddMembersModal';
import AIGenerateQuestionsModal from '../../components/AIGenerateQuestionsModal';
import {
  ChatComposer,
  GroupChatHeader,
  MessageBubble,
  formatChatDateLabel,
  isDifferentChatDay,
  type GroupChatHeaderAction,
} from '../../components/chat';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useTheme } from '../../theme';
import { selectGroupQuestions, extractTagsFromQuestions, countMatchingQuestions } from '../../utils/questionHelpers';
import { summarizeGroupChat } from '../../services/ai';
import * as api from '../../services/api';

type NavigationProp = {
  goBack: () => void;
  canGoBack?: () => boolean;
  getParent: () => { navigate: (tab: string, params?: Record<string, unknown>) => void } | undefined;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  setParams: (params: Partial<{ groupId: string; groupName?: string; openAddMembers?: boolean }>) => void;
};

interface Props {
  navigation: NavigationProp;
  route: { params: { groupId: string; groupName?: string; openAddMembers?: boolean } };
}

function mapModalQuestionToPayload(question: any, senderId: string, senderName: string) {
  const typeMap: Record<string, string> = {
    'mcq-single': 'MULTIPLE_CHOICE_SINGLE',
    'mcq-multiple': 'MULTIPLE_CHOICE_MULTIPLE',
    'true-false': 'TRUE_FALSE',
    'fill-blank': 'FILL_IN_THE_BLANK',
    matching: 'MATCHING',
    'diagram-labelling': 'DIAGRAM_LABELING',
  };

  const correctIds = (question.options || [])
    .filter((o: any) => o.isCorrect)
    .map((o: any) => o.id);

  return {
    senderId,
    senderName,
    stem: question.stem,
    explanation: question.explanation,
    questionType: typeMap[question.type] || 'MULTIPLE_CHOICE_SINGLE',
    options: (question.options || []).map((o: any) => ({ id: o.id, text: o.text })),
    correctAnswerIds: correctIds,
    tags: question.tags || [],
    acceptableAnswers: question.correctAnswer ? [question.correctAnswer] : undefined,
    matchingPromptItems: question.matchingPairs?.map((p: any) => ({ id: p.id, text: p.left })),
    matchingAnswerItems: question.matchingPairs?.map((p: any) => ({ id: `${p.id}-ans`, text: p.right })),
    correctMatches: question.matchingPairs?.map((p: any) => ({
      promptItemId: p.id,
      answerItemId: `${p.id}-ans`,
    })),
    diagramLabels: question.diagramLabels,
    imageUrl: question.diagramUrl,
  };
}

function mapAIQuestionToPayload(
  q: {
    text: string;
    type: string;
    options?: string[];
    correctAnswer: string;
    explanation?: string;
    topic?: string;
  },
  senderId: string,
  senderName: string
) {
  const normalise = (s: string) => s.replace(/^[A-Da-d][).\s]+\s*/, '').trim().toLowerCase();
  const correctNorm = q.correctAnswer ? normalise(q.correctAnswer) : '';
  const options = (q.options || []).map((text, idx) => ({
    id: `ai-opt-${Date.now()}-${idx}`,
    text,
  }));
  const correctAnswerIds = options
    .filter((o) => {
      if (!q.correctAnswer) return false;
      if (o.text === q.correctAnswer) return true;
      const optNorm = normalise(o.text);
      if (optNorm === correctNorm) return true;
      const letterMatch = q.correctAnswer.trim().match(/^([A-Da-d])$/);
      if (letterMatch) {
        const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
        return options.indexOf(o) === idx;
      }
      return optNorm.includes(correctNorm) || correctNorm.includes(optNorm);
    })
    .map((o) => o.id);

  const questionType =
    q.type === 'multiple_choice'
      ? 'MULTIPLE_CHOICE_SINGLE'
      : q.type === 'true_false'
        ? 'TRUE_FALSE'
        : q.type === 'fill_in_blank'
          ? 'FILL_IN_THE_BLANK'
          : 'OPEN_ENDED';

  return {
    senderId,
    senderName,
    stem: q.text,
    explanation: q.explanation,
    questionType,
    options,
    correctAnswerIds,
    tags: q.topic ? [q.topic] : [],
    acceptableAnswers:
      questionType === 'FILL_IN_THE_BLANK' && q.correctAnswer ? [q.correctAnswer] : undefined,
  };
}

function ChatDateSeparator({ label }: { label: string }) {
  if (!label) return null;
  return (
    <View className="items-center my-3">
      <View className="px-3 py-1 rounded-full bg-lantern-background-secondary/80 dark:bg-lantern-surface-secondary/80">
        <Text className="text-[11px] font-medium text-lantern-text-secondary">{label}</Text>
      </View>
    </View>
  );
}

function NewMessagesDivider() {
  return (
    <View className="flex-row items-center my-3 gap-2">
      <View className="flex-1 h-px bg-lantern-primary/40" />
      <Text className="text-[11px] font-semibold text-lantern-primary">New messages</Text>
      <View className="flex-1 h-px bg-lantern-primary/40" />
    </View>
  );
}

const NEAR_BOTTOM_PX = 120;

export function GroupChatScreen({ navigation, route }: Props) {
  const { groupId, groupName, openAddMembers } = route.params;
  const user = useAuthStore(s => s.user);
  const { colors } = useTheme();
  const { lowDataMode } = useLowDataMode();
  const startQuestionSet = useTestStore(s => s.startQuestionSet);
  const userQuestionStats = useTestStore(s => s.userQuestionStats);
  const testPresets = useTestStore(s => s.testPresets);
  const loadUserQuestionStats = useTestStore(s => s.loadUserQuestionStats);
  const loadTestPresets = useTestStore(s => s.loadTestPresets);
  const saveTestPreset = useTestStore(s => s.saveTestPreset);
  const deleteTestPreset = useTestStore(s => s.deleteTestPreset);
  const {
    messagesCache,
    currentGroup,
    isLoadingMore,
    isLoadingMessages,
    error: groupError,
    userVotes,
    groups,
    selectGroup,
    fetchMessages,
    loadMoreMessages,
    sendMessage,
    markGroupAsRead,
    updateGroupDetails,
    promoteToAdmin,
    demoteAdmin,
    removeMember,
    deleteGroup,
    submitQuestion,
    voteOnMessage,
    flagMessageAsSimilar,
    fetchUserVotesForGroup,
    getSubgroupsWithLevel,
    getMessagesForGroups,
    messagePagination,
  } = useGroupStore();

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showTestConfig, setShowTestConfig] = useState(false);
  const [testMode, setTestMode] = useState<TestMode>('test');
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showAIGenerate, setShowAIGenerate] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [challengeMember, setChallengeMember] = useState<GroupMember | null>(null);
  const [cachedGroupMessages, setCachedGroupMessages] = useState<Message[]>([]);
  const [unreadAnchorAt, setUnreadAnchorAt] = useState<string | null | undefined>(undefined);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const listRef = useRef<FlatList<Message>>(null);
  const isNearBottomRef = useRef(true);
  const initialAnchorDoneRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef(0);
  const suppressLoadOlderRef = useRef(true);

  const displayName = groupName || currentGroup?.name || 'Group chat';
  const messageLimit = lowDataMode ? 30 : 100;
  const hasMoreMessages = messagePagination[groupId]?.hasMore ?? true;
  const { typingUserIds, broadcastTyping } = useTypingIndicator(groupId, user?.id);

  const typingLabel = useMemo(() => {
    if (typingUserIds.length === 0) return null;
    const members = currentGroup?.members || [];
    const names = typingUserIds.map(
      id => members.find(m => m.userId === id)?.name || 'Someone'
    );
    return names.length === 1
      ? `${names[0]} is typing…`
      : `${names.slice(0, 2).join(' and ')} are typing…`;
  }, [typingUserIds, currentGroup?.members]);

  const handleLoadOlderMessages = useCallback(() => {
    if (suppressLoadOlderRef.current) return;
    if (!hasMoreMessages || isLoadingMore) return;
    void loadMoreMessages(groupId);
  }, [groupId, hasMoreMessages, isLoadingMore, loadMoreMessages]);
  const availableSubgroups = useMemo(
    () => getSubgroupsWithLevel(groupId).map(({ group, level }) => ({
      id: group.id,
      name: group.name,
      level,
    })),
    [groupId, getSubgroupsWithLevel, groups]
  );

  const displayMessages = useMemo(() => {
    // Per-group cache is the source of truth — global `messages` can lag or hold another chat.
    return messagesCache[groupId] || [];
  }, [messagesCache, groupId]);

  const allGroupMessages = useMemo(() => {
    const combined = [...displayMessages];
    const seen = new Set(displayMessages.map(m => m.id));
    for (const msg of cachedGroupMessages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        combined.push(msg);
      }
    }
    return combined;
  }, [displayMessages, cachedGroupMessages]);

  const availableTags = useMemo(() => extractTagsFromQuestions(allGroupMessages), [allGroupMessages]);
  const testableCount = useMemo(
    () => selectGroupQuestions(allGroupMessages, { numberOfQuestions: 999 }, userQuestionStats).length,
    [allGroupMessages, userQuestionStats]
  );

  const getAvailableCount = useCallback((filter: TestConfigAvailableFilter) => {
    const subgroupIds = filter.subgroupIds || [];
    const sourceMessages = allGroupMessages.filter(
      m => m.groupId === groupId || !m.groupId || subgroupIds.includes(m.groupId)
    );
    return countMatchingQuestions(sourceMessages, filter, userQuestionStats);
  }, [allGroupMessages, groupId, userQuestionStats]);

  useEffect(() => {
    if (!showTestConfig || !user?.id) return;
    void loadUserQuestionStats(user.id);
    void loadTestPresets(user.id);
    const subgroupIds = availableSubgroups.map(s => s.id);
    if (subgroupIds.length) {
      void getMessagesForGroups(subgroupIds).then(setCachedGroupMessages);
    } else {
      setCachedGroupMessages([]);
    }
  }, [
    showTestConfig,
    user?.id,
    availableSubgroups,
    loadUserQuestionStats,
    loadTestPresets,
    getMessagesForGroups,
  ]);

  const loadChat = useCallback(async () => {
    if (!user?.id) return;
    // Reset per-open scroll state
    setUnreadAnchorAt(undefined);
    setFirstUnreadId(null);
    setNewMessagesBelow(0);
    initialAnchorDoneRef.current = false;
    lastMessageIdRef.current = null;
    prevMessageCountRef.current = 0;
    isNearBottomRef.current = true;
    suppressLoadOlderRef.current = true;

    selectGroup(groupId);
    const [, previousLastReadAt] = await Promise.all([
      fetchMessages(groupId, { page: 1, refresh: true, limit: messageLimit }),
      markGroupAsRead(groupId, user.id),
      fetchUserVotesForGroup(groupId, user.id),
    ]);
    setUnreadAnchorAt(previousLastReadAt ?? null);
  }, [user?.id, groupId, selectGroup, fetchMessages, markGroupAsRead, fetchUserVotesForGroup, messageLimit]);

  useEffect(() => {
    void loadChat();
  }, [loadChat]);

  // Find first unread once messages + prior marker are ready.
  useEffect(() => {
    if (unreadAnchorAt === undefined) return;
    if (displayMessages.length === 0) {
      setFirstUnreadId(null);
      return;
    }
    if (unreadAnchorAt == null) {
      setFirstUnreadId(null);
      return;
    }
    const anchorMs = new Date(unreadAnchorAt).getTime();
    if (Number.isNaN(anchorMs)) {
      setFirstUnreadId(null);
      return;
    }
    const first = displayMessages.find((msg) => {
      if (msg.senderId && msg.senderId === user?.id) return false;
      const ts = new Date(msg.createdAt).getTime();
      return !Number.isNaN(ts) && ts > anchorMs;
    });
    setFirstUnreadId(first?.id ?? null);
  }, [displayMessages, unreadAnchorAt, user?.id]);

  // Initial open: scroll to first unread or bottom.
  useEffect(() => {
    if (initialAnchorDoneRef.current) return;
    if (unreadAnchorAt === undefined) return;
    if (displayMessages.length === 0 && !isLoadingMessages) {
      initialAnchorDoneRef.current = true;
      suppressLoadOlderRef.current = false;
      return;
    }
    if (displayMessages.length === 0) return;

    const timer = setTimeout(() => {
      if (initialAnchorDoneRef.current) return;
      initialAnchorDoneRef.current = true;
      lastMessageIdRef.current = displayMessages[displayMessages.length - 1]?.id ?? null;
      prevMessageCountRef.current = displayMessages.length;

      if (firstUnreadId) {
        const index = displayMessages.findIndex((m) => m.id === firstUnreadId);
        if (index >= 0) {
          try {
            listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: false });
            isNearBottomRef.current = false;
          } catch {
            listRef.current?.scrollToEnd({ animated: false });
          }
        } else {
          listRef.current?.scrollToEnd({ animated: false });
        }
      } else {
        listRef.current?.scrollToEnd({ animated: false });
        isNearBottomRef.current = true;
      }
      // Allow load-older after the initial anchor settles.
      setTimeout(() => {
        suppressLoadOlderRef.current = false;
      }, 400);
    }, 80);
    return () => clearTimeout(timer);
  }, [displayMessages, firstUnreadId, unreadAnchorAt, isLoadingMessages]);

  // Live updates: auto-scroll only when near bottom or own message.
  useEffect(() => {
    if (!initialAnchorDoneRef.current) return;
    const last = displayMessages[displayMessages.length - 1];
    const lastId = last?.id ?? null;
    if (!lastId || lastId === lastMessageIdRef.current) {
      lastMessageIdRef.current = lastId;
      prevMessageCountRef.current = displayMessages.length;
      return;
    }

    const isOwn = last?.senderId === user?.id;
    if (isOwn || isNearBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: true });
      setNewMessagesBelow(0);
      isNearBottomRef.current = true;
    } else {
      const added = Math.max(1, displayMessages.length - prevMessageCountRef.current);
      setNewMessagesBelow((n) => n + added);
    }
    lastMessageIdRef.current = lastId;
    prevMessageCountRef.current = displayMessages.length;
  }, [displayMessages, user?.id]);

  useEffect(() => {
    if (!openAddMembers) return;
    setShowAddMembers(true);
    navigation.setParams({ openAddMembers: undefined });
  }, [openAddMembers, navigation]);

  const launchSession = async (config: TestConfigOptions, mode: TestMode) => {
    const subgroupIds = config.selectedSubgroupIds || [];
    const sourceGroupIds = [groupId, ...subgroupIds.filter(id => id !== groupId)];
    const sessionMessages = await getMessagesForGroups(sourceGroupIds);
    const combinedMessages = sessionMessages.length ? sessionMessages : displayMessages;

    const questions = selectGroupQuestions(
      combinedMessages,
      {
        numberOfQuestions: config.numberOfQuestions,
        selectedQuestionTypes: config.selectedQuestionTypes,
        selectedTags: config.selectedTags,
        useSpacedRepetition: config.useSpacedRepetition,
        focusOnNew: config.focusOnNew,
      },
      userQuestionStats
    );

    if (!questions.length) {
      Alert.alert('No questions', 'No testable questions match your filters.');
      return;
    }

    const sessionName = `${displayName} ${mode === 'study' ? 'Study' : 'Test'}`;
    const timeLimitMinutes =
      config.timerDuration > 0
        ? Math.ceil(config.timerDuration / 60)
        : mode === 'test'
          ? Math.max(config.numberOfQuestions * 2, 5)
          : 0;
    await startQuestionSet(sessionName, questions, mode, { timeLimitMinutes });
    navigation.getParent()?.navigate('StudyTab', {
      screen: 'TestTaking',
      params: { testId: 'custom', testName: displayName, mode, groupName: displayName, groupId },
    });
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || !user?.id || sending) return;
    setSending(true);
    setText('');
    isNearBottomRef.current = true;
    try {
      await sendMessage(groupId, trimmed, user.id);
      listRef.current?.scrollToEnd({ animated: true });
      setNewMessagesBelow(0);
    } finally {
      setSending(false);
    }
  };

  const handleSummarize = async () => {
    if (!user?.id || summarizing) return;
    setSummarizing(true);
    try {
      const result = await summarizeGroupChat(groupId, displayName);
      const summary = result?.summary?.trim();
      if (!summary) {
        throw new Error('Summary was empty. Please try again.');
      }
      Alert.alert(`Summary · ${displayName}`, summary);
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to summarize chat.';
      Alert.alert('Summarize failed', message);
    } finally {
      setSummarizing(false);
    }
  };

  const handleQuestionSubmit = async (question: any) => {
    if (!user?.id) throw new Error('You must be signed in to submit a question.');
    await submitQuestion(groupId, mapModalQuestionToPayload(question, user.id, user.user_metadata?.full_name || 'You'));
    useFeatureTipStore.getState().markChecklist('submitQuestion');
    setShowQuestionModal(false);
    await fetchMessages(groupId, { page: 1, refresh: true, limit: messageLimit });
  };

  const handleAddMembers = async (userIds: string[]) => {
    for (const uid of userIds) {
      try {
        await api.addGroupMember(groupId, uid);
      } catch {
        /* continue */
      }
    }
    setShowAddMembers(false);
    if (user?.id) await fetchMessages(groupId, { page: 1, refresh: true, limit: messageLimit });
  };

  const inviteLink = currentGroup?.id
    ? `https://lanternstudy.com/invite/${(currentGroup as any).inviteId || currentGroup.id}`
    : '';

  const group = currentGroup;
  const isAdmin =
    group?.ownerId === user?.id || group?.adminIds?.includes(user?.id || '') || false;
  const memberCount = group?.memberCount || group?.members?.length || 0;

  useEffect(() => {
    const { setTipAllowed, setTipReady } = useFeatureTipStore.getState();
    setTipReady('chat.question', true);
    setTipReady('chat.test', true);
    setTipReady('chat.study', true);
    setTipReady('chat.summarize', true);
    setTipReady('chat.aiGenerate', true);
    setTipAllowed('chat.aiGenerate', isAdmin);
    return () => {
      setTipReady('chat.question', false);
      setTipReady('chat.test', false);
      setTipReady('chat.study', false);
      setTipReady('chat.summarize', false);
      setTipReady('chat.aiGenerate', false);
      setTipAllowed('chat.aiGenerate', false);
    };
  }, [isAdmin]);

  const handleBack = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate('GroupsList');
    }
  }, [navigation]);

  const headerMenuActions = useMemo((): GroupChatHeaderAction[] => {
    const actions: GroupChatHeaderAction[] = [
      {
        id: 'study',
        label: 'Study mode',
        icon: 'library-outline',
        onPress: () => {
          setTestMode('study');
          setShowTestConfig(true);
        },
      },
      {
        id: 'test',
        label: 'Test mode',
        icon: 'clipboard-outline',
        onPress: () => {
          setTestMode('test');
          setShowTestConfig(true);
        },
      },
      {
        id: 'summarize',
        label: summarizing ? 'Summarizing…' : 'Summarize chat',
        icon: 'sparkles-outline',
        iconColor: '#a855f7',
        disabled: summarizing,
        onPress: () => void handleSummarize(),
      },
      {
        id: 'info',
        label: 'About group',
        icon: 'people-outline',
        onPress: () => setShowGroupInfo(true),
      },
    ];

    if (isAdmin) {
      actions.push({
        id: 'ai-generate',
        label: 'AI generate questions',
        icon: 'bulb-outline',
        iconColor: colors.warning,
        onPress: () => setShowAIGenerate(true),
      });
    }

    return actions;
  }, [isAdmin, summarizing, colors.warning]);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
      <GroupChatHeader
        displayName={displayName}
        memberCount={memberCount}
        lowDataMode={lowDataMode}
        onBack={handleBack}
        onAddQuestion={() => setShowQuestionModal(true)}
        menuActions={headerMenuActions}
      />

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {isLoadingMessages && displayMessages.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : groupError && displayMessages.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6 gap-3">
            <Text className="text-sm text-center text-lantern-text-secondary">{groupError}</Text>
            <Pressable
              onPress={() => void loadChat()}
              className="px-4 py-2 rounded-xl bg-lantern-primary"
            >
              <Text className="text-sm font-semibold text-white">Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View className="flex-1 relative">
          <FlatList
            ref={listRef}
            data={displayMessages}
            keyExtractor={item => item.id}
            className="flex-1"
            contentContainerClassName="px-4 py-4 flex-grow"
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              if (contentOffset.y <= 16) {
                handleLoadOlderMessages();
              }
              const distanceFromBottom =
                contentSize.height - contentOffset.y - layoutMeasurement.height;
              const nearBottom = distanceFromBottom <= NEAR_BOTTOM_PX;
              isNearBottomRef.current = nearBottom;
              if (nearBottom && newMessagesBelow > 0) {
                setNewMessagesBelow(0);
              }
            }}
            scrollEventThrottle={200}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: Math.max(0, info.averageItemLength * info.index),
                animated: false,
              });
              setTimeout(() => {
                listRef.current?.scrollToIndex({
                  index: info.index,
                  viewPosition: 0,
                  animated: false,
                });
              }, 100);
            }}
            ListHeaderComponent={
              isLoadingMore ? (
                <View className="py-2 items-center">
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-16">
                <Text className="text-sm text-lantern-text-secondary">No messages yet. Say hello!</Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const previous = index > 0 ? displayMessages[index - 1] : undefined;
              const showDate =
                index === 0 ||
                (previous && isDifferentChatDay(previous.createdAt, item.createdAt));
              const showUnreadDivider = firstUnreadId === item.id;
              const isGroupedWithPrevious =
                !!previous &&
                !showDate &&
                !showUnreadDivider &&
                previous.senderId === item.senderId &&
                new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000;

              return (
                <View>
                  {showDate ? (
                    <ChatDateSeparator label={formatChatDateLabel(item.createdAt)} />
                  ) : null}
                  {showUnreadDivider ? <NewMessagesDivider /> : null}
                  <MessageBubble
                    message={item}
                    isOwn={item.senderId === user?.id}
                    userVote={userVotes[item.id]}
                    memberCount={memberCount}
                    isGroupedWithPrevious={isGroupedWithPrevious}
                    onVote={
                      item.type === 'question' && user?.id
                        ? vote => void voteOnMessage(groupId, item.id, user.id!, vote)
                        : undefined
                    }
                    flagCount={item.flaggedAsSimilarUserIds?.length ?? 0}
                    userFlagged={
                      user?.id
                        ? item.flaggedAsSimilarUserIds?.includes(user.id) ?? false
                        : false
                    }
                    onFlag={
                      item.type === 'question' && user?.id
                        ? () => void flagMessageAsSimilar(item.id, groupId, user.id!)
                        : undefined
                    }
                    canFlag={item.senderId !== user?.id}
                  />
                </View>
              );
            }}
          />
          {newMessagesBelow > 0 ? (
            <View className="absolute bottom-3 left-0 right-0 items-center" pointerEvents="box-none">
              <Pressable
                onPress={() => {
                  listRef.current?.scrollToEnd({ animated: true });
                  setNewMessagesBelow(0);
                  isNearBottomRef.current = true;
                }}
                className="px-3 py-1.5 rounded-full bg-lantern-primary"
              >
                <Text className="text-xs font-semibold text-white">
                  ↓ {newMessagesBelow} new message{newMessagesBelow === 1 ? '' : 's'}
                </Text>
              </Pressable>
            </View>
          ) : null}
          </View>
        )}

        {typingLabel ? (
          <Text className="px-4 py-1 text-xs text-lantern-text-secondary">{typingLabel}</Text>
        ) : null}
        <ChatComposer
          value={text}
          onChangeText={value => {
            setText(value);
            broadcastTyping();
          }}
          onSend={() => void handleSend()}
          sending={sending}
          onAttachImage={async (uri, mimeType) => {
            if (!user?.id) return;
            try {
              const { uploadChatImage } = await import('../../services/chatImageUpload');
              const { url } = await uploadChatImage(uri, mimeType, groupId);
              await sendMessage(
                groupId,
                `![image](${url})`,
                user.id,
                user.user_metadata?.full_name || user.email || 'User'
              );
            } catch {
              const { useToastStore } = await import('../../stores/toastStore');
              useToastStore.getState().showToast('Failed to send image.', 'error');
            }
          }}
        />
      </KeyboardAvoidingView>

      <TestConfigModal
        visible={showTestConfig}
        onClose={() => setShowTestConfig(false)}
        mode={testMode}
        maxQuestions={Math.max(1, testableCount)}
        availableTags={availableTags}
        testName={displayName}
        getAvailableCount={getAvailableCount}
        presets={testPresets}
        onSavePreset={(name, config) => {
          if (!user?.id) return;
          void saveTestPreset(user.id, name, config).catch(() => {
            Alert.alert('Error', 'Failed to save preset.');
          });
        }}
        onDeletePreset={presetId => {
          if (!user?.id) return;
          void deleteTestPreset(user.id, presetId).catch(() => {
            Alert.alert('Error', 'Failed to delete preset.');
          });
        }}
        subgroups={availableSubgroups}
        onSubmit={(config, mode) => {
          setShowTestConfig(false);
          void launchSession(config, mode);
        }}
      />

      <QuestionModal
        visible={showQuestionModal}
        onClose={() => setShowQuestionModal(false)}
        groupId={groupId}
        onSubmit={q => void handleQuestionSubmit(q)}
      />

      {group && user?.id ? (
        <GroupInfoModal
          visible={showGroupInfo}
          onClose={() => setShowGroupInfo(false)}
          group={group}
          currentUserId={user.id}
          onUpdateDetails={(id, name, description) => void updateGroupDetails(id, name, description)}
          onPromoteToAdmin={(gid, uid) => void promoteToAdmin(gid, uid)}
          onDemoteAdmin={(gid, uid) => void demoteAdmin(gid, uid)}
          onRemoveMember={(gid, uid) => void removeMember(gid, uid)}
          onArchiveGroup={() => {}}
          onDeleteGroup={gid => void deleteGroup(gid)}
          onAddMembers={() => {
            setShowGroupInfo(false);
            setShowAddMembers(true);
          }}
          onCreateSubgroup={() => {
            setShowGroupInfo(false);
            navigation.navigate('CreateGroup', { parentId: groupId, parentName: displayName });
          }}
          onChallenge={member => {
            setShowGroupInfo(false);
            setChallengeMember(member);
          }}
        />
      ) : null}

      {user?.id ? (
        <AddMembersModal
          visible={showAddMembers}
          onClose={() => setShowAddMembers(false)}
          groupId={groupId}
          groupName={displayName}
          inviteLink={inviteLink}
          groupMemberIds={group?.members.map(m => m.userId) || []}
          currentUserId={user.id}
          onAddMembers={handleAddMembers}
        />
      ) : null}

      {showAIGenerate ? (
        <AIGenerateQuestionsModal
          visible={showAIGenerate}
          onClose={() => setShowAIGenerate(false)}
          subject={displayName}
          onQuestionsGenerated={async (questions) => {
            if (!user?.id) {
              Alert.alert('Error', 'Please sign in to post questions.');
              return;
            }
            const senderName = user.user_metadata?.full_name || 'You';
            let posted = 0;
            for (const q of questions) {
              try {
                await submitQuestion(
                  groupId,
                  mapAIQuestionToPayload(q, user.id, senderName)
                );
                posted += 1;
              } catch {
                // continue posting remaining questions
              }
            }
            setShowAIGenerate(false);
            await fetchMessages(groupId, { page: 1, refresh: true, limit: messageLimit });
            if (posted === 0) {
              Alert.alert('Error', 'Questions were generated but could not be posted to chat.');
            } else if (posted < questions.length) {
              Alert.alert(
                'Partial success',
                `Posted ${posted} of ${questions.length} questions to the group chat.`
              );
            }
          }}
        />
      ) : null}

      {challengeMember && user ? (
        <ChallengeModal
          visible={!!challengeMember}
          onClose={() => setChallengeMember(null)}
          opponent={{
            id: challengeMember.userId,
            name: challengeMember.name || 'Opponent',
            avatarUrl: challengeMember.avatarUrl,
          }}
          groupId={groupId}
          availableTags={availableTags}
          maxQuestions={Math.max(1, testableCount)}
          getAvailableCount={getAvailableCount}
          onChallengeSent={() => setChallengeMember(null)}
          onSoloStart={() => {
            setChallengeMember(null);
            navigation.navigate('GameScreen', {});
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

export default GroupChatScreen;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
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
import { Ionicons } from '@expo/vector-icons';
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
  ChatThreadModal,
  GroupChatHeader,
  MessageBubble,
  formatChatDateLabel,
  isDifferentChatDay,
  type GroupChatHeaderAction,
} from '../../components/chat';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useChatReadReceipts } from '../../hooks/useChatReadReceipts';
import { useQuestionVisibilityMode } from '../../hooks/useQuestionVisibilityMode';
import { useTheme } from '../../theme';
import { selectGroupQuestions, extractTagsFromQuestions, countMatchingQuestions } from '../../utils/questionHelpers';
import { aiAskTutor, summarizeGroupChat } from '../../services/ai';
import * as api from '../../services/api';
import { navigateToTestTaking } from '../../navigation/navigationRef';
import {
  QUESTION_VISIBILITY_MODE_OPTIONS,
  canEditChatMessage,
  canRemoveChatMessage,
  messagePassesQuestionVisibility,
  shouldRenderRemovedMessage,
} from '@lantern/shared/utils';
import {
  CHAT_MUTE_DURATIONS,
  formatMuteUntilLabel,
  type ChatMuteDurationId,
} from '@lantern/shared';

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

/** Mirrors web's MessageInputBar: "@AI <question>" / "/ask <question>". */
const AI_QUERY_PATTERN = /^(?:@AI\s+|\/ask\s+)(.+)/is;

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
    editGroupMessage,
    removeGroupMessage,
    markGroupAsRead,
    updateGroupDetails,
    promoteToAdmin,
    demoteAdmin,
    removeMember,
    leaveGroup,
    archiveGroup,
    deleteGroup,
    submitQuestion,
    voteOnMessage,
    flagMessageAsSimilar,
    fetchUserVotesForGroup,
    getSubgroupsWithLevel,
    getMessagesForGroups,
    messagePagination,
    fetchThread,
    applyPeerChatRead,
  } = useGroupStore();

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [showTestConfig, setShowTestConfig] = useState(false);
  const [testMode, setTestMode] = useState<TestMode>('test');
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showAIGenerate, setShowAIGenerate] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const [chatMutedUntil, setChatMutedUntil] = useState<string | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);
  const [challengeMember, setChallengeMember] = useState<GroupMember | null>(null);
  const [cachedGroupMessages, setCachedGroupMessages] = useState<Message[]>([]);
  const [unreadAnchorAt, setUnreadAnchorAt] = useState<string | null | undefined>(undefined);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [replyTo, setReplyTo] = useState<{
    id: string;
    senderName?: string;
    text?: string;
  } | null>(null);
  const [seedMentionUsername, setSeedMentionUsername] = useState<string | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
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
  const [questionVisibilityMode, setQuestionVisibilityMode] = useQuestionVisibilityMode();

  const onPeerRead = useCallback(
    (payload: { userId: string; lastReadAt: string }) => {
      applyPeerChatRead({ chatId: groupId, ...payload });
    },
    [applyPeerChatRead, groupId]
  );
  useChatReadReceipts(groupId, user?.id, onPeerRead);

  const reloadThread = useCallback(async () => {
    if (!threadRootId) return;
    const msgs = (await fetchThread(threadRootId, { groupId })) as Message[];
    setThreadMessages(msgs);
  }, [fetchThread, groupId, threadRootId]);

  const handleOpenThread = useCallback(
    async (rootId: string) => {
      setThreadRootId(rootId);
      setThreadLoading(true);
      try {
        const msgs = (await fetchThread(rootId, { groupId })) as Message[];
        setThreadMessages(msgs);
      } catch {
        Alert.alert('Thread', 'Could not load thread.');
        setThreadRootId(null);
        setThreadMessages([]);
      } finally {
        setThreadLoading(false);
      }
    },
    [fetchThread, groupId]
  );

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
    const raw = messagesCache[groupId] || [];
    return raw.filter(
      (msg) =>
        shouldRenderRemovedMessage(msg, raw) &&
        messagePassesQuestionVisibility(msg, questionVisibilityMode)
    );
  }, [messagesCache, groupId, questionVisibilityMode]);

  const allGroupMessages = useMemo(() => {
    const combined = [...(messagesCache[groupId] || [])];
    const seen = new Set(combined.map((m) => m.id));
    for (const msg of cachedGroupMessages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        combined.push(msg);
      }
    }
    return combined.filter(
      (msg) =>
        shouldRenderRemovedMessage(msg, combined) &&
        messagePassesQuestionVisibility(msg, questionVisibilityMode)
    );
  }, [messagesCache, groupId, cachedGroupMessages, questionVisibilityMode]);

  const availableTags = useMemo(
    () =>
      extractTagsFromQuestions(
        allGroupMessages,
        questionVisibilityMode,
        questionVisibilityMode === 'unverified' ? 'study' : 'test'
      ),
    [allGroupMessages, questionVisibilityMode]
  );
  const testableCount = useMemo(
    () =>
      selectGroupQuestions(
        allGroupMessages,
        {
          numberOfQuestions: 999,
          visibilityMode: questionVisibilityMode,
          sessionMode: questionVisibilityMode === 'unverified' ? 'study' : 'test',
        },
        userQuestionStats
      ).length,
    [allGroupMessages, userQuestionStats, questionVisibilityMode]
  );

  const getAvailableCount = useCallback((filter: TestConfigAvailableFilter) => {
    const subgroupIds = filter.subgroupIds || [];
    const sourceMessages = allGroupMessages.filter(
      m => m.groupId === groupId || !m.groupId || subgroupIds.includes(m.groupId)
    );
    return countMatchingQuestions(
      sourceMessages,
      {
        ...filter,
        visibilityMode: filter.visibilityMode ?? questionVisibilityMode,
        sessionMode: filter.sessionMode,
      },
      userQuestionStats
    );
  }, [allGroupMessages, groupId, userQuestionStats, questionVisibilityMode]);

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
    setReplyTo(null);
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
      void AccessibilityInfo.announceForAccessibility(
        `${added} new message${added === 1 ? '' : 's'}`
      );
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
    try {
      const subgroupIds = config.selectedSubgroupIds || [];
      const sourceGroupIds = [groupId, ...subgroupIds.filter(id => id !== groupId)];
      // Use raw group messages for the pool — chat visibility filters must not strip bank candidates.
      const sessionMessages = await getMessagesForGroups(sourceGroupIds);
      const combinedMessages = sessionMessages.length
        ? sessionMessages
        : (messagesCache[groupId] || []);
      const visibilityMode = config.visibilityMode ?? questionVisibilityMode;

      const questions = selectGroupQuestions(
        combinedMessages,
        {
          numberOfQuestions: config.numberOfQuestions,
          selectedQuestionTypes: config.selectedQuestionTypes,
          selectedTags: config.selectedTags,
          useSpacedRepetition: config.useSpacedRepetition,
          focusOnNew: config.focusOnNew,
          visibilityMode,
          sessionMode: mode === 'study' ? 'study' : 'test',
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
      const parent = navigation.getParent?.();
      if (parent?.navigate) {
        parent.navigate('StudyTab', {
          screen: 'TestTaking',
          params: {
            testId: 'custom',
            testName: displayName,
            mode,
            groupName: displayName,
            groupId,
          },
        });
      } else {
        navigateToTestTaking({
          testId: 'custom',
          testName: displayName,
          mode,
          groupName: displayName,
          groupId,
        });
      }
    } catch (err) {
      Alert.alert(
        'Could not start session',
        err instanceof Error ? err.message : 'Please try again.'
      );
    }
  };

  const mentionRoster = useMemo(() => {
    const fromCurrent = currentGroup?.members || [];
    if (fromCurrent.length > 0) return fromCurrent;
    return groups.find((g) => g.id === groupId)?.members || [];
  }, [currentGroup?.members, groups, groupId]);

  const mentionCandidates = useMemo(() => {
    const members = mentionRoster
      .filter((m) => m.userId !== user?.id && m.username)
      .map((m) => ({ id: m.userId, username: m.username!, name: m.name }));
    const canMentionAll =
      !!user?.id &&
      (currentGroup?.ownerId === user.id ||
        currentGroup?.adminIds?.includes(user.id) ||
        false);
    if (canMentionAll) {
      return [{ id: '__all__', username: 'all', name: 'Everyone in this group' }, ...members];
    }
    return members;
  }, [mentionRoster, user?.id, currentGroup?.ownerId, currentGroup?.adminIds]);

  const handleSend = async (overrideText?: string) => {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed || !user?.id || sending || aiThinking) return;

    // Same trigger as web: "@AI <question>" or "/ask <question>" answers in-chat
    // instead of posting the question. Not available while editing a message.
    const aiMatch = editingMessage ? null : trimmed.match(AI_QUERY_PATTERN);
    if (aiMatch) {
      const question = aiMatch[1]!.trim();
      if (!overrideText) setText('');
      const replyId = replyTo?.id;
      setAiThinking(true);
      try {
        const { answer } = await aiAskTutor(question);
        if (answer) {
          isNearBottomRef.current = true;
          setReplyTo(null);
          await sendMessage(groupId, `🤖 AI Tutor:\n${answer}`, user.id, undefined, {
            replyToMessageId: replyId,
          });
          listRef.current?.scrollToEnd({ animated: true });
          setNewMessagesBelow(0);
        }
      } catch (error) {
        if (!overrideText) setText(trimmed);
        Alert.alert(
          'AI Tutor failed',
          error instanceof Error ? error.message : 'Please try again.'
        );
      } finally {
        setAiThinking(false);
      }
      return;
    }

    setSending(true);
    try {
      if (editingMessage) {
        await editGroupMessage(groupId, editingMessage.id, trimmed);
        setEditingMessage(null);
        setText('');
        if (threadRootId) await reloadThread();
        return;
      }

      if (!overrideText) setText('');
      isNearBottomRef.current = true;
      const replyId = replyTo?.id;
      setReplyTo(null);
      const mentionedUsernames = new Set(
        [...trimmed.matchAll(/@([a-zA-Z0-9_]{2,32})\b/g)].map((m) => m[1]!.toLowerCase())
      );
      const canMentionAll = mentionCandidates.some((c) => c.id === '__all__');
      const mentionedUserIds =
        mentionedUsernames.has('all') && canMentionAll
          ? mentionCandidates
              .filter((c) => c.username.toLowerCase() !== 'all' && c.id !== '__all__')
              .map((c) => c.id)
          : mentionCandidates
              .filter(
                (c) =>
                  mentionedUsernames.has(c.username.toLowerCase()) && c.id !== '__all__'
              )
              .map((c) => c.id);
      await sendMessage(groupId, trimmed, user.id, undefined, {
        replyToMessageId: replyId,
        mentionedUserIds,
      });
      listRef.current?.scrollToEnd({ animated: true });
      setNewMessagesBelow(0);
    } catch (error) {
      if (!overrideText && !editingMessage) setText(trimmed);
      Alert.alert(
        editingMessage ? 'Edit failed' : 'Send failed',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setSending(false);
    }
  };

  const beginReply = useCallback((message: Message) => {
    setEditingMessage(null);
    setReplyTo({
      id: message.id,
      senderName: message.senderName,
      text: message.questionStem || message.text,
    });
  }, []);

  const beginEdit = useCallback((message: Message) => {
    setReplyTo(null);
    setEditingMessage(message);
    setText(message.text);
  }, []);

  const confirmRemoveMessage = useCallback((message: Message) => {
    Alert.alert(
      'Remove message?',
      'This removes the message for everyone. An audit record will be retained.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeGroupMessage(groupId, message.id)
              .then(async () => {
                if (editingMessage?.id === message.id) {
                  setEditingMessage(null);
                  setText('');
                }
                if (threadRootId) await reloadThread();
              })
              .catch((error) => {
                Alert.alert(
                  'Remove failed',
                  error instanceof Error ? error.message : 'Please try again.'
                );
              });
          },
        },
      ]
    );
  }, [editingMessage?.id, groupId, reloadThread, removeGroupMessage, threadRootId]);

  const showMessageActions = useCallback((message: Message) => {
    const canEdit = canEditChatMessage(message, user?.id);
    const canRemove = canRemoveChatMessage(message, user?.id);
    if (!canEdit && !canRemove) {
      beginReply(message);
      return;
    }

    const showManageActions = () => {
      Alert.alert('Manage message', undefined, [
        { text: 'Cancel', style: 'cancel' },
        ...(canEdit ? [{ text: 'Edit', onPress: () => beginEdit(message) }] : []),
        ...(canRemove
          ? [{
              text: 'Remove',
              style: 'destructive' as const,
              onPress: () => confirmRemoveMessage(message),
            }]
          : []),
      ]);
    };

    Alert.alert('Message options', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reply', onPress: () => beginReply(message) },
      { text: canEdit ? 'Edit or remove' : 'Remove', onPress: showManageActions },
    ]);
  }, [beginEdit, beginReply, confirmRemoveMessage, user?.id]);

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
    try {
      const result = await api.addGroupMembersBatch(groupId, userIds);
      const invited = result?.invited?.length ? result.invited : (result?.added || []);
      const pending = result?.alreadyPending || [];
      if (invited.length || pending.length) {
        Alert.alert(
          'Invites sent',
          'People must accept the invite before they appear in this group.'
        );
      } else {
        Alert.alert('No new invites', 'Those users may already be members or already invited.');
      }
    } catch (error) {
      Alert.alert(
        'Invite failed',
        error instanceof Error ? error.message : 'Could not send invites.'
      );
    }
    setShowAddMembers(false);
  };

  const inviteLink = currentGroup?.id
    ? `https://lanternstudy.com/invite/${(currentGroup as any).inviteId || currentGroup.id}`
    : '';

  const group = currentGroup;
  const isAdmin =
    group?.ownerId === user?.id || group?.adminIds?.includes(user?.id || '') || false;
  const memberCount = group?.memberCount || group?.members?.length || 0;

  // archiveGroup is a toggle, so this unarchives an archived group.
  const handleToggleArchive = useCallback(async () => {
    if (archiveBusy) return;
    setArchiveBusy(true);
    try {
      await archiveGroup(groupId);
    } catch (error) {
      Alert.alert(
        'Could not update group',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setArchiveBusy(false);
    }
  }, [archiveBusy, archiveGroup, groupId]);

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

  useEffect(() => {
    let cancelled = false;
    void api.getGroupMuteStatus(groupId)
      .then((status) => {
        if (cancelled) return;
        setChatMuted(!!status?.muted);
        setChatMutedUntil(status?.mutedUntil ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setChatMuted(false);
        setChatMutedUntil(null);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const applyMute = useCallback(
    async (duration: ChatMuteDurationId) => {
      if (muteBusy) return;
      setMuteBusy(true);
      try {
        const status = await api.muteGroupChat(groupId, duration);
        if (!status?.muted) {
          Alert.alert('Mute failed', 'Could not mute notifications for this group.');
          return;
        }
        setChatMuted(true);
        setChatMutedUntil(status.mutedUntil);
      } catch {
        Alert.alert('Mute failed', 'Could not mute notifications for this group.');
      } finally {
        setMuteBusy(false);
      }
    },
    [groupId, muteBusy]
  );

  const clearMute = useCallback(async () => {
    if (muteBusy) return;
    setMuteBusy(true);
    try {
      const status = await api.unmuteGroupChat(groupId);
      if (!status || status.muted) {
        Alert.alert('Unmute failed', 'Could not unmute notifications for this group.');
        return;
      }
      setChatMuted(false);
      setChatMutedUntil(null);
    } catch {
      Alert.alert('Unmute failed', 'Could not unmute notifications for this group.');
    } finally {
      setMuteBusy(false);
    }
  }, [groupId, muteBusy]);

  const openMutePicker = useCallback(() => {
    Alert.alert(
      'Mute notifications',
      'Pause alerts for this group chat.',
      [
        ...CHAT_MUTE_DURATIONS.map((opt) => ({
          text: opt.label,
          onPress: () => void applyMute(opt.id),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  }, [applyMute]);

  const muteUntilLabel = formatMuteUntilLabel(chatMutedUntil);

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
      ...QUESTION_VISIBILITY_MODE_OPTIONS.map((opt) => ({
        id: `qvis-${opt.value}`,
        label:
          questionVisibilityMode === opt.value
            ? `Questions: ${opt.label} ✓`
            : `Questions: ${opt.label}`,
        icon: 'filter-outline' as const,
        onPress: () => setQuestionVisibilityMode(opt.value),
      })),
      {
        id: 'summarize',
        label: summarizing ? 'Summarizing…' : 'Summarize chat',
        icon: 'sparkles-outline',
        onPress: () => void handleSummarize(),
        disabled: summarizing,
        iconColor: '#a855f7',
      },
      chatMuted
        ? {
            id: 'unmute',
            label: muteUntilLabel ? `Unmute (until ${muteUntilLabel})` : 'Unmute notifications',
            icon: 'notifications-outline' as const,
            onPress: () => void clearMute(),
            disabled: muteBusy,
          }
        : {
            id: 'mute',
            label: 'Mute notifications…',
            icon: 'notifications-off-outline' as const,
            onPress: openMutePicker,
            disabled: muteBusy,
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
  }, [
    isAdmin,
    summarizing,
    colors.warning,
    questionVisibilityMode,
    setQuestionVisibilityMode,
    chatMuted,
    muteUntilLabel,
    muteBusy,
    clearMute,
    openMutePicker,
  ]);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
      <GroupChatHeader
        displayName={displayName}
        avatarUrl={group?.avatarUrl}
        memberCount={memberCount}
        lowDataMode={lowDataMode}
        onBack={handleBack}
        onAddQuestion={() => setShowQuestionModal(true)}
        menuActions={headerMenuActions}
      />

      {chatMuted ? (
        <View className="flex-row items-center justify-between gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/40">
          <Text className="flex-1 text-[11px] text-amber-800 dark:text-amber-300" numberOfLines={2}>
            Notifications muted{muteUntilLabel ? ` until ${muteUntilLabel}` : ''}
          </Text>
          <Pressable onPress={() => void clearMute()} disabled={muteBusy} className="px-2 py-1">
            <Text className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Unmute</Text>
          </Pressable>
        </View>
      ) : null}

      {group?.isArchived ? (
        <View className="flex-row items-center justify-between gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/40">
          <Text className="flex-1 text-[11px] text-amber-800 dark:text-amber-300" numberOfLines={2}>
            This group is archived. Unarchive it to send messages.
          </Text>
          <Pressable
            onPress={() => void handleToggleArchive()}
            disabled={archiveBusy}
            className="px-2 py-1"
          >
            <Text className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              Unarchive
            </Text>
          </Pressable>
        </View>
      ) : null}

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
            style={{ backgroundColor: colors.chatBackground }}
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
                !!previous.senderId &&
                !!item.senderId &&
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
                    onReply={showMessageActions}
                    onSwipeReply={beginReply}
                    onMentionUser={(username) => setSeedMentionUsername(username)}
                    onScrollToMessage={(messageId) => {
                      const index = displayMessages.findIndex((m) => m.id === messageId);
                      if (index >= 0) {
                        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
                      }
                    }}
                    onOpenThread={handleOpenThread}
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
                accessibilityRole="button"
                accessibilityLabel={`${newMessagesBelow} new messages, jump to latest`}
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

        {aiThinking ? (
          <Text
            accessibilityLiveRegion="polite"
            className="px-4 py-1 text-xs text-lantern-primary"
          >
            🤖 AI Tutor is thinking…
          </Text>
        ) : typingLabel ? (
          <Text
            accessibilityLiveRegion="polite"
            className="px-4 py-1 text-xs text-lantern-text-secondary"
          >
            {typingLabel}
          </Text>
        ) : null}
        {group?.isArchived ? (
          <View className="flex-row items-center justify-center gap-2 px-4 py-4 border-t border-lantern-border bg-lantern-surface">
            <Ionicons name="archive-outline" size={16} color={colors.textSecondary} />
            <Text className="text-sm text-lantern-text-secondary">
              This group is archived.
            </Text>
          </View>
        ) : (
        <ChatComposer
          value={text}
          onChangeText={value => {
            setText(value);
            broadcastTyping();
          }}
          onSend={() => void handleSend()}
          sending={sending || aiThinking}
          groupId={groupId}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          editingMessage={
            editingMessage ? { id: editingMessage.id, text: editingMessage.text } : null
          }
          onCancelEdit={() => {
            setEditingMessage(null);
            setText('');
          }}
          mentionCandidates={mentionCandidates}
          seedMentionUsername={seedMentionUsername}
          onSeedMentionConsumed={() => setSeedMentionUsername(null)}
          onSendAudioMarkdown={async (markdown) => {
            await handleSend(markdown);
          }}
          onAttachImage={async (uri, mimeType) => {
            if (!user?.id) return;
            try {
              const { uploadChatImage } = await import('../../services/chatImageUpload');
              const { url } = await uploadChatImage(uri, mimeType, groupId);
              await sendMessage(
                groupId,
                `![image](${url})`,
                user.id,
                user.user_metadata?.full_name || user.email || 'User',
                { replyToMessageId: replyTo?.id }
              );
              setReplyTo(null);
            } catch {
              const { useToastStore } = await import('../../stores/toastStore');
              useToastStore.getState().showToast('Failed to send image.', 'error');
            }
          }}
        />
        )}
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
          onLeaveGroup={(gid) => {
            if (!user?.id) return;
            void leaveGroup(gid, user.id)
              .then(() => {
                setShowGroupInfo(false);
                navigation.goBack();
              })
              .catch((error: unknown) => {
                Alert.alert(
                  'Could not leave group',
                  error instanceof Error ? error.message : 'Try again.',
                );
              });
          }}
          onArchiveGroup={(gid) => {
            void archiveGroup(gid)
              .then(() => {
                setShowGroupInfo(false);
                navigation.goBack();
              })
              .catch((error: unknown) => {
                Alert.alert(
                  'Could not update group',
                  error instanceof Error ? error.message : 'Try again.',
                );
              });
          }}
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
          onAvatarUpdated={(gid, avatarUrl) => {
            useGroupStore.setState((state) => ({
              groups: state.groups.map((g) =>
                g.id === gid ? { ...g, avatarUrl } : g
              ),
              currentGroup:
                state.currentGroup?.id === gid
                  ? { ...state.currentGroup, avatarUrl }
                  : state.currentGroup,
            }));
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

      <ChatThreadModal
        visible={!!threadRootId}
        onClose={() => {
          setThreadRootId(null);
          setThreadMessages([]);
        }}
        rootId={threadRootId}
        loading={threadLoading}
        messages={threadMessages}
        onReload={reloadThread}
        onSend={async (text, replyToMessageId) => {
          if (!user?.id) return;
          await sendMessage(groupId, text, user.id, undefined, { replyToMessageId });
        }}
        onEdit={(messageId, content) =>
          editGroupMessage(groupId, messageId, content)
        }
        onRemove={(messageId) => removeGroupMessage(groupId, messageId)}
        currentUserId={user?.id}
        isGroup
        memberCount={memberCount}
        userVotes={userVotes}
        onVote={(messageId, vote) => {
          if (!user?.id) return;
          void voteOnMessage(groupId, messageId, user.id, vote);
        }}
        onFlag={messageId => {
          if (!user?.id) return;
          void flagMessageAsSimilar(messageId, groupId, user.id);
        }}
        canFlag={msg => msg.senderId !== user?.id}
        userFlagged={msg => (user?.id ? msg.flaggedAsSimilarUserIds?.includes(user.id) ?? false : false)}
        groupId={groupId}
      />
    </SafeAreaView>
  );
}

export default GroupChatScreen;

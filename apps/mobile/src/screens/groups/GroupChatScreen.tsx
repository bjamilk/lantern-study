import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
  type ViewStyle,
  TextInput,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ForwardMessageSheet } from '../../components/chat/ForwardMessageSheet';
import { COMPOSER_KEYBOARD_BEHAVIOR } from '../../components/chat/composerKeyboardBehavior';
import { MessageActionBar } from '../../components/chat/MessageActionBar';
import { ActionSheet, type ActionSheetItem } from '../../components/ui';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { useGroupStore, type Message, type GroupMember } from '../../stores/groupStore';
import { useTestStore, type TestMode } from '../../stores/testStore';
import { useOfflineStore } from '../../stores/offlineStore';
import TestConfigModal, { type TestConfigOptions, type TestConfigAvailableFilter } from '../../components/TestConfigModal';
import ChallengeModal from '../../components/ChallengeModal';
import GroupInfoModal from '../../components/GroupInfoModal';
import QuestionModal from '../../components/QuestionModal';
import AddMembersModal from '../../components/AddMembersModal';
import AIGenerateQuestionsModal from '../../components/AIGenerateQuestionsModal';
import {
  CHAT_LIST_WINDOWING,
  ChatComposer,
  ChatThreadModal,
  ChatWallpaperBusyOverlay,
  ChatWallpaperLayer,
  ChatWallpaperSheet,
  GroupChatHeader,
  useChatWallpaper,
  MessageBubble,
  formatChatDateLabel,
  isDifferentChatDay,
  type GroupChatHeaderAction,
} from '../../components/chat';
import { useAiTutorSend } from '../../hooks/useAiTutorSend';
import { useChatImageAttach } from '../../hooks/useChatImageAttach';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { useTypingIndicator } from '../../hooks/useTypingIndicator';
import { useChatReadReceipts } from '../../hooks/useChatReadReceipts';
import { useQuestionVisibilityMode } from '../../hooks/useQuestionVisibilityMode';
import { useTheme, withAlpha } from '../../theme';
import { groupWallpaperScopeKey } from '../../utils/chatWallpaper';
import { applyReactionLocally } from '@lantern/shared/chat';
import { MessageReactions, ReactionPickerRow } from '../../components/chat/MessageReactions';
import { ReportContentSheet } from '../../components/moderation/ReportContentSheet';
import { selectGroupQuestions, extractTagsFromQuestions, countMatchingQuestions } from '../../utils/questionHelpers';
import * as api from '../../services/api';
import { navigateToTestTaking } from '../../navigation/navigationRef';
import {
  QUESTION_VISIBILITY_MODE_OPTIONS,
  canEditChatMessage,
  canRemoveChatMessage,
  deleteBlockedReason,
  isChatAudioMessage,
  isChatImageMessage,
  messagePassesQuestionVisibility,
  parseAiQuery,
  shouldRenderRemovedMessage,
} from '@lantern/shared/utils';
import {
  CHAT_MUTE_DURATIONS,
  formatMuteUntilLabel,
  type ChatMuteDurationId,
} from '@lantern/shared';
import { COMMUNITY_COPY, isCommunityBoardGroupIn } from '@lantern/shared/network';
import { collectKnownLounges, useCommunityStore } from '../../stores/communityStore';
import { findMyCommunity } from '../../utils/communityOverlay';

export type GroupChatNavigation = {
  goBack: () => void;
  canGoBack?: () => boolean;
  getState?: () => { index?: number } | undefined;
  getParent: () => { navigate: (tab: string, params?: Record<string, unknown>) => void } | undefined;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  setParams: (params: Record<string, unknown>) => void;
};

interface Props {
  navigation: GroupChatNavigation;
  route: {
    params: {
      groupId: string;
      groupName?: string;
      openAddMembers?: boolean;
      /** Only for the `in <Community> ›` link when opened from the plain chat list. */
      communitySlug?: string;
      communityName?: string;
    };
  };
}

/** Where the chat UI is mounted: the Chat tab, or a community's own stack. */
export type GroupChatHost = 'chat' | 'community';

export interface GroupChatViewProps {
  groupId: string;
  groupName?: string;
  openAddMembers?: boolean;
  navigation: GroupChatNavigation;
  /**
   * On the Chat stack every navigation is local. On the community stack
   * (founder rule §0a) the chat-only destinations — sub-group creation, the
   * game screen, the groups list — hop to the Chat tab, and back is a plain
   * goBack() to the community.
   */
  host?: GroupChatHost;
  /** `in <Community> ›` under the title; tapping jumps to the community. */
  communityContext?: { label: string; onPress: () => void } | null;
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
    difficulty?: 'easy' | 'medium' | 'hard';
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
    // AI-declared difficulty → question_data.authored_difficulty (never
    // `difficulty`, which is FSRS state). groupStore.submitQuestion must pass
    // it through as `authored_difficulty` for it to reach the server.
    authoredDifficulty: q.difficulty,
    acceptableAnswers:
      questionType === 'FILL_IN_THE_BLANK' && q.correctAnswer ? [q.correctAnswer] : undefined,
  };
}

function ChatDateSeparator({ label, pillStyle }: { label: string; pillStyle?: ViewStyle }) {
  if (!label) return null;
  return (
    <View className="items-center my-3">
      {/* The default pill is 80% translucent, which washes out over a photo —
          so a wallpaper swaps it for an opaque one via `pillStyle`. */}
      <View
        className={
          pillStyle
            ? 'px-3 py-1 rounded-full'
            : 'px-3 py-1 rounded-full bg-lantern-background-secondary/80 dark:bg-lantern-surface-secondary/80'
        }
        style={pillStyle}
      >
        <Text className="text-[11px] font-medium text-lantern-text-secondary">{label}</Text>
      </View>
    </View>
  );
}

function NewMessagesDivider({ pillStyle }: { pillStyle?: ViewStyle }) {
  // The rules were invisible: `bg-lantern-primary/40` emits no rule at all
  // (var()-backed colour + opacity modifier). Inline style instead.
  const { colors } = useTheme();
  // Over a wallpaper the hairlines need more weight to stay visible.
  const ruleStyle = { backgroundColor: withAlpha(colors.primary, pillStyle ? 0.7 : 0.4) };
  return (
    <View className="flex-row items-center my-3 gap-2">
      <View className="flex-1 h-px" style={ruleStyle} />
      {pillStyle ? (
        <View className="px-3 py-1 rounded-full" style={pillStyle}>
          <Text className="text-[11px] font-semibold text-lantern-primary">New messages</Text>
        </View>
      ) : (
        <Text className="text-[11px] font-semibold text-lantern-primary">New messages</Text>
      )}
      <View className="flex-1 h-px" style={ruleStyle} />
    </View>
  );
}

interface MessageRowProps {
  message: Message;
  isOwn: boolean;
  userVote?: 'up' | 'down';
  memberCount: number;
  members?: GroupMember[];
  flagCount: number;
  userFlagged: boolean;
  canFlag: boolean;
  canVote: boolean;
  dateLabel: string | null;
  showUnreadDivider: boolean;
  isGroupedWithPrevious: boolean;
  /** Opaque pill behind separators when a wallpaper is showing. Stable ref. */
  wallpaperPillStyle?: ViewStyle;
  onVoteMessage: (message: Message, vote: 'up' | 'down') => void;
  onFlagMessage: (message: Message) => void;
  onReply: (message: Message) => void;
  onSwipeReply: (message: Message) => void;
  onMentionUser: (username: string) => void;
  onScrollToMessage: (messageId: string) => void;
  onOpenThread: (rootId: string) => void;
  onRetry: (message: Message) => void;
  /** Device-local star indicator. */
  starred: boolean;
  /** This row is the target of the open action bar — highlight the whole row. */
  selected: boolean;
  /** Emoji the viewer has personally added to this message. */
  myReactions?: string[];
  onToggleReaction: (message: Message, emoji: string, added: boolean) => void;
}

/**
 * One chat row: date separator, unread divider, bubble. Memoized so a keystroke
 * in the composer (or another row's realtime update) re-renders nothing here.
 *
 * Everything crossing the memo boundary is either a primitive or referentially
 * stable — the grouping/divider decisions arrive pre-computed as primitives, and
 * the per-message closures the bubble wants are built *inside* the row, so they
 * only change when this row's own props do. The screen-level handlers below must
 * stay `useCallback`-stable or this memo is decorative.
 */
const MessageRow = React.memo(function MessageRow({
  message,
  isOwn,
  userVote,
  memberCount,
  members,
  flagCount,
  userFlagged,
  canFlag,
  canVote,
  dateLabel,
  showUnreadDivider,
  isGroupedWithPrevious,
  wallpaperPillStyle,
  onVoteMessage,
  onFlagMessage,
  onReply,
  onSwipeReply,
  onMentionUser,
  onScrollToMessage,
  onOpenThread,
  onRetry,
  starred,
  selected,
  myReactions,
  onToggleReaction,
}: MessageRowProps) {
  const { colors } = useTheme();
  const handleVote = useCallback(
    (vote: 'up' | 'down') => onVoteMessage(message, vote),
    [message, onVoteMessage]
  );
  const handleFlag = useCallback(() => onFlagMessage(message), [message, onFlagMessage]);
  const isQuestion = message.type === 'question';

  return (
    // Selection highlight spans the full row (negative margin cancels the
    // list's px-4) so a long-pressed message is unmistakable while the action
    // bar is open. The tint MUST be an inline style: `bg-lantern-primary/15`
    // compiles to nothing, because the lantern palette reaches Tailwind as
    // bare var() strings and Tailwind drops opacity modifiers it cannot parse.
    <View
      className={selected ? '-mx-4 px-4 py-1' : undefined}
      style={
        selected
          ? {
              backgroundColor: withAlpha(colors.primary, 0.18),
              borderLeftWidth: 3,
              borderLeftColor: colors.primary,
            }
          : undefined
      }
    >
      {dateLabel ? <ChatDateSeparator label={dateLabel} pillStyle={wallpaperPillStyle} /> : null}
      {showUnreadDivider ? <NewMessagesDivider pillStyle={wallpaperPillStyle} /> : null}
      <MessageBubble
        message={message}
        isOwn={isOwn}
        userVote={userVote}
        memberCount={memberCount}
        members={members}
        isGroupedWithPrevious={isGroupedWithPrevious}
        onVote={isQuestion && canVote ? handleVote : undefined}
        flagCount={flagCount}
        userFlagged={userFlagged}
        onFlag={isQuestion && canVote ? handleFlag : undefined}
        canFlag={canFlag}
        onReply={onReply}
        onSwipeReply={onSwipeReply}
        onMentionUser={onMentionUser}
        onScrollToMessage={onScrollToMessage}
        onOpenThread={onOpenThread}
        onRetry={onRetry}
        starred={starred}
        wallpaperPillStyle={wallpaperPillStyle}
      />
      {/* Reactions sit under the bubble for EVERY message type, questions
          included — they are not the question vote row, which lives inside the
          bubble and decides verification. */}
      <MessageReactions
        reactions={message.reactions}
        mine={myReactions}
        align={isOwn ? 'end' : 'start'}
        surfaceBase={colors.chatBackground}
        onToggle={(emoji, added) => onToggleReaction(message, emoji, added)}
      />
    </View>
  );
});

const NEAR_BOTTOM_PX = 120;

export function GroupChatView({
  groupId,
  groupName,
  openAddMembers,
  navigation,
  host = 'chat',
  communityContext,
}: GroupChatViewProps) {
  /**
   * A community surface (the lounge) keeps this chat UI but loses the whole
   * study/test apparatus — founder decision 1. That includes the per-question
   * machinery on the rows themselves: the vote bar, the VERIFIED/REJECTED
   * chip, the 20% threshold and flag-as-duplicate all live in a study group
   * now (§6). `Report` is a different action and stays.
   */
  const studySurface = host !== 'community';
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
  // Per-value selectors: the whole-store destructure re-rendered this 1500-line
  // screen on ANY store mutation, including other groups' realtime traffic.
  // Selecting this group's slice by key also stops the derived chains below
  // being invalidated by unrelated messages.
  const groupMessages = useGroupStore(s => s.messagesCache[groupId]);
  const currentGroup = useGroupStore(s => s.currentGroup);
  const isLoadingMore = useGroupStore(s => s.isLoadingMore);
  const isLoadingMessages = useGroupStore(s => s.isLoadingMessages);
  const groupError = useGroupStore(s => s.error);
  const userVotes = useGroupStore(s => s.userVotes);
  const groups = useGroupStore(s => s.groups);
  const messagePagination = useGroupStore(s => s.messagePagination);
  // Only the cross-group aggregate below needs the whole cache.
  const messagesCache = useGroupStore(s => s.messagesCache);
  const selectGroup = useGroupStore(s => s.selectGroup);
  const patchMessageInState = useGroupStore(s => s.patchMessageInState);
  const fetchMessages = useGroupStore(s => s.fetchMessages);
  const loadMoreMessages = useGroupStore(s => s.loadMoreMessages);
  const sendMessage = useGroupStore(s => s.sendMessage);
  const retryFailedMessage = useGroupStore(s => s.retryFailedMessage);
  const editGroupMessage = useGroupStore(s => s.editGroupMessage);
  const removeGroupMessage = useGroupStore(s => s.removeGroupMessage);
  const markGroupAsRead = useGroupStore(s => s.markGroupAsRead);
  const updateGroupDetails = useGroupStore(s => s.updateGroupDetails);
  const promoteToAdmin = useGroupStore(s => s.promoteToAdmin);
  const demoteAdmin = useGroupStore(s => s.demoteAdmin);
  const removeMember = useGroupStore(s => s.removeMember);
  const leaveGroup = useGroupStore(s => s.leaveGroup);
  const archiveGroup = useGroupStore(s => s.archiveGroup);
  const deleteGroup = useGroupStore(s => s.deleteGroup);
  const submitQuestion = useGroupStore(s => s.submitQuestion);
  const voteOnMessage = useGroupStore(s => s.voteOnMessage);
  const flagMessageAsSimilar = useGroupStore(s => s.flagMessageAsSimilar);
  const fetchUserVotesForGroup = useGroupStore(s => s.fetchUserVotesForGroup);
  const getSubgroupsWithLevel = useGroupStore(s => s.getSubgroupsWithLevel);
  const getMessagesForGroups = useGroupStore(s => s.getMessagesForGroups);
  const fetchThread = useGroupStore(s => s.fetchThread);
  const applyPeerChatRead = useGroupStore(s => s.applyPeerChatRead);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [messageActionTarget, setMessageActionTarget] = useState<Message | null>(null);
  /** Device-local stars / single pinned message / forward picker target. */
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  /** Filter the chat down to starred messages — stars were unfindable without it. */
  const [starredOnly, setStarredOnly] = useState(false);
  /** The viewer's OWN reactions: { messageId: ['👍'] }. Counts live on the message. */
  const [myReactions, setMyReactions] = useState<Record<string, string[]>>({});
  const [pinnedMessage, setPinnedMessage] = useState<{ id: string; text: string } | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  /** In-chat search over the loaded window, with next/prev jumping. */
  const [msgOverflowOpen, setMsgOverflowOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const [showTestConfig, setShowTestConfig] = useState(false);
  const [testMode, setTestMode] = useState<TestMode>('test');
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showAIGenerate, setShowAIGenerate] = useState(false);
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
  const [threadError, setThreadError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const isNearBottomRef = useRef(true);
  const initialAnchorDoneRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(null);
  const prevMessageCountRef = useRef(0);
  const suppressLoadOlderRef = useRef(true);

  // Keyed on groupId, never on `host` or a route param: the same lounge opened
  // from the Chat tab and from the community must share one wallpaper.
  const wallpaperScopeKey = groupWallpaperScopeKey(groupId);
  const wallpaper = useChatWallpaper(wallpaperScopeKey);
  const [wallpaperSheetOpen, setWallpaperSheetOpen] = useState(false);

  const displayName = groupName || currentGroup?.name || 'Group chat';

  // The one place chat-only screens are reached from. On the community stack
  // those screens do not exist, so hop to the Chat tab (leaving the community
  // is fine for these — they are actions, not reading a channel).
  const chatNavigate = useCallback(
    (screen: string, params?: Record<string, unknown>) => {
      if (host === 'chat') {
        navigation.navigate(screen, params);
      } else {
        navigation.getParent()?.navigate('ChatTab', { screen, params });
      }
    },
    [host, navigation]
  );

  const downloadTest = useOfflineStore(s => s.downloadTest);
  const isDownloadingBundle = useOfflineStore(s => s.isDownloading);

  /**
   * Web parity: the test config modal can save its selection as an offline
   * bundle instead of starting a session. Reuses the same download pipeline
   * as Offline Mode's per-group Customize flow, so the bundle lands in
   * More -> Offline mode and syncs across devices.
   */
  const handleDownloadForOffline = useCallback(
    async (config: TestConfigOptions) => {
      try {
        await downloadTest(
          `test-${groupId}`,
          groupId,
          displayName,
          `${displayName} Practice Test`,
          {
            questionTypes: config.selectedQuestionTypes.length
              ? config.selectedQuestionTypes
              : undefined,
            questionCount: config.numberOfQuestions,
            timeLimit: config.timerDuration ? Math.round(config.timerDuration / 60) : 0,
            shuffleQuestions: true,
            includeExplanations: true,
            lockAnswered: config.lockAnswered,
          },
          user?.id
        );
        setShowTestConfig(false);
        Alert.alert(
          'Downloaded for offline',
          'Find it under More → Offline mode → Downloaded Tests. It works without a connection and syncs to your other devices.'
        );
      } catch (e: unknown) {
        Alert.alert('Download failed', e instanceof Error ? e.message : 'Could not download questions.');
      }
    },
    [downloadTest, groupId, displayName, user?.id]
  );
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
    try {
      const msgs = (await fetchThread(threadRootId, { groupId })) as Message[];
      setThreadMessages(msgs);
      setThreadError(null);
    } catch (error) {
      // Also the Retry path of the thread's ErrorState — it must resolve, not
      // reject, or a failed retry becomes an unhandled rejection.
      setThreadError(
        error instanceof Error ? error.message : 'Could not load this thread.'
      );
    }
  }, [fetchThread, groupId, threadRootId]);

  const handleOpenThread = useCallback(
    async (rootId: string) => {
      setThreadRootId(rootId);
      setThreadLoading(true);
      setThreadError(null);
      try {
        const msgs = (await fetchThread(rootId, { groupId })) as Message[];
        setThreadMessages(msgs);
      } catch (error) {
        // Was: close the modal and show an alert, so the thread vanished with
        // nothing to retry. Keep it open and let the user retry in place.
        setThreadError(
          error instanceof Error ? error.message : 'Could not load this thread.'
        );
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
    const raw = groupMessages || [];
    const visible = raw.filter(
      (msg) =>
        shouldRenderRemovedMessage(msg, raw) &&
        messagePassesQuestionVisibility(msg, questionVisibilityMode)
    );
    // Starred view: same list, filtered — keeps every row action working
    // (reply, jump to thread, unstar) instead of a read-only side panel.
    return starredOnly ? visible.filter((msg) => starredIds.has(msg.id)) : visible;
  }, [groupMessages, questionVisibilityMode, starredOnly, starredIds]);

  // Read by handlers that must not take `displayMessages` as a dependency.
  const displayMessagesRef = useRef(displayMessages);
  displayMessagesRef.current = displayMessages;

  // Only TestConfigModal / ChallengeModal consume the chain below, and both are
  // mounted-but-hidden, so it used to recompute on every incoming message.
  const questionPickerActive = showTestConfig || !!challengeMember;

  const allGroupMessages = useMemo(() => {
    if (!questionPickerActive) return [];
    const combined = [...(groupMessages || [])];
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
  }, [questionPickerActive, groupMessages, cachedGroupMessages, questionVisibilityMode]);

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
        : (groupMessages || []);
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
      await startQuestionSet(sessionName, questions, mode, {
        timeLimitMinutes,
        groupId,
        groupName: displayName,
        lockAnswered: config.lockAnswered,
        // Explicit null from the modal means "no course"; only an absent key
        // falls back to the group's course.
        courseId: config.courseId !== undefined ? config.courseId : currentGroup?.courseId ?? null,
        // Only the modal can supply a topic — the group carries none — and it
        // is dropped unless that same modal also picked the course it sits in.
        topicId: config.courseId !== undefined ? config.topicId ?? null : null,
      });
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

  // Captured at trigger time: the reply target is cleared before the answer
  // comes back, and the answer must still thread onto what was replied to.
  const aiReplyToIdRef = useRef<string | undefined>(undefined);

  const postAiAnswer = useCallback(
    async (answerText: string) => {
      if (!user?.id) return;
      isNearBottomRef.current = true;
      setReplyTo(null);
      await sendMessage(groupId, answerText, user.id, undefined, {
        replyToMessageId: aiReplyToIdRef.current,
      });
      listRef.current?.scrollToEnd({ animated: true });
      setNewMessagesBelow(0);
    },
    [groupId, sendMessage, user?.id]
  );

  const { trySend: tryAiTutorSend, aiThinking } = useAiTutorSend({ onPostAnswer: postAiAnswer });

  const handleSend = async (overrideText?: string) => {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed || !user?.id || sending || aiThinking) return;

    // Same trigger as web: "@AI <question>" or "/ask <question>" answers in-chat
    // instead of posting the question. Not available while editing a message,
    // and not on a community room (§6): AI credits are personal, and a
    // campus-wide lounge is not where they get spent in public. Web strips the
    // same path via `communityHost` in ChatWindow. The text posts as an
    // ordinary message instead, so nothing disappears silently.
    if (host !== 'community' && !editingMessage && parseAiQuery(trimmed)) {
      if (!overrideText) setText('');
      aiReplyToIdRef.current = replyTo?.id;
      const result = await tryAiTutorSend(trimmed);
      if (result === 'failed' && !overrideText) setText(trimmed);
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

  // Stars and the pinned message are device-local (no backend fields yet).
  useEffect(() => {
    if (!user?.id || !groupId) return;
    let cancelled = false;
    void api
      .fetchUserReactionsForGroup(groupId)
      .then((map) => setMyReactions(map || {}))
      .catch(() => {
        /* best effort: chips render unselected until the next open */
      });
    void AsyncStorage.getItem(`lantern_starred_msgs:${user.id}:${groupId}`).then((raw) => {
      if (cancelled || !raw) return;
      try {
        setStarredIds(new Set(JSON.parse(raw) as string[]));
      } catch {
        /* corrupt cache: start clean */
      }
    });
    void AsyncStorage.getItem(`lantern_pinned_msg:${user.id}:${groupId}`).then((raw) => {
      if (cancelled || !raw) return;
      try {
        setPinnedMessage(JSON.parse(raw) as { id: string; text: string });
      } catch {
        /* corrupt cache: start clean */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, groupId]);

  // Long-press ALWAYS opens the sheet now (it used to silently reply for
  // messages you couldn't edit/remove, with no menu and no way to copy text).
  const showMessageActions = useCallback((message: Message) => {
    setMessageActionTarget(message);
  }, []);

  const closeMessageActions = useCallback(() => setMessageActionTarget(null), []);

  useEffect(() => {
    if (!messageActionTarget) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setMessageActionTarget(null);
      return true;
    });
    return () => sub.remove();
  }, [messageActionTarget]);

  // Row handlers, all stable — MessageRow's memo is only worth anything if these
  // keep their identity across composer keystrokes and incoming messages.
  const handleVoteMessage = useCallback(
    (message: Message, vote: 'up' | 'down') => {
      if (!user?.id) return;
      void voteOnMessage(groupId, message.id, user.id, vote);
    },
    [groupId, user?.id, voteOnMessage]
  );

  const handleFlagMessage = useCallback(
    (message: Message) => {
      if (!user?.id) return;
      void flagMessageAsSimilar(message.id, groupId, user.id);
    },
    [flagMessageAsSimilar, groupId, user?.id]
  );

  const handleCopyMessageText = useCallback(async (message: Message) => {
    const textToCopy = (message.questionStem || message.text || '').trim();
    if (!textToCopy) return;
    try {
      await Clipboard.setStringAsync(textToCopy);
      void AccessibilityInfo.announceForAccessibility('Message copied');
    } catch {
      Alert.alert('Copy failed', 'Could not copy the message text.');
    }
  }, []);

  // Community duplicate flag (enough flags auto-hide the message). A content
  // report to Lantern moderation is the separate ReportContentSheet below.
  const flagDuplicateMessage = useCallback(
    (message: Message) => {
      if (!user?.id) return;
      const alreadyFlagged = message.flaggedAsSimilarUserIds?.includes(user.id) ?? false;
      if (alreadyFlagged) {
        Alert.alert(
          'Already flagged',
          'You have already flagged this message as a duplicate for the group to review.'
        );
        return;
      }
      Alert.alert(
        'Flag duplicate?',
        'This flags the message as a duplicate or similar question for the group and its admins to review.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Flag',
            onPress: () => handleFlagMessage(message),
          },
        ]
      );
    },
    [handleFlagMessage, user?.id]
  );
  /** Message being reported to moderation (drives the ReportContentSheet). */
  const [reportTarget, setReportTarget] = useState<Message | null>(null);

  // Sheet actions all dismiss the sheet first. Remove/Report then open a
  // confirm Alert, deferred so the sheet Modal is gone before it shows — iOS
  // will not present an Alert stacked underneath a visible Modal.
  const handleSheetReply = useCallback(
    (message: Message) => {
      setMessageActionTarget(null);
      beginReply(message);
    },
    [beginReply]
  );
  const handleSheetCopy = useCallback(
    (message: Message) => {
      setMessageActionTarget(null);
      void handleCopyMessageText(message);
    },
    [handleCopyMessageText]
  );
  const handleSheetEdit = useCallback(
    (message: Message) => {
      setMessageActionTarget(null);
      beginEdit(message);
    },
    [beginEdit]
  );
  const handleSheetRemove = useCallback(
    (message: Message) => {
      setMessageActionTarget(null);
      setTimeout(() => confirmRemoveMessage(message), Platform.OS === 'ios' ? 320 : 0);
    },
    [confirmRemoveMessage]
  );
  const handleSheetFlagDuplicate = useCallback(
    (message: Message) => {
      setMessageActionTarget(null);
      setTimeout(() => flagDuplicateMessage(message), Platform.OS === 'ios' ? 320 : 0);
    },
    [flagDuplicateMessage]
  );
  const handleSheetReport = useCallback((message: Message) => {
    setMessageActionTarget(null);
    setTimeout(() => setReportTarget(message), Platform.OS === 'ios' ? 320 : 0);
  }, []);
  const handleSheetForward = useCallback((message: Message) => {
    setMessageActionTarget(null);
    setTimeout(() => setForwardMessage(message), Platform.OS === 'ios' ? 320 : 0);
  }, []);
  const handleToggleReaction = useCallback(
    async (message: Message, emoji: string, added: boolean) => {
      const previousMine = myReactions[message.id] ? [...myReactions[message.id]] : [];
      const previousCounts = message.reactions;
      setMyReactions((prev) => {
        const mine = new Set(prev[message.id] || []);
        if (added) mine.add(emoji);
        else mine.delete(emoji);
        return { ...prev, [message.id]: [...mine] };
      });
      // Optimistic count so the tap feels instant; the server's authoritative
      // numbers (and everyone else's) arrive over the existing realtime channel.
      patchMessageInState(message.id, {
        reactions: applyReactionLocally(previousCounts, emoji, added),
      });
      try {
        const result = added
          ? await api.addMessageReaction(message.id, emoji)
          : await api.removeMessageReaction(message.id, emoji);
        patchMessageInState(message.id, { reactions: result?.reactions ?? {} });
      } catch (error) {
        setMyReactions((prev) => ({ ...prev, [message.id]: previousMine }));
        patchMessageInState(message.id, { reactions: previousCounts });
        useToastStore
          .getState()
          .showToast(
            error instanceof Error ? error.message : 'Could not save that reaction',
            'error'
          );
      }
    },
    [myReactions, patchMessageInState]
  );

  const handleSheetStar = useCallback(
    (message: Message) => {
      setMessageActionTarget(null);
      if (!user?.id) return;
      const next = new Set(starredIds);
      const starring = !next.has(message.id);
      if (starring) next.add(message.id);
      else next.delete(message.id);
      setStarredIds(next);
      void AsyncStorage.setItem(
        `lantern_starred_msgs:${user.id}:${groupId}`,
        JSON.stringify([...next])
      );
      useToastStore
        .getState()
        .showToast(starring ? 'Message starred' : 'Star removed', 'success');
    },
    [groupId, user?.id, starredIds]
  );
  const handleSheetPin = useCallback(
    (message: Message) => {
      setMessageActionTarget(null);
      if (!user?.id) return;
      const unpinning = pinnedMessage?.id === message.id;
      const next = unpinning
        ? null
        : { id: message.id, text: (message.questionStem || message.text || '').trim() };
      setPinnedMessage(next);
      const key = `lantern_pinned_msg:${user.id}:${groupId}`;
      if (next) void AsyncStorage.setItem(key, JSON.stringify(next));
      else void AsyncStorage.removeItem(key);
      useToastStore
        .getState()
        .showToast(unpinning ? 'Unpinned' : 'Pinned in this chat', 'success');
    },
    [groupId, user?.id, pinnedMessage]
  );
  const handleUnpinFromBanner = useCallback(() => {
    if (user?.id) {
      void AsyncStorage.removeItem(`lantern_pinned_msg:${user.id}:${groupId}`);
    }
    setPinnedMessage(null);
  }, [groupId, user?.id]);

  const handleMentionUser = useCallback((username: string) => {
    setSeedMentionUsername(username);
  }, []);

  // Reads the list through a ref so the handler identity does not change on
  // every new message — which would re-render every row it is passed to.
  const handleScrollToMessage = useCallback((messageId: string) => {
    const index = displayMessagesRef.current.findIndex((m) => m.id === messageId);
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
    }
  }, []);

  const handleRetryMessage = useCallback(
    (message: Message) => {
      if (!user?.id) return;
      void retryFailedMessage(groupId, message.id, user.id).catch(() => undefined);
    },
    [groupId, retryFailedMessage, user?.id]
  );

  const sendImageMarkdown = useCallback(
    async (markdown: string) => {
      if (!user?.id) return;
      await sendMessage(
        groupId,
        markdown,
        user.id,
        user.user_metadata?.full_name || user.email || 'User',
        { replyToMessageId: replyTo?.id }
      );
      setReplyTo(null);
    },
    [groupId, replyTo?.id, sendMessage, user?.id, user?.email, user?.user_metadata?.full_name]
  );

  const attachImage = useChatImageAttach({
    chatId: groupId,
    onSendMarkdown: sendImageMarkdown,
    enabled: !!user?.id,
  });

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

  const group = currentGroup;
  const isAdmin =
    group?.ownerId === user?.id || group?.adminIds?.includes(user?.id || '') || false;
  const memberCount = group?.memberCount || group?.members?.length || 0;
  // Handed to every bubble in place of the per-row store subscription it used to
  // hold. Stable while the roster is: the store replaces this array only on fetch.
  const groupMembers = group?.members;

  // MessageRow is memoized and reads none of these from the store, so FlatList
  // needs them here — without it a vote, the unread divider or a sign-in change
  // silently fails to repaint rows that are already mounted.
  const listExtraData = useMemo(
    () => ({
      userVotes,
      firstUnreadId,
      userId: user?.id,
      members: groupMembers,
      starredIds,
      // The rows are memoized: without this the selection highlight never paints.
      actionTargetId: messageActionTarget?.id,
      starredOnly,
      myReactions,
    }),
    [
      userVotes,
      firstUnreadId,
      user?.id,
      groupMembers,
      starredIds,
      messageActionTarget?.id,
      starredOnly,
      myReactions,
    ]
  );

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
    // Founder decision 1 (2026-09-02): the community lounge is a chat WITHOUT
    // the study/test apparatus, so the coach-marks that anchor to the
    // add-question "+", Study mode, Test mode and AI generate must not arm —
    // a tip pointing at an element that is not rendered is a visible bug.
    if (host === 'community') return undefined;
    const { setTipAllowed, setTipReady } = useFeatureTipStore.getState();
    setTipReady('chat.question', true);
    setTipReady('chat.test', true);
    setTipReady('chat.study', true);
    setTipReady('chat.aiGenerate', true);
    setTipAllowed('chat.aiGenerate', isAdmin);
    return () => {
      setTipReady('chat.question', false);
      setTipReady('chat.test', false);
      setTipReady('chat.study', false);
      setTipReady('chat.aiGenerate', false);
      setTipAllowed('chat.aiGenerate', false);
    };
  }, [isAdmin, host]);

  const handleBack = useCallback(() => {
    // On the community stack the community always sits underneath.
    if (host === 'community') {
      navigation.goBack();
      return;
    }
    // canGoBack() also reports the parent tab's history, so a chat opened from a
    // notification or deep link would pop out of chat entirely. Only pop when a
    // chat screen actually sits underneath.
    const hasScreenBelow = (navigation.getState?.()?.index ?? 0) > 0;
    if (hasScreenBelow) {
      navigation.goBack();
    } else {
      navigation.navigate('GroupsList');
    }
  }, [host, navigation]);

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

  const muteUntilLabel = formatMuteUntilLabel(chatMutedUntil);
  const isArchived = !!group?.isArchived;

  const msgOverflowItems: ActionSheetItem[] = useMemo(() => {
    const message = messageActionTarget;
    if (!message) return [];
    const isOwn = !!user?.id && message.senderId === user.id;
    const items: ActionSheetItem[] = [];
    if (canEditChatMessage(message, user?.id)) {
      items.push({
        label: 'Edit',
        icon: 'create-outline',
        onPress: () => handleSheetEdit(message),
      });
    }
    // Remove is no longer listed here — it is a first-class Delete button in
    // the action bar (duplicating it made the overflow the only path when the
    // bar's other actions were unavailable).
    if (studySurface && !isOwn && message.type === 'question') {
      items.push({
        label: 'Flag duplicate',
        icon: 'copy-outline',
        onPress: () => handleSheetFlagDuplicate(message),
      });
    }
    if (!isOwn) {
      items.push({
        label: 'Report message',
        icon: 'flag-outline',
        onPress: () => handleSheetReport(message),
      });
    }
    return items;
  }, [
    messageActionTarget,
    user?.id,
    studySurface,
    handleSheetEdit,
    handleSheetRemove,
    handleSheetFlagDuplicate,
    handleSheetReport,
  ]);

  const chatSearchMatches = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!chatSearchOpen || q.length < 2) return [] as string[];
    return displayMessages
      .filter((m) => (m.questionStem || m.text || '').toLowerCase().includes(q))
      .map((m) => m.id);
  }, [chatSearchOpen, chatSearchQuery, displayMessages]);

  const jumpToChatMatch = useCallback(
    (nextIndex: number) => {
      if (chatSearchMatches.length === 0) return;
      const wrapped = (nextIndex + chatSearchMatches.length) % chatSearchMatches.length;
      setChatSearchIndex(wrapped);
      handleScrollToMessage(chatSearchMatches[wrapped]);
    },
    [chatSearchMatches, handleScrollToMessage]
  );

  const closeChatSearch = useCallback(() => {
    setChatSearchOpen(false);
    setChatSearchQuery('');
    setChatSearchIndex(0);
  }, []);

  const headerMenuActions = useMemo((): GroupChatHeaderAction[] => {
    // The community lounge keeps this chat UI but loses every study/test
    // affordance (founder decision 1): questions, tests, games, challenges and
    // sub-group creation live in a STUDY GROUP now, which opens in Chat.
    const practice: GroupChatHeaderAction[] = studySurface
      ? [
      // Practice — Study / Test are the primary entry points, so they lead.
      // Gated while archived: an archived group is read-only.
      {
        id: 'study',
        label: 'Study mode',
        icon: 'library-outline',
        section: 'Practice',
        // Read-only practice over existing questions stays available when
        // archived — only write paths (add question, AI generate) are gated.
        onPress: () => {
          setTestMode('study');
          setShowTestConfig(true);
        },
      },
      {
        id: 'test',
        label: 'Test mode',
        icon: 'clipboard-outline',
        section: 'Practice',
        onPress: () => {
          setTestMode('test');
          setShowTestConfig(true);
        },
      },
        ]
      : [];

    const actions: GroupChatHeaderAction[] = [
      ...practice,
      // View — display preferences & insights. Nested under All questions so
      // Verified / Unverified / Hide all are not top-level siblings.
      {
        id: 'search-messages',
        label: 'Search messages',
        icon: 'search-outline',
        section: 'View',
        onPress: () => setChatSearchOpen(true),
      },
      {
        // Stars were write-only before this: you could star a message and had
        // no way to get back to it short of scrolling the whole history.
        id: 'starred-messages',
        label: starredOnly
          ? 'Show all messages'
          : `Starred messages${starredIds.size > 0 ? ` (${starredIds.size})` : ''}`,
        icon: starredOnly ? 'star' : 'star-outline',
        iconColor: starredOnly ? '#f59e0b' : undefined,
        section: 'View',
        disabled: !starredOnly && starredIds.size === 0,
        onPress: () => {
          setStarredOnly((on) => !on);
          setChatSearchOpen(false);
        },
      },
      {
        // Deliberately NOT gated on studySurface: a community lounge is a
        // transcript and keeps the feature.
        id: 'chat-background',
        label: 'Chat background',
        icon: 'image-outline',
        section: 'View',
        // GroupChatHeader closes its menu and calls onPress synchronously, and
        // iOS will not present a Modal under one that is still dismissing.
        onPress: () =>
          setTimeout(() => setWallpaperSheetOpen(true), Platform.OS === 'ios' ? 320 : 0),
      },
      ...(studySurface
        ? [
            {
              id: 'question-filter',
              label: 'All questions',
              icon: 'filter-outline' as const,
              section: 'View',
              submenu: {
                title: 'All questions',
                options: QUESTION_VISIBILITY_MODE_OPTIONS.map((opt) => ({
                  id: `qvis-${opt.value}`,
                  label: opt.label,
                  helper: opt.helper,
                  icon: 'filter-outline' as const,
                  selected: questionVisibilityMode === opt.value,
                  onPress: () => setQuestionVisibilityMode(opt.value),
                })),
              },
            },
          ]
        : []),
      // Notifications.
      chatMuted
        ? {
            id: 'unmute',
            label: muteUntilLabel ? `Unmute (until ${muteUntilLabel})` : 'Unmute notifications',
            icon: 'notifications-outline' as const,
            section: 'Notifications',
            onPress: () => void clearMute(),
            disabled: muteBusy,
          }
        : {
            id: 'mute',
            label: 'Mute',
            icon: 'notifications-off-outline' as const,
            section: 'Notifications',
            disabled: muteBusy,
            submenu: {
              title: 'Mute',
              options: CHAT_MUTE_DURATIONS.map((opt) => ({
                id: `mute-${opt.id}`,
                label: opt.label,
                icon: 'notifications-off-outline' as const,
                onPress: () => void applyMute(opt.id),
              })),
            },
          },
      // Manage.
      {
        id: 'info',
        label: 'About group',
        icon: 'people-outline',
        section: 'Manage',
        onPress: () => setShowGroupInfo(true),
      },
    ];

    if (isAdmin && studySurface) {
      actions.push({
        id: 'ai-generate',
        label: 'AI generate questions',
        icon: 'bulb-outline',
        iconColor: colors.warning,
        section: 'Manage',
        // Also an add-question path — no posting into an archived group.
        disabled: isArchived,
        onPress: () => setShowAIGenerate(true),
      });
    }

    return actions;
  }, [
    host,
    isAdmin,
    isArchived,
    colors.warning,
    questionVisibilityMode,
    setQuestionVisibilityMode,
    chatMuted,
    muteUntilLabel,
    muteBusy,
    clearMute,
    applyMute,
    starredOnly,
    starredIds,
  ]);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top', 'bottom']}>
      {messageActionTarget ? (
        <>
        <ReactionPickerRow
          mine={myReactions[messageActionTarget.id]}
          onPick={(emoji, added) => {
            const target = messageActionTarget;
            setMessageActionTarget(null);
            void handleToggleReaction(target, emoji, added);
          }}
        />
        <MessageActionBar
          onClose={closeMessageActions}
          onReply={() => handleSheetReply(messageActionTarget)}
          onForward={
            (messageActionTarget.questionStem || messageActionTarget.text || '').trim() &&
            !isChatAudioMessage(messageActionTarget.text) &&
            !isChatImageMessage(messageActionTarget.text)
              ? () => handleSheetForward(messageActionTarget)
              : undefined
          }
          onCopy={
            (messageActionTarget.questionStem || messageActionTarget.text || '').trim() &&
            !isChatAudioMessage(messageActionTarget.text) &&
            !isChatImageMessage(messageActionTarget.text)
              ? () => handleSheetCopy(messageActionTarget)
              : undefined
          }
          onStar={() => handleSheetStar(messageActionTarget)}
          onPin={() => handleSheetPin(messageActionTarget)}
          starred={starredIds.has(messageActionTarget.id)}
          pinned={pinnedMessage?.id === messageActionTarget.id}
          // Delete is first-class now (web has always had a one-click trash).
          // It used to live only inside the overflow sheet, whose button is
          // hidden when the sheet would be empty — so for an own message with
          // nothing else applicable, delete vanished entirely.
          onDelete={
            canRemoveChatMessage(messageActionTarget, user?.id)
              ? () => handleSheetRemove(messageActionTarget)
              : undefined
          }
          deleteBlockedReason={deleteBlockedReason(messageActionTarget, user?.id)}
          onMore={msgOverflowItems.length > 0 ? () => setMsgOverflowOpen(true) : undefined}
        />
        </>
      ) : (
      <GroupChatHeader
        displayName={displayName}
        avatarUrl={group?.avatarUrl}
        memberCount={memberCount}
        lowDataMode={lowDataMode}
        onBack={handleBack}
        onAddQuestion={() => setShowQuestionModal(true)}
        // Archived groups are read-only: hide the add-question "+". The
        // community lounge hides it for good (founder decision 1) — questions
        // are posted in a study group now.
        addQuestionDisabled={isArchived || host === 'community'}
        onTitlePress={() => setShowGroupInfo(true)}
        menuActions={headerMenuActions}
        contextLabel={communityContext?.label}
        onContextPress={communityContext?.onPress}
      />
      )}

      {chatSearchOpen ? (
        <View className="flex-row items-center gap-2 px-3 py-2 border-b border-lantern-border bg-lantern-surface">
          <Ionicons name="search" size={16} color={colors.inputPlaceholder} />
          <TextInput
            value={chatSearchQuery}
            onChangeText={(v) => {
              setChatSearchQuery(v);
              setChatSearchIndex(0);
            }}
            placeholder="Search this chat…"
            placeholderTextColor={colors.inputPlaceholder}
            autoFocus
            autoCorrect={false}
            className="flex-1 text-sm text-lantern-text py-1"
            accessibilityLabel="Search messages in this chat"
          />
          <Text className="text-xs text-lantern-text-secondary">
            {chatSearchMatches.length > 0
              ? `${chatSearchIndex + 1}/${chatSearchMatches.length}`
              : chatSearchQuery.trim().length >= 2
                ? '0'
                : ''}
          </Text>
          <Pressable
            onPress={() => jumpToChatMatch(chatSearchIndex + 1)}
            hitSlop={6}
            accessibilityLabel="Previous match"
            disabled={chatSearchMatches.length === 0}
          >
            <Ionicons name="chevron-up" size={20} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => jumpToChatMatch(chatSearchIndex - 1)}
            hitSlop={6}
            accessibilityLabel="Next match"
            disabled={chatSearchMatches.length === 0}
          >
            <Ionicons name="chevron-down" size={20} color={colors.text} />
          </Pressable>
          <Pressable onPress={closeChatSearch} hitSlop={6} accessibilityLabel="Close search">
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}

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

      {starredOnly ? (
        <View className="flex-row items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-900/40">
          <Ionicons name="star" size={14} color="#f59e0b" />
          <Text className="flex-1 text-[12px] font-semibold text-amber-800 dark:text-amber-300">
            Starred messages ({displayMessages.length})
          </Text>
          <Pressable
            onPress={() => setStarredOnly(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Show all messages"
            className="px-2 py-1"
          >
            <Text className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              Show all
            </Text>
          </Pressable>
        </View>
      ) : null}

      {pinnedMessage ? (
        <Pressable
          onPress={() => handleScrollToMessage(pinnedMessage.id)}
          // pr-14 keeps the unpin button clear of the floating sync chip, which
          // the shell parks at the top-right of every screen.
          className="flex-row items-center gap-2 pl-3 pr-14 py-2 bg-lantern-primary-background border-b border-lantern-border"
          accessibilityRole="button"
          accessibilityLabel="Jump to pinned message"
        >
          <Ionicons name="pin" size={14} color={colors.primary} />
          <Text className="flex-1 text-[12px] text-lantern-text" numberOfLines={1}>
            {pinnedMessage.text || 'Pinned message'}
          </Text>
          <Pressable onPress={handleUnpinFromBanner} hitSlop={8} accessibilityLabel="Unpin message">
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        </Pressable>
      ) : null}

      <KeyboardAvoidingView className="flex-1" behavior={COMPOSER_KEYBOARD_BEHAVIOR}>
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
          <View className="flex-1 relative" style={{ backgroundColor: colors.chatBackground }}>
          {/* Absolutely-positioned SIBLING of the list — never inside it. */}
          <ChatWallpaperLayer
            uri={wallpaper.uri}
            scrimColor={wallpaper.scrimColor}
            onError={wallpaper.onImageError}
          />
          {/* Nothing else says the picked photo is being prepared: the sheet
              dismissed before the work started. */}
          <ChatWallpaperBusyOverlay />
          <FlatList
            ref={listRef}
            data={displayMessages}
            keyExtractor={item => item.id}
            {...CHAT_LIST_WINDOWING}
            className="flex-1"
            style={{ backgroundColor: wallpaper.listBackgroundColor }}
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
              <View className="flex-1 items-center justify-center py-16 px-8">
                <View
                  className={wallpaper.active ? 'px-4 py-3 rounded-2xl' : undefined}
                  style={wallpaper.pillStyle}
                >
                  <Text className="text-sm text-center text-lantern-text-secondary">
                    {starredOnly
                      ? 'No starred messages in this chat yet. Long-press a message and tap the star to keep it here.'
                      : 'No messages yet. Say hello!'}
                  </Text>
                </View>
              </View>
            }
            // MessageRow closes over none of these, so the list must be told
            // when they change or votes / the unread divider go stale.
            extraData={listExtraData}
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
                <MessageRow
                  message={item}
                  isOwn={item.senderId === user?.id}
                  userVote={userVotes[item.id]}
                  memberCount={memberCount}
                  members={groupMembers}
                  flagCount={item.flaggedAsSimilarUserIds?.length ?? 0}
                  userFlagged={
                    user?.id ? item.flaggedAsSimilarUserIds?.includes(user.id) ?? false : false
                  }
                  canFlag={studySurface && item.senderId !== user?.id}
                  canVote={studySurface && !!user?.id}
                  dateLabel={showDate ? formatChatDateLabel(item.createdAt) : null}
                  showUnreadDivider={showUnreadDivider}
                  isGroupedWithPrevious={isGroupedWithPrevious}
                  wallpaperPillStyle={wallpaper.pillStyle}
                  onVoteMessage={handleVoteMessage}
                  onFlagMessage={handleFlagMessage}
                  onReply={showMessageActions}
                  onSwipeReply={beginReply}
                  onMentionUser={handleMentionUser}
                  onScrollToMessage={handleScrollToMessage}
                  onOpenThread={handleOpenThread}
                  onRetry={handleRetryMessage}
                  starred={starredIds.has(item.id)}
                  selected={messageActionTarget?.id === item.id}
                  myReactions={myReactions[item.id]}
                  onToggleReaction={handleToggleReaction}
                />
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
          onAttachImage={attachImage}
        />
        )}
      </KeyboardAvoidingView>

      <ActionSheet
        visible={msgOverflowOpen}
        title="More"
        items={msgOverflowItems.map((item) => ({
          ...item,
          onPress: () => {
            setMsgOverflowOpen(false);
            item.onPress();
          },
        }))}
        onClose={() => setMsgOverflowOpen(false)}
      />
      <ChatWallpaperSheet
        visible={wallpaperSheetOpen}
        onClose={() => setWallpaperSheetOpen(false)}
        scope={wallpaperScopeKey}
        scopeLabel="this chat"
      />
      <ForwardMessageSheet
        visible={!!forwardMessage}
        onClose={() => setForwardMessage(null)}
        messageText={(forwardMessage?.questionStem || forwardMessage?.text || '').trim()}
      />
      <ReportContentSheet
        visible={!!reportTarget}
        targetType="message"
        targetId={reportTarget?.id ?? ''}
        targetLabel={(reportTarget?.questionStem || reportTarget?.text || '').trim().slice(0, 120) || undefined}
        onClose={() => setReportTarget(null)}
      />

      <TestConfigModal
        visible={showTestConfig}
        onClose={() => setShowTestConfig(false)}
        onDownload={handleDownloadForOffline}
        isDownloading={isDownloadingBundle}
        mode={testMode}
        defaultCourseId={currentGroup?.courseId ?? null}
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
          onUpdateDetails={(id, name, description, discovery) => void updateGroupDetails(id, name, description, discovery)}
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
          // Replaced by "Start a study group" on the community page: a
          // sub-group passes no communityId, so one made here would be
          // invisible to its community forever (§6).
          hideStudyActions={host === 'community'}
          onCreateSubgroup={
            host === 'community'
              ? undefined
              : () => {
                  setShowGroupInfo(false);
                  chatNavigate('CreateGroup', { parentId: groupId, parentName: displayName });
                }
          }
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
          inviteId={currentGroup?.inviteId}
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
            chatNavigate('GameScreen', {});
          }}
        />
      ) : null}

      <ChatThreadModal
        visible={!!threadRootId}
        wallpaperScopeKey={wallpaperScopeKey}
        onClose={() => {
          setThreadRootId(null);
          setThreadMessages([]);
          setThreadError(null);
        }}
        rootId={threadRootId}
        loading={threadLoading}
        loadError={threadError}
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
        members={groupMembers}
        mentionCandidates={mentionCandidates}
        userVotes={userVotes}
        onVote={
          studySurface
            ? (messageId, vote) => {
                if (!user?.id) return;
                void voteOnMessage(groupId, messageId, user.id, vote);
              }
            : undefined
        }
        onFlag={
          studySurface
            ? messageId => {
                if (!user?.id) return;
                void flagMessageAsSimilar(messageId, groupId, user.id);
              }
            : undefined
        }
        canFlag={msg => studySurface && msg.senderId !== user?.id}
        userFlagged={msg => (user?.id ? msg.flaggedAsSimilarUserIds?.includes(user.id) ?? false : false)}
        groupId={groupId}
      />
    </SafeAreaView>
  );
}

/**
 * The Chat tab's group chat. When the group is a community channel the header
 * carries `in <Community> ›`, which jumps to the community on the Market tab
 * (the one allowed cross-tab hop, spec §0a). The slug/name come from the
 * route when the channel was opened from the community, otherwise from the
 * membership list via the group's `communityId`.
 */
export function GroupChatScreen({ navigation, route }: Props) {
  const { groupId, groupName, openAddMembers, communitySlug, communityName } = route.params;
  const resolvedGroup = useGroupStore(s => s.groups.find(g => g.id === groupId));
  const currentGroupCommunityId = useGroupStore(s => s.currentGroup?.communityId ?? null);
  const groupCommunityId = resolvedGroup?.communityId ?? currentGroupCommunityId;
  const loadMine = useCommunityStore(s => s.loadMine);
  // Subscribe to the ARRAY, then derive. `selectMyCommunity` builds a fresh
  // `{ slug, name }` on every call, and a zustand selector that returns a new
  // object every render makes React see a changed snapshot forever: opening a
  // chat that belongs to a community froze the app until it was killed.
  const myCommunities = useCommunityStore(s => s.myCommunities);
  const fromMine = useMemo(
    () => findMyCommunity(myCommunities, groupCommunityId),
    [myCommunities, groupCommunityId]
  );

  // Settles once the membership list has been fetched (or failed) for this
  // open. Until then a group that belongs to a community has no decidable
  // surface, and guessing "board" for the lounge is the one unrecoverable
  // mistake — so this screen waits instead of guessing.
  const [membershipSettled, setMembershipSettled] = useState(false);
  useEffect(() => {
    if (!groupCommunityId) {
      setMembershipSettled(true);
      return;
    }
    // A group that resolves its community late (the row arrives after the
    // screen mounts) must go back to waiting, not keep the answer it gave
    // while it looked like a plain chat.
    setMembershipSettled(false);
    let cancelled = false;
    void loadMine()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setMembershipSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [groupCommunityId, loadMine]);

  const resolved =
    communitySlug && communityName ? { slug: communitySlug, name: communityName } : fromMine;

  // §4.5 — the Chat-tab bypass. A board group also appears in GET /groups, so
  // a deep link, a notification or an old route could still open it here as a
  // chat with the whole study surface. Send it to the board instead and render
  // nothing meanwhile. The lounge is exempt: it IS a chat (founder decision 1).
  const detailBySlug = useCommunityStore(s => s.detailBySlug);
  const channelsById = useCommunityStore(s => s.channelsById);
  const knownLounges = useMemo(
    () => collectKnownLounges(detailBySlug, channelsById, myCommunities),
    [detailBySlug, channelsById, myCommunities]
  );
  const isLounge = knownLounges.loungeGroupIds.has(groupId);
  const isBoard = !!resolvedGroup && isCommunityBoardGroupIn(resolvedGroup, knownLounges);
  // A community group whose lounge pointer has not arrived yet is neither: a
  // deep link or a notification lands here with nothing but a group id, and
  // rendering the chat meanwhile would reopen the §4.5 bypass for a board
  // while rendering the board would strip the lounge of its chat.
  const surfaceUndecided =
    !!groupCommunityId &&
    !membershipSettled &&
    !knownLounges.resolvedCommunityIds.has(groupCommunityId);

  useEffect(() => {
    if (!isBoard) return;
    navigation.getParent()?.navigate('MarketTab', {
      screen: 'CommunityChannel',
      params: {
        groupId,
        groupName: groupName ?? resolvedGroup?.name,
        communitySlug: resolved?.slug,
        communityName: resolved?.name,
        communityId: groupCommunityId ?? undefined,
        // We have already resolved the surface here; hand the answer over so
        // the router never has to guess it from a missing slug.
        isLounge: false,
      },
    });
    // Leave no chat screen underneath for hardware back to return to.
    const hasScreenBelow = (navigation.getState?.()?.index ?? 0) > 0;
    if (hasScreenBelow) navigation.goBack();
    else navigation.navigate('GroupsList');
  }, [
    isBoard,
    navigation,
    groupId,
    groupName,
    resolvedGroup?.name,
    resolved?.slug,
    resolved?.name,
    groupCommunityId,
  ]);

  const communityContext = useMemo(() => {
    if (!resolved) return null;
    return {
      label: COMMUNITY_COPY.inCommunity(resolved.name),
      onPress: () =>
        navigation.getParent()?.navigate('MarketTab', {
          screen: 'CommunityDetail',
          params: { slug: resolved.slug },
        }),
    };
  }, [resolved?.slug, resolved?.name, navigation]);

  if (isBoard || surfaceUndecided) return null;

  return (
    <GroupChatView
      groupId={groupId}
      groupName={groupName}
      openAddMembers={openAddMembers}
      navigation={navigation}
      // The surface is decided by the GROUP, never by which screen mounted it
      // (§0). The lounge is a live chat wherever it is opened, but it is
      // ALWAYS stripped of the study/test apparatus (founder decision 1) — so
      // reaching it from the Chat tab must not restore Study, Test, the
      // question tray, AI generate, sub-groups or Challenge. Web derives the
      // same thing from the group inside `ChatWindow`.
      host={isLounge ? 'community' : 'chat'}
      communityContext={communityContext}
    />
  );
}

export default GroupChatScreen;

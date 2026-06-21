import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores';
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
import { useTheme } from '../../theme';
import { selectGroupQuestions, extractTagsFromQuestions, countMatchingQuestions } from '../../utils/questionHelpers';
import { summarizeGroupChat } from '../../services/ai';
import * as api from '../../services/api';

type NavigationProp = {
  goBack: () => void;
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

function ChatDateSeparator({ label }: { label: string }) {
  if (!label) return null;
  return (
    <View className="items-center my-3">
      <View className="px-3 py-1 rounded-full bg-slate-200/80 dark:bg-slate-700/80">
        <Text className="text-[11px] font-medium text-slate-600 dark:text-slate-300">{label}</Text>
      </View>
    </View>
  );
}

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
    messages,
    currentGroup,
    isLoading,
    userVotes,
    groups,
    selectGroup,
    fetchMessages,
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
  const listRef = useRef<FlatList<Message>>(null);

  const displayName = groupName || currentGroup?.name || 'Group chat';
  const messageLimit = lowDataMode ? 30 : 100;
  const availableSubgroups = useMemo(
    () => getSubgroupsWithLevel(groupId).map(({ group, level }) => ({
      id: group.id,
      name: group.name,
      level,
    })),
    [groupId, getSubgroupsWithLevel, groups]
  );

  const allGroupMessages = useMemo(() => {
    const combined = [...messages];
    const seen = new Set(messages.map(m => m.id));
    for (const msg of cachedGroupMessages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        combined.push(msg);
      }
    }
    return combined;
  }, [messages, cachedGroupMessages]);

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
    selectGroup(groupId);
    await Promise.all([
      fetchMessages(groupId, { page: 1, refresh: true, limit: messageLimit }),
      markGroupAsRead(groupId, user.id),
      fetchUserVotesForGroup(groupId, user.id),
    ]);
  }, [user?.id, groupId, selectGroup, fetchMessages, markGroupAsRead, fetchUserVotesForGroup, messageLimit]);

  useEffect(() => {
    void loadChat();
  }, [loadChat]);

  useEffect(() => {
    if (!openAddMembers) return;
    setShowAddMembers(true);
    navigation.setParams({ openAddMembers: undefined });
  }, [openAddMembers, navigation]);

  const launchSession = async (config: TestConfigOptions, mode: TestMode) => {
    const subgroupIds = config.selectedSubgroupIds || [];
    const sourceGroupIds = [groupId, ...subgroupIds.filter(id => id !== groupId)];
    const sessionMessages = await getMessagesForGroups(sourceGroupIds);
    const combinedMessages = sessionMessages.length ? sessionMessages : messages;

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
    try {
      await sendMessage(groupId, trimmed, user.id, user.user_metadata?.full_name || user.email || 'User');
    } finally {
      setSending(false);
    }
  };

  const handleSummarize = async () => {
    if (!user?.id || summarizing) return;
    setSummarizing(true);
    try {
      const chatLines = messages
        .slice(-50)
        .map(m => `${m.senderName}: ${m.questionStem || m.text}`)
        .filter(Boolean);
      const result = await summarizeGroupChat(chatLines, displayName);
      Alert.alert('Chat summary', result?.summary || 'Summary unavailable.');
    } catch {
      Alert.alert('Error', 'Failed to summarize chat.');
    } finally {
      setSummarizing(false);
    }
  };

  const handleQuestionSubmit = async (question: any) => {
    if (!user?.id) return;
    try {
      await submitQuestion(groupId, mapModalQuestionToPayload(question, user.id, user.user_metadata?.full_name || 'You'));
      setShowQuestionModal(false);
      await fetchMessages(groupId, { page: 1, refresh: true, limit: messageLimit });
    } catch {
      Alert.alert('Error', 'Failed to submit question.');
    }
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
    ? `https://lanternstudy.app/join?inviteId=${(currentGroup as any).inviteId || currentGroup.id}`
    : '';

  const group = currentGroup;
  const isAdmin =
    group?.ownerId === user?.id || group?.adminIds?.includes(user?.id || '') || false;
  const memberCount = group?.memberCount || group?.members?.length || 0;

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
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top', 'bottom']}>
      <GroupChatHeader
        displayName={displayName}
        memberCount={memberCount}
        lowDataMode={lowDataMode}
        onBack={() => navigation.goBack()}
        onAddQuestion={() => setShowQuestionModal(true)}
        menuActions={headerMenuActions}
      />

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {isLoading && messages.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            contentContainerClassName="px-4 py-4 flex-grow"
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-16">
                <Text className="text-sm text-slate-500">No messages yet. Say hello!</Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const previous = index > 0 ? messages[index - 1] : undefined;
              const showDate =
                index === 0 ||
                (previous && isDifferentChatDay(previous.createdAt, item.createdAt));

              return (
                <View>
                  {showDate ? (
                    <ChatDateSeparator label={formatChatDateLabel(item.createdAt)} />
                  ) : null}
                  <MessageBubble
                    message={item}
                    isOwn={item.senderId === user?.id}
                    userVote={userVotes[item.id]}
                    memberCount={memberCount}
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
        )}

        <ChatComposer
          value={text}
          onChangeText={setText}
          onSend={() => void handleSend()}
          sending={sending}
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
          onQuestionsGenerated={() => {
            setShowAIGenerate(false);
            void fetchMessages(groupId, { page: 1, refresh: true, limit: messageLimit });
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

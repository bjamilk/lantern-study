// ===========================================
// Lantern Study Mobile - Group Chat Screen
// ===========================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useGroupStore, type Message, type GroupMember } from '../../stores/groupStore';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore, GameUser, GameSession } from '../../stores';
import { useTheme } from '../../theme';
import GroupInfoModal from '../../components/GroupInfoModal';
import AddMembersModal from '../../components/AddMembersModal';
import QuestionModal from '../../components/QuestionModal';
import ChallengeModal from '../../components/ChallengeModal';
import AITutorModal from '../../components/AITutorModal';
import AIGenerateQuestionsModal from '../../components/AIGenerateQuestionsModal';
import AIUsageBadge from '../../components/AIUsageBadge';

export default function GroupChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { groupId, groupName } = route.params;
  
  const [messageText, setMessageText] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [showChallengeModal, setShowChallengeModal] = useState(false);
  const [showAITutor, setShowAITutor] = useState(false);
  const [showAIGenerateQuestions, setShowAIGenerateQuestions] = useState(false);
  const [challengeOpponent, setChallengeOpponent] = useState<GameUser | null>(null);
  const flatListRef = useRef<FlatList>(null);
  
  const { user } = useAuthStore();
  const { colors } = useTheme();
  const { 
    currentGroup, 
    messages, 
    isLoading, 
    selectGroup, 
    fetchMessages, 
    sendMessage,
    updateGroupDetails,
    promoteToAdmin,
    demoteAdmin,
    removeMember,
    archiveGroup,
    deleteGroup,
    inviteByEmail,
  } = useGroupStore();

  useEffect(() => {
    selectGroup(groupId);
    fetchMessages(groupId);
  }, [groupId]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || !user) return;
    
    await sendMessage(
      groupId, 
      messageText.trim(), 
      user.id, 
      user.user_metadata?.full_name || 'User'
    );
    setMessageText('');
    
    // Scroll to bottom after sending
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messageText, groupId, user, sendMessage]);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatDateSeparator = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const shouldShowDateSeparator = (index: number): boolean => {
    if (index === 0) return true;
    const current = new Date(messages[index]?.createdAt);
    const previous = new Date(messages[index - 1]?.createdAt);
    return current.toDateString() !== previous.toDateString();
  };

  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isOwnMessage = item.senderId === user?.id;
    const showAvatar = !isOwnMessage && (
      index === 0 || messages[index - 1]?.senderId !== item.senderId
    );
    const showName = !isOwnMessage && showAvatar;
    const showDate = shouldShowDateSeparator(index);
    
    return (
      <View>
        {showDate && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateSeparatorLine} />
            <Text style={styles.dateSeparatorText}>{formatDateSeparator(item.createdAt)}</Text>
            <View style={styles.dateSeparatorLine} />
          </View>
        )}
        <View style={[
          styles.messageContainer,
          isOwnMessage ? styles.ownMessageContainer : styles.otherMessageContainer
        ]}>
        {!isOwnMessage && (
          <View style={styles.avatarContainer}>
            {showAvatar ? (
              <Image
                source={{ 
                  uri: item.senderAvatar || 
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(item.senderName)}&background=6366f1&color=fff&size=32`
                }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarPlaceholder} />
            )}
          </View>
        )}
        
        <View style={[
          styles.messageBubble,
          isOwnMessage ? styles.ownBubble : styles.otherBubble
        ]}>
          {showName && (
            <Text style={styles.senderName}>{item.senderName}</Text>
          )}
          <Text style={[
            styles.messageText,
            isOwnMessage ? styles.ownMessageText : styles.otherMessageText
          ]}>
            {item.text}
          </Text>
          <Text style={[
            styles.messageTime,
            isOwnMessage ? styles.ownMessageTime : styles.otherMessageTime
          ]}>
            {formatTime(item.createdAt)}
          </Text>
          {/* Vote buttons */}
          {!isOwnMessage && (
            <View style={styles.voteRow}>
              <TouchableOpacity style={styles.voteBtn}>
                <Ionicons name="chevron-up" size={14} color="#64748b" />
                <Text style={styles.voteCount}>{(item as any).upvotes || 0}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.voteBtn}>
                <Ionicons name="chevron-down" size={14} color="#64748b" />
                <Text style={styles.voteCount}>{(item as any).downvotes || 0}</Text>
              </TouchableOpacity>
            </View>
          )}        </View>
      </View>
      </View>
    );
  }, [user?.id, messages]);

  const renderHeader = () => (
    <View style={styles.chatHeader}>
      <Text style={styles.chatHeaderText}>
        Welcome to {groupName}! Start chatting with your study group.
      </Text>
    </View>
  );

  const handleChallenge = (member: GroupMember) => {
    // Don't allow challenging yourself
    if (member.userId === user?.id) {
      Alert.alert('Oops!', "You can't challenge yourself!");
      return;
    }
    
    const opponent: GameUser = {
      id: member.userId,
      name: member.name,
      avatarUrl: member.avatar,
    };
    setChallengeOpponent(opponent);
    setShowGroupInfo(false);
    setShowChallengeModal(true);
  };

  const handleGameStart = (session: GameSession) => {
    setShowChallengeModal(false);
    setChallengeOpponent(null);
    // Navigate to the game screen
    navigation.navigate('GameScreen', { session });
  };

  const handleMessageMember = (member: GroupMember) => {
    setShowGroupInfo(false);
    navigation.navigate('DirectMessage', {
      recipientId: member.userId,
      recipientName: member.name,
    });
  };

  const handleDeleteGroup = async () => {
    await deleteGroup(groupId);
    navigation.goBack();
  };

  const handleArchiveGroup = async () => {
    await archiveGroup(groupId);
    navigation.goBack();
  };

  const { submitQuestion } = useGroupStore();

  const handleSubmitQuestion = async (question: any) => {
    await submitQuestion(groupId, question);
  };

  const inviteLink = `https://lanternstudy.app/invite/${groupId}`;

  // Menu overlay
  const renderMenu = () => (
    showMenu && (
      <TouchableOpacity 
        style={styles.menuOverlay}
        activeOpacity={1}
        onPress={() => setShowMenu(false)}
      >
        <View style={styles.menuDropdown}>
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              setShowAITutor(true);
            }}
          >
            <Ionicons name="school" size={22} color="#8b5cf6" />
            <Text style={styles.menuItemText}>AI Tutor</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              setShowAIGenerateQuestions(true);
            }}
          >
            <Ionicons name="sparkles" size={22} color="#f59e0b" />
            <Text style={styles.menuItemText}>AI Generate Questions</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              setShowQuestionModal(true);
            }}
          >
            <Ionicons name="help-circle" size={22} color="#10b981" />
            <Text style={styles.menuItemText}>Submit Question</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              setShowGroupInfo(true);
            }}
          >
            <Ionicons name="information-circle" size={22} color="#6366f1" />
            <Text style={styles.menuItemText}>Group Info</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              setShowAddMembers(true);
            }}
          >
            <Ionicons name="person-add" size={22} color="#8b5cf6" />
            <Text style={styles.menuItemText}>Add Members</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              Alert.alert('Game', 'Game feature coming soon!');
            }}
          >
            <Ionicons name="game-controller" size={22} color="#f59e0b" />
            <Text style={styles.menuItemText}>Start Game</Text>
          </TouchableOpacity>
          
          <View style={styles.menuDivider} />
          
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              Alert.alert(
                'Leave Group',
                'Are you sure you want to leave this group?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { 
                    text: 'Leave', 
                    style: 'destructive',
                    onPress: () => {
                      navigation.goBack();
                    }
                  },
                ]
              );
            }}
          >
            <Ionicons name="exit" size={22} color="#ef4444" />
            <Text style={[styles.menuItemText, styles.menuItemDanger]}>Leave Group</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    )
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()} 
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.headerInfo}
          onPress={() => setShowGroupInfo(true)}
        >
          <Image
            source={{ 
              uri: currentGroup?.avatarUrl || 
                `https://ui-avatars.com/api/?name=${encodeURIComponent(groupName)}&background=6366f1&color=fff`
            }}
            style={styles.headerAvatar}
          />
          <View>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{groupName}</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              {currentGroup?.memberCount || 0} members
            </Text>
          </View>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.menuButton}
          onPress={() => setShowMenu(!showMenu)}
        >
          <Ionicons name="ellipsis-vertical" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Menu Dropdown */}
      {renderMenu()}

      {/* Messages */}
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.chatContainer}
        keyboardVerticalOffset={0}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6366f1" />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            ListHeaderComponent={renderHeader}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
          />
        )}

        {/* Input Bar */}
        <View style={styles.inputContainer}>
          <TouchableOpacity style={styles.attachButton}>
            <Ionicons name="add-circle-outline" size={28} color="#6366f1" />
          </TouchableOpacity>
          
          <TextInput
            style={styles.textInput}
            placeholder="Type a message..."
            placeholderTextColor="#6b7280"
            value={messageText}
            onChangeText={setMessageText}
            multiline
            maxLength={1000}
          />
          
          <TouchableOpacity 
            style={[
              styles.sendButton,
              !messageText.trim() && styles.sendButtonDisabled
            ]}
            onPress={handleSend}
            disabled={!messageText.trim()}
          >
            <Ionicons 
              name="send" 
              size={20} 
              color={messageText.trim() ? '#ffffff' : '#6b7280'} 
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Modals */}
      {currentGroup && (
        <GroupInfoModal
          visible={showGroupInfo}
          onClose={() => setShowGroupInfo(false)}
          group={currentGroup}
          currentUserId={user?.id || ''}
          onUpdateDetails={updateGroupDetails}
          onPromoteToAdmin={promoteToAdmin}
          onDemoteAdmin={demoteAdmin}
          onRemoveMember={removeMember}
          onArchiveGroup={handleArchiveGroup}
          onDeleteGroup={handleDeleteGroup}
          onAddMembers={() => {
            setShowGroupInfo(false);
            setShowAddMembers(true);
          }}
          onChallenge={handleChallenge}
          onMessageMember={handleMessageMember}
        />
      )}

      <AddMembersModal
        visible={showAddMembers}
        onClose={() => setShowAddMembers(false)}
        groupId={groupId}
        groupName={groupName}
        inviteLink={inviteLink}
        onInviteByEmail={inviteByEmail}
      />

      <QuestionModal
        visible={showQuestionModal}
        onClose={() => setShowQuestionModal(false)}
        groupId={groupId}
        onSubmit={handleSubmitQuestion}
      />

      {/* Challenge Modal for 1v1 Quiz Battles */}
      {challengeOpponent && (
        <ChallengeModal
          visible={showChallengeModal}
          onClose={() => {
            setShowChallengeModal(false);
            setChallengeOpponent(null);
          }}
          opponent={challengeOpponent}
          onGameStart={handleGameStart}
          groupId={groupId}
        />
      )}

      {/* AI Tutor Modal */}
      <AITutorModal
        visible={showAITutor}
        onClose={() => setShowAITutor(false)}
        subject={groupName}
      />

      {/* AI Generate Questions Modal */}
      <AIGenerateQuestionsModal
        visible={showAIGenerateQuestions}
        onClose={() => setShowAIGenerateQuestions(false)}
        subject={groupName}
        onQuestionsGenerated={async (questions) => {
          // Post each question as a message to the group
          for (const q of questions) {
            const content = JSON.stringify({
              type: 'question',
              questionStem: q.text,
              questionType: q.type === 'multiple_choice' ? 'mcq-single' : q.type === 'true_false' ? 'true-false' : 'fill-blank',
              options: (q.options || []).map((opt, i) => ({
                id: `opt-${i}`,
                text: opt,
                isCorrect: opt === q.correctAnswer || String.fromCharCode(65 + i) === q.correctAnswer,
              })),
              explanation: q.explanation,
              tags: q.topic ? [q.topic] : [],
            });
            await sendMessage(groupId, content, user?.id || '', user?.user_metadata?.full_name || 'AI');
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
  },
  menuButton: {
    padding: 4,
  },
  chatContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesList: {
    padding: 16,
    paddingBottom: 8,
  },
  chatHeader: {
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  chatHeaderText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    gap: 8,
  },
  dateSeparatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#334155',
  },
  dateSeparatorText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
    paddingHorizontal: 8,
  },
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  ownMessageContainer: {
    justifyContent: 'flex-end',
  },
  otherMessageContainer: {
    justifyContent: 'flex-start',
  },
  avatarContainer: {
    width: 32,
    marginRight: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
  },
  messageBubble: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 16,
  },
  ownBubble: {
    backgroundColor: '#6366f1',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: '#1e293b',
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366f1',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  ownMessageText: {
    color: '#ffffff',
  },
  otherMessageText: {
    color: '#e2e8f0',
  },
  messageTime: {
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  ownMessageTime: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  otherMessageTime: {
    color: '#6b7280',
  },
  voteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  voteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  voteCount: {
    fontSize: 11,
    color: '#64748b',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    paddingBottom: 20,
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 8,
  },
  attachButton: {
    padding: 4,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: '#ffffff',
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#334155',
  },
  // Menu styles
  menuOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    zIndex: 100,
  },
  menuDropdown: {
    position: 'absolute',
    top: 60,
    right: 16,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuItemText: {
    fontSize: 16,
    color: '#ffffff',
  },
  menuItemDanger: {
    color: '#ef4444',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 4,
  },
});

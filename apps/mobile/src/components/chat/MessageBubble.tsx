import React, { useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import type { Message } from '../../stores/groupStore';
import { useTheme } from '../../theme';
import { normalizeStorageUrl, parseChatAudioUrl, segmentMentions } from '@lantern/shared/utils';
import { ResolvedAvatar } from '../ResolvedAvatar';
import { getQuestionTypeLabel } from './chatDateHelpers';
import { QuestionVoteBar } from './QuestionVoteBar';
import { ReceiptTicks } from './ReceiptTicks';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  userVote?: 'up' | 'down';
  memberCount: number;
  onVote?: (vote: 'up' | 'down') => void;
  flagCount?: number;
  userFlagged?: boolean;
  onFlag?: () => void;
  canFlag?: boolean;
  isGroupedWithPrevious?: boolean;
  onReply?: (message: Message) => void;
  onScrollToMessage?: (messageId: string) => void;
  onOpenThread?: (rootId: string) => void;
}

function MentionText({
  text,
  color,
  mentionColor,
}: {
  text: string;
  color: string;
  mentionColor: string;
}) {
  const segments = segmentMentions(text);
  return (
    <Text className="text-sm leading-relaxed" style={{ color }}>
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <Text key={i} style={{ color: mentionColor, fontWeight: '700' }}>
            {seg.value}
          </Text>
        ) : (
          <Text key={i}>{seg.value}</Text>
        )
      )}
    </Text>
  );
}

function VoiceNotePlayer({ url, isOwn, colors }: { url: string; isOwn: boolean; colors: any }) {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = async () => {
    try {
      if (playing && soundRef.current) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
        return;
      }
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri: url });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            setPlaying(false);
          }
        });
      }
      await soundRef.current.playAsync();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  return (
    <Pressable
      onPress={() => void toggle()}
      className="flex-row items-center gap-2 py-1"
      accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
    >
      <View
        className="px-2.5 py-1.5 rounded-lg"
        style={{ backgroundColor: isOwn ? 'rgba(255,255,255,0.2)' : colors.primaryBackground }}
      >
        <Text
          className="text-xs font-semibold"
          style={{ color: isOwn ? colors.textInverse : colors.primary }}
        >
          {playing ? 'Pause' : 'Play'}
        </Text>
      </View>
      <Text className="text-xs" style={{ color: isOwn ? '#c7d2fe' : colors.textSecondary }}>
        Voice note
      </Text>
    </Pressable>
  );
}

export function MessageBubble({
  message,
  isOwn,
  userVote,
  memberCount,
  onVote,
  flagCount,
  userFlagged,
  onFlag,
  canFlag,
  isGroupedWithPrevious = false,
  onReply,
  onScrollToMessage,
  onOpenThread,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const isQuestion = message.type === 'question';
  const timeLabel = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const audioUrl = !isQuestion ? parseChatAudioUrl(message.text) : null;

  const optionItems =
    message.optionItems?.length
      ? message.optionItems
      : (message.options || []).map((opt, i) =>
          typeof opt === 'string'
            ? { id: String(i), text: opt }
            : { id: (opt as { id?: string }).id || String(i), text: (opt as { text?: string }).text || String(opt) }
        );

  const ownTextBubbleStyle = { backgroundColor: colors.primary };
  const ownQuestionBubbleStyle = {
    backgroundColor: colors.primaryBackground,
    borderColor: colors.primary,
    borderWidth: 1,
  };
  const otherQuestionBubbleStyle = {
    backgroundColor: colors.card,
    borderColor: colors.warning,
    borderWidth: 1,
  };

  const otherTextBubbleStyle = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  };
  const questionImageUri = useResolvedStorageUrl(message.imageUrl);

  return (
    <Pressable
      onLongPress={onReply ? () => onReply(message) : undefined}
      delayLongPress={350}
      className={`flex-row gap-2 max-w-[92%] ${isOwn ? 'self-end' : 'self-start'} ${isGroupedWithPrevious ? 'mb-1' : 'mb-3'}`}
    >
      {!isOwn ? (
        isGroupedWithPrevious ? (
          <View style={{ width: 28 }} />
        ) : (
          <ResolvedAvatar name={message.senderName} uri={message.senderAvatar} size={28} />
        )
      ) : null}

      <View className={`flex-1 min-w-0 ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn && !isGroupedWithPrevious ? (
          <Text
            className="text-xs font-semibold mb-1 ml-0.5"
            style={{ color: colors.primary }}
            numberOfLines={1}
          >
            {message.senderName}
          </Text>
        ) : null}

        <View
          className={`px-3.5 py-2.5 rounded-2xl max-w-full shadow-sm ${
            isQuestion
              ? isOwn
                ? 'rounded-br-md'
                : 'rounded-bl-md'
              : isOwn
                ? 'rounded-br-md'
                : 'rounded-bl-md'
          }`}
          style={
            isQuestion
              ? isOwn
                ? ownQuestionBubbleStyle
                : otherQuestionBubbleStyle
              : isOwn
                ? ownTextBubbleStyle
                : otherTextBubbleStyle
          }
        >
          {message.replyTo ? (
            <Pressable
              onPress={() => message.replyTo?.id && onScrollToMessage?.(message.replyTo.id)}
              className="mb-2 rounded-lg px-2.5 py-1.5 border-l-2"
              style={{
                backgroundColor: isOwn && !isQuestion ? 'rgba(255,255,255,0.15)' : colors.backgroundSecondary,
                borderLeftColor: isOwn && !isQuestion ? '#fff' : colors.primary,
              }}
            >
              <Text
                className="text-[11px] font-semibold"
                numberOfLines={1}
                style={{ color: isOwn && !isQuestion ? colors.textInverse : colors.primary }}
              >
                {message.replyTo.senderName || 'Message'}
              </Text>
              <Text
                className="text-xs"
                numberOfLines={1}
                style={{ color: isOwn && !isQuestion ? '#c7d2fe' : colors.textSecondary }}
              >
                {(message.replyTo.questionStem || message.replyTo.text || 'Original message').slice(0, 100)}
              </Text>
            </Pressable>
          ) : null}

          {isQuestion ? (
            <View className="gap-2">
              <View className="flex-row items-center flex-wrap gap-1.5">
                <View
                  className="px-2 py-0.5 rounded-md"
                  style={{
                    backgroundColor: isOwn ? `${colors.primary}22` : colors.primaryBackground,
                  }}
                >
                  <Text
                    className="text-[11px] font-semibold"
                    style={{ color: isOwn ? colors.primaryDark : colors.primary }}
                  >
                    {getQuestionTypeLabel(message.questionType)}
                  </Text>
                </View>
              </View>

              <Text
                className="text-sm leading-relaxed"
                style={{ color: isOwn ? colors.text : colors.text }}
              >
                {message.questionStem || message.text}
              </Text>

              {questionImageUri && !imageFailed ? (
                <Image
                  source={{ uri: questionImageUri }}
                  accessibilityLabel="Question visual"
                  resizeMode="contain"
                  onError={() => setImageFailed(true)}
                  style={{
                    width: '100%',
                    maxHeight: 200,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                />
              ) : null}

              {optionItems.length > 0 ? (
                <View className="gap-1.5 mt-0.5">
                  {optionItems.map((opt, i) => (
                    <View key={opt.id || i} className="flex-row items-start gap-2">
                      <View
                        className="w-5 h-5 rounded items-center justify-center"
                        style={{ backgroundColor: isOwn ? `${colors.primary}18` : colors.backgroundSecondary }}
                      >
                        <Text className="text-[10px] font-semibold" style={{ color: colors.textSecondary }}>
                          {String.fromCharCode(65 + i)}
                        </Text>
                      </View>
                      <Text className="flex-1 text-sm" style={{ color: colors.text }}>
                        {opt.text}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <QuestionVoteBar
                upvotes={message.upvotes ?? 0}
                downvotes={message.downvotes ?? 0}
                userVote={userVote}
                questionStatus={message.questionStatus}
                memberCount={memberCount}
                isOwn={isOwn}
                onVote={onVote}
                flagCount={flagCount}
                userFlagged={userFlagged}
                onFlag={onFlag}
                canFlag={canFlag}
              />
            </View>
          ) : audioUrl ? (
            <VoiceNotePlayer url={audioUrl} isOwn={isOwn} colors={colors} />
          ) : (
            (() => {
              const imageMatch = message.text?.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
              const imageUri = imageMatch?.[1] ? normalizeStorageUrl(imageMatch[1]) : undefined;
              const textWithoutImage = message.text?.replace(/!\[.*?\]\(https?:\/\/[^)]+\)/, '').trim();
              return (
                <View className="gap-2">
                  {imageUri && !imageFailed ? (
                    <Image
                      source={{ uri: imageUri }}
                      accessibilityLabel="Shared image"
                      resizeMode="cover"
                      onError={() => setImageFailed(true)}
                      style={{ width: 220, height: 180, borderRadius: 10 }}
                    />
                  ) : null}
                  {textWithoutImage ? (
                    <MentionText
                      text={textWithoutImage}
                      color={isOwn ? colors.textInverse : colors.text}
                      mentionColor={isOwn ? '#fff' : colors.primary}
                    />
                  ) : null}
                </View>
              );
            })()
          )}

          <View className="flex-row items-center justify-end mt-1.5 gap-0.5">
            <Text
              className="text-[10px]"
              style={{
                color: isOwn
                  ? isQuestion
                    ? colors.textTertiary
                    : '#c7d2fe'
                  : colors.textTertiary,
              }}
            >
              {timeLabel}
            </Text>
            {isOwn ? (
              <ReceiptTicks
                status={message.receiptStatus || 'sent'}
                seenByCount={message.seenByCount}
                seenByTotal={message.seenByTotal}
                isGroupChat
                onPrimary={!isQuestion}
              />
            ) : null}
          </View>
        </View>

        {(message.replyCount ?? 0) > 0 && onOpenThread ? (
          <Pressable
            onPress={() => onOpenThread(message.threadRootId || message.id)}
            className="mt-1.5"
            accessibilityLabel={`${message.replyCount} replies`}
          >
            <Text
              className="text-xs font-semibold"
              style={{ color: isOwn ? colors.primary : colors.primary }}
            >
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {isOwn ? <View className="w-7" /> : null}
    </Pressable>
  );
}

import React, { useRef, useState } from 'react';
import { Message, MessageType, QuestionType, MatchingItem, User, Group, QuestionStatus } from '../types';
import { Avatar } from './ui';
import { ResolvedStorageImg } from './ui/ResolvedStorageImg';
import { resolveAvatarSrc } from '../utils/avatar';
import { useUIStore } from '../stores/uiStore';
import { useResolvedStorageUrl } from '../hooks/useResolvedStorageUrl';
import { featureAccents } from '@lantern/shared/design';
import {
  resolveGroupChatAvatarUrl,
  resolveGroupChatSenderLabel,
  resolveGroupChatMentionUsername,
  getQuestionVerificationThreshold,
  formatChatMessagePreview,
  parseChatAudioUrl,
  segmentMentions,
  canEditChatMessage,
  canRemoveChatMessage,
} from '@lantern/shared/utils';
import {
  HandThumbUpIcon,
  HandThumbDownIcon,
  TagIcon,
  FlagIcon,
  ArrowUturnLeftIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import {
  HandThumbUpIcon as HandThumbUpSolidIcon,
  HandThumbDownIcon as HandThumbDownSolidIcon,
  PlayIcon,
  PauseIcon,
} from '@heroicons/react/24/solid';

function formatChatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatSenderLabel(
  sender: { id?: string; username?: string | null; name?: string | null } | undefined,
  members?: Group['members']
): string {
  return resolveGroupChatSenderLabel(sender ?? {}, members);
}

interface MessageItemProps {
  message: Message;
  isCurrentUserMessage: boolean;
  currentUserVote?: 'up' | 'down' | undefined;
  onVoteQuestion: (messageId: string, voteType: 'up' | 'down') => void;
  onFlagAsSimilar: (messageId: string) => void;
  currentUserFlagged?: boolean;
  group: Group | null;
  currentUser: User;
  isGroupedWithPrevious?: boolean;
  onReply?: (message: Message) => void;
  onMentionUser?: (username: string) => void;
  onScrollToMessage?: (messageId: string) => void;
  onOpenThread?: (rootId: string) => void;
  onEditMessage?: (message: Message) => void;
  onRemoveMessage?: (message: Message) => void;
  /** When true, show group-style seen-by tooltip on ticks. */
  isGroupChat?: boolean;
}

function ReceiptTicks({
  status,
  seenByCount,
  seenByTotal,
  isGroupChat,
  onPrimary,
}: {
  status?: 'sent' | 'read';
  seenByCount?: number;
  seenByTotal?: number;
  isGroupChat?: boolean;
  onPrimary?: boolean;
}) {
  if (!status) return null;
  const isRead = status === 'read';
  const title =
    isGroupChat && typeof seenByTotal === 'number'
      ? `Seen by ${seenByCount ?? 0} of ${seenByTotal}`
      : isRead
        ? 'Read'
        : 'Sent';
  const color = isRead
    ? 'text-sky-400'
    : onPrimary
      ? 'text-white/70'
      : 'text-lantern-text-tertiary';
  return (
    <span className={`inline-flex items-center ml-1 ${color}`} title={title} aria-label={title}>
      {isRead ? (
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
          <path d="M1 6.5L4.5 10L11 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 6.5L8.5 10L15 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M1.5 6.5L4.5 9.5L10.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function MentionedText({
  text,
  onPrimary,
}: {
  text: string;
  onPrimary?: boolean;
}) {
  const segments = segmentMentions(text);
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <span
            key={i}
            className={
              onPrimary
                ? 'font-semibold text-white underline decoration-white/50'
                : 'font-semibold text-lantern-primary'
            }
          >
            {seg.value}
          </span>
        ) : (
          <React.Fragment key={i}>{seg.value}</React.Fragment>
        )
      )}
    </p>
  );
}

function seekRatioFromClientX(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.max(0, Math.min(1, (clientX - left) / width));
}

function ChatAudioPlayer({ url, onPrimary }: { url: string; onPrimary?: boolean }) {
  // Voice notes embed a short-lived signed URL; re-sign from bucket/path like images.
  const resolvedUrl = useResolvedStorageUrl(url);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playError, setPlayError] = useState<string | null>(null);

  const syncDuration = () => {
    const el = audioRef.current;
    if (!el) return;
    const next = el.duration;
    if (Number.isFinite(next) && next > 0) setDuration(next);
  };

  const seekToRatio = (ratio: number) => {
    const el = audioRef.current;
    if (!el || !resolvedUrl) return;
    const total = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
    if (!(total > 0)) return;
    const next = Math.max(0, Math.min(total, ratio * total));
    el.currentTime = next;
    setCurrentTime(next);
  };

  const togglePlayback = () => {
    const el = audioRef.current;
    if (!el || !resolvedUrl) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    // After natural end (or a seek to the tail), browsers keep `ended` until currentTime moves.
    const total = Number.isFinite(el.duration) ? el.duration : duration;
    if (el.ended || (total > 0 && el.currentTime >= total - 0.05)) {
      el.currentTime = 0;
      setCurrentTime(0);
    }
    setPlayError(null);
    void el.play().catch(() => {
      setPlaying(false);
      setPlayError('Could not play voice note');
    });
  };

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const trackClass = onPrimary ? 'bg-white/25' : 'bg-lantern-primary/15';
  const fillClass = onPrimary ? 'bg-white' : 'bg-lantern-primary';
  const timeClass = onPrimary ? 'text-white/80' : 'text-lantern-text-secondary';
  const mutedClass = onPrimary ? 'text-white/70' : 'text-lantern-text-secondary';

  if (resolvedUrl === null || playError) {
    return (
      <p className={`text-xs ${mutedClass}`}>
        {playError || 'Voice note unavailable'}
      </p>
    );
  }

  if (!resolvedUrl) {
    return <p className={`text-xs ${mutedClass}`}>Loading voice note…</p>;
  }

  return (
    <div className="flex items-center gap-2.5 min-w-0 w-full max-w-[min(260px,100%)]">
      <button
        type="button"
        onClick={togglePlayback}
        className={`shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 rounded-full ${
          onPrimary ? 'bg-white/20 text-white' : 'bg-lantern-primary-background text-lantern-primary'
        }`}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
      >
        {playing ? (
          <PauseIcon className="w-4 h-4" aria-hidden />
        ) : (
          <PlayIcon className="w-4 h-4 translate-x-0.5" aria-hidden />
        )}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div
          className={`h-1.5 rounded-full overflow-hidden cursor-pointer ${trackClass}`}
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          aria-label="Seek voice note"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekToRatio(seekRatioFromClientX(e.clientX, rect.left, rect.width));
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const step = e.key === 'ArrowRight' ? 0.05 : -0.05;
            const base = duration > 0 ? currentTime / duration : 0;
            seekToRatio(base + step);
          }}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-100 ease-linear pointer-events-none ${fillClass}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className={`flex items-center justify-between text-[11px] tabular-nums leading-none ${timeClass}`}>
          <span>{formatChatAudioTime(currentTime)}</span>
          <span>{formatChatAudioTime(duration)}</span>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={resolvedUrl}
        preload="metadata"
        onLoadedMetadata={syncDuration}
        onDurationChange={syncDuration}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setPlayError('Could not play voice note');
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        className="hidden"
      />
    </div>
  );
}

const MessageItem = React.memo<MessageItemProps>(({ message, isCurrentUserMessage, currentUserVote, onVoteQuestion, onFlagAsSimilar, currentUserFlagged, group, currentUser, isGroupedWithPrevious = false, onReply, onMentionUser, onScrollToMessage, onOpenThread, onEditMessage, onRemoveMessage, isGroupChat = false }) => {
  const { lowDataMode } = useUIStore();
  const isOfferNotice = message.type === MessageType.TEXT && message.text?.startsWith('[Offer]');
  const audioUrl = message.type === MessageType.TEXT ? parseChatAudioUrl(message.text) : null;
  const isRemoved = !!message.isRemoved || !!message.removedAt;
  const canEdit = !!onEditMessage && canEditChatMessage(message, currentUser.id);
  const canRemove = !!onRemoveMessage && canRemoveChatMessage(message, currentUser.id);

  if (isRemoved) {
    return (
      <div className={`flex ${isCurrentUserMessage ? 'justify-end' : 'justify-start'} mt-2 px-10`}>
        <div className="max-w-xs rounded-xl border border-dashed border-lantern-border bg-lantern-background-secondary/70 px-3 py-2 text-lantern-text-tertiary">
          <p className="text-sm italic">Message removed</p>
          {(message.replyCount ?? 0) > 0 && onOpenThread && (
            <button
              type="button"
              onClick={() => onOpenThread(message.threadRootId || message.id)}
              className="mt-1 text-xs font-semibold text-lantern-primary hover:underline"
            >
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isOfferNotice) {
    const cleanText = message.text.replace(/^\[Offer\]\s*/, '');
    return (
      <div className="flex justify-center w-full my-2 px-4">
        <div className="bg-lantern-background-secondary/80 border border-lantern-border backdrop-blur-sm rounded-lantern-xl px-4 py-2 text-center shadow-xs max-w-md">
          <p className="text-xs font-semibold text-lantern-text-secondary flex items-center justify-center gap-1.5 leading-relaxed">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: featureAccents.groups }}></span>
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: featureAccents.groups }}></span>
            </span>
            {cleanText}
          </p>
          <span className="text-[9px] text-lantern-text-tertiary mt-1 block">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    );
  }

  const isQuestion = message.type === MessageType.QUESTION;
  // Own text bubbles stay solid primary; own questions use a light wash so vote controls stay readable in light mode.
  const onPrimaryChrome = isCurrentUserMessage && !isQuestion;

  const isPending = isQuestion && message.questionStatus === QuestionStatus.PENDING;
  const isRejected = isQuestion && message.questionStatus === QuestionStatus.REJECTED;
  const isVerified = isQuestion && message.questionStatus === QuestionStatus.VERIFIED;
  const memberCount = group?.members?.length ?? 0;
  const approvalThreshold = getQuestionVerificationThreshold(memberCount);
  const approvalProgress = approvalThreshold > 0
    ? Math.min(100, Math.round((message.upvotes / approvalThreshold) * 100))
    : 0;

  const questionBubbleClasses = isCurrentUserMessage
    ? 'bg-lantern-primary-background text-lantern-text rounded-2xl rounded-br-md shadow-sm ring-1 ring-lantern-primary/30 border border-lantern-primary/25'
    : 'bg-lantern-surface text-lantern-text rounded-2xl rounded-bl-md shadow-sm ring-1 ring-emerald-500/30';

  const bubbleClasses = isQuestion
    ? questionBubbleClasses
    : isCurrentUserMessage
      ? 'bg-lantern-primary text-white rounded-2xl rounded-br-md shadow-sm'
      : 'bg-lantern-surface text-lantern-text rounded-2xl rounded-bl-md shadow-sm ring-1 ring-lantern-border';

  const alignmentClass = isCurrentUserMessage ? 'justify-end' : 'justify-start';

  const getQuestionTypeLabel = (type?: QuestionType): string => {
    switch (type) {
      case QuestionType.MULTIPLE_CHOICE_SINGLE: return 'Multiple Choice';
      case QuestionType.MULTIPLE_CHOICE_MULTIPLE: return 'Multi-Select';
      case QuestionType.TRUE_FALSE: return 'True / False';
      case QuestionType.FILL_IN_THE_BLANK: return 'Fill in the Blank';
      case QuestionType.MATCHING: return 'Matching';
      case QuestionType.OPEN_ENDED:
      default: return 'Question';
    }
  };

  const UpvoteIcon = currentUserVote === 'up' ? HandThumbUpSolidIcon : HandThumbUpIcon;
  const DownvoteIcon = currentUserVote === 'down' ? HandThumbDownSolidIcon : HandThumbDownIcon;

  const renderMatchingItemsList = (items: MatchingItem[] | undefined, listTitle: string) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="mt-2">
        <p className="text-xs font-medium mb-1 text-lantern-text-secondary">{listTitle}</p>
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={item.id} className="text-sm flex items-start gap-2 text-lantern-text">
              <span className="flex-shrink-0 w-5 h-5 rounded text-xs flex items-center justify-center font-medium bg-lantern-background-secondary dark:bg-lantern-surface-secondary text-lantern-text-secondary">
                {String.fromCharCode(65 + i)}
              </span>
              {item.text}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`flex ${alignmentClass} items-end gap-2 group ${isGroupedWithPrevious ? 'mt-0.5' : 'mt-2'}`}>
      {/* Left avatar — spacer when grouped with previous message from same sender */}
      {!isCurrentUserMessage && (
        isGroupedWithPrevious ? (
          <div className="w-8 shrink-0" aria-hidden />
        ) : (
          <Avatar
            name={formatSenderLabel(message.sender, group?.members)}
            src={resolveAvatarSrc(
              resolveGroupChatAvatarUrl(message.sender ?? {}, group?.members),
              lowDataMode
            )}
            size="sm"
            localOnly={lowDataMode}
            className="self-end ring-1 ring-white dark:ring-lantern-border"
          />
        )
      )}

      {/* Bubble */}
      <div className={`max-w-xs md:max-w-md lg:max-w-lg px-3.5 py-2.5 relative ${bubbleClasses}`}>
        {(onReply || canEdit || canRemove) && (
          <div
            className={`absolute -top-3 ${isCurrentUserMessage ? 'left-2' : 'right-2'} opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100 flex items-center rounded-lg bg-lantern-surface border border-lantern-border shadow-sm transition-opacity overflow-hidden`}
          >
            {onReply && (
              <button
                type="button"
                onClick={() => onReply(message)}
                className="p-1.5 text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-background"
                aria-label="Reply to message"
                title="Reply"
              >
                <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => onEditMessage?.(message)}
                className="p-1.5 text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-background"
                aria-label="Edit message"
                title="Edit message"
              >
                <PencilIcon className="w-3.5 h-3.5" />
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                onClick={() => onRemoveMessage?.(message)}
                className="p-1.5 text-lantern-text-secondary hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                aria-label="Remove message"
                title="Remove message"
              >
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        {/* Sender name for other users — tap inserts @username in the composer */}
        {!isCurrentUserMessage && !isGroupedWithPrevious && (
          onMentionUser &&
          resolveGroupChatMentionUsername(message.sender ?? {}, group?.members) ? (
            <button
              type="button"
              onClick={() => {
                const username = resolveGroupChatMentionUsername(
                  message.sender ?? {},
                  group?.members
                );
                if (username) onMentionUser(username);
              }}
              className="text-xs font-semibold mb-0.5 text-lantern-primary hover:underline"
              title="Mention in message"
            >
              {formatSenderLabel(message.sender, group?.members)}
            </button>
          ) : (
            <p className="text-xs font-semibold mb-0.5 text-lantern-primary">
              {formatSenderLabel(message.sender, group?.members)}
            </p>
          )
        )}

        {message.replyTo && (
          <button
            type="button"
            onClick={() => message.replyTo?.id && onScrollToMessage?.(message.replyTo.id)}
            className={`mb-2 w-full text-left rounded-lg px-2.5 py-1.5 border-l-2 ${
              onPrimaryChrome
                ? 'bg-white/15 border-white/70 text-white/90'
                : 'bg-lantern-background-secondary border-lantern-primary text-lantern-text-secondary'
            }`}
          >
            <p className="text-[11px] font-semibold truncate">
              {message.replyTo.senderName || 'Message'}
            </p>
            <p className="text-xs truncate">
              {message.replyTo.isRemoved
                ? 'Message removed'
                : (
                    message.replyTo.questionStem ||
                    formatChatMessagePreview(message.replyTo.text) ||
                    'Original message'
                  ).slice(0, 100)}
            </p>
          </button>
        )}

        {/* Text / voice message */}
        {message.type === MessageType.TEXT && message.text && (
          audioUrl ? (
            <ChatAudioPlayer url={audioUrl} onPrimary={onPrimaryChrome} />
          ) : (
            <MentionedText text={message.text} onPrimary={onPrimaryChrome} />
          )
        )}

        {/* Question message */}
        {isQuestion && (
          <div className="space-y-2">
            {/* Question type badge + pending status */}
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md bg-lantern-primary/10 text-lantern-primary dark:bg-lantern-primary-background dark:text-lantern-primary-light">
                {getQuestionTypeLabel(message.questionType)}
              </span>
              {isPending && (
                <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" title="Needs 20% group upvotes to appear in tests">
                  Pending
                </span>
              )}
              {isRejected && (
                <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300" title="More downvotes than upvotes — not available in tests">
                  Rejected
                </span>
              )}
              {isVerified && (
                <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                  Verified
                </span>
              )}
            </div>

            {/* Question stem */}
            <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{message.questionStem}</p>

            {/* Image */}
            {message.imageUrl && (
              <div className="mt-1">
                <ResolvedStorageImg
                  src={message.imageUrl}
                  alt="Question visual"
                  variant="thumb"
                  className="max-w-full h-auto rounded-lg border border-lantern-border"
                  style={{ maxHeight: '200px' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>
            )}

            {/* MC options */}
            {(message.questionType === QuestionType.MULTIPLE_CHOICE_SINGLE || message.questionType === QuestionType.MULTIPLE_CHOICE_MULTIPLE) && message.options && (
              <div className="space-y-1 mt-1">
                {message.options.map((opt, i) => (
                  <div key={opt.id} className="flex items-start gap-2 text-sm text-lantern-text">
                    <span className="flex-shrink-0 w-5 h-5 rounded text-xs flex items-center justify-center font-medium bg-lantern-background-secondary dark:bg-lantern-surface-secondary text-lantern-text-secondary">
                      {String.fromCharCode(65 + i)}
                    </span>
                    {opt.text}
                  </div>
                ))}
              </div>
            )}

            {/* True/False */}
            {message.questionType === QuestionType.TRUE_FALSE && message.options && (
              <div className="flex gap-2 mt-1">
                {['True', 'False'].map(label => (
                  <span key={label} className="text-sm px-3 py-1 rounded-lg bg-lantern-background-secondary dark:bg-lantern-surface-secondary text-lantern-text">
                    {label}
                  </span>
                ))}
              </div>
            )}

            {/* Fill in blank */}
            {message.questionType === QuestionType.FILL_IN_THE_BLANK && message.acceptableAnswers && (
              <div className="mt-1" />
            )}

            {/* Matching */}
            {message.questionType === QuestionType.MATCHING && (
              <>
                {renderMatchingItemsList(message.matchingPromptItems, "Prompts")}
                {renderMatchingItemsList(message.matchingAnswerItems, "Answers")}
              </>
            )}

            {/* Tags */}
            {message.tags && message.tags.length > 0 && (
              <div className="flex items-center flex-wrap gap-1 pt-2 mt-1 border-t border-lantern-border">
                <TagIcon className="w-3 h-3 text-lantern-text-tertiary" />
                {message.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="text-[11px] px-1.5 py-0.5 rounded-md font-medium bg-lantern-background-secondary dark:bg-lantern-surface-secondary text-lantern-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {isPending && memberCount > 0 && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between text-[10px] text-lantern-text-secondary">
                  <span>{message.upvotes} / {approvalThreshold} approvals needed</span>
                  <span>{approvalProgress}%</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden bg-lantern-background-secondary">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${approvalProgress}%`, minWidth: approvalProgress > 0 ? '4px' : undefined }}
                  />
                </div>
              </div>
            )}

            {/* Vote / flag actions */}
            {group && (
              <div className="flex items-center gap-1.5 pt-2 mt-1 border-t border-lantern-border">
                <button
                  onClick={() => onVoteQuestion(message.id, 'up')}
                  className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 md:px-2 md:py-1 rounded-lg transition-colors duration-150 min-h-[36px] md:min-h-0 border ${
                    currentUserVote === 'up'
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                      : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary/70 text-lantern-text border-lantern-border hover:bg-lantern-border'
                  }`}
                  aria-pressed={currentUserVote === 'up'}
                  aria-label={`Upvote question, current upvotes: ${message.upvotes}`}
                >
                  <UpvoteIcon className="w-3.5 h-3.5" />
                  <span className="font-medium">{message.upvotes}</span>
                </button>
                <button
                  onClick={() => onVoteQuestion(message.id, 'down')}
                  className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 md:px-2 md:py-1 rounded-lg transition-colors duration-150 min-h-[36px] md:min-h-0 border ${
                    currentUserVote === 'down'
                      ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60'
                      : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary/70 text-lantern-text border-lantern-border hover:bg-lantern-border'
                  }`}
                  aria-pressed={currentUserVote === 'down'}
                  aria-label={`Downvote question, current downvotes: ${message.downvotes}`}
                >
                  <DownvoteIcon className="w-3.5 h-3.5" />
                  <span className="font-medium">{message.downvotes}</span>
                </button>
                <div className="w-px h-4 mx-0.5 bg-lantern-border" />
                <button
                  onClick={() => onFlagAsSimilar(message.id)}
                  disabled={isCurrentUserMessage}
                  className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 md:px-2 md:py-1 rounded-lg transition-colors duration-150 min-h-[36px] md:min-h-0 border ${
                    currentUserFlagged
                      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
                      : 'bg-lantern-background-secondary dark:bg-lantern-surface-secondary/70 text-lantern-text border-lantern-border hover:bg-lantern-border'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                  aria-pressed={currentUserFlagged}
                  aria-label={`Flag as similar, current flags: ${message.flaggedAsSimilarUserIds?.length || 0}`}
                  title={isCurrentUserMessage ? "Cannot flag your own question" : "Flag as similar/duplicate"}
                >
                  <FlagIcon className="w-3.5 h-3.5" />
                  <span className="font-medium">{message.flaggedAsSimilarUserIds?.length || 0}</span>
                </button>
              </div>
            )}
          </div>
        )}

        {(message.replyCount ?? 0) > 0 && onOpenThread && (
          <button
            type="button"
            onClick={() => onOpenThread(message.threadRootId || message.id)}
            className={`mt-1.5 text-xs font-semibold ${
              onPrimaryChrome ? 'text-white/90 hover:text-white' : 'text-lantern-primary hover:underline'
            }`}
          >
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}

        {/* Timestamp + receipts */}
        <p className={`text-[11px] mt-1.5 ${onPrimaryChrome ? 'text-white/80' : 'text-lantern-text-tertiary'} text-right flex items-center justify-end gap-0.5`}>
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {message.editedAt && <span className="ml-1">(edited)</span>}
          {isCurrentUserMessage && (
            <ReceiptTicks
              status={message.receiptStatus || 'sent'}
              seenByCount={message.seenByCount}
              seenByTotal={message.seenByTotal}
              isGroupChat={isGroupChat}
              onPrimary={onPrimaryChrome}
            />
          )}
        </p>
      </div>

      {/* Own messages: no avatar — only the other person's messages show a profile picture. */}
    </div>
  );
});

export default MessageItem;
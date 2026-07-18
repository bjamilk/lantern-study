import React from 'react';
import { Message, MessageType, QuestionType, MatchingItem, User, Group, QuestionStatus } from '../types';
import { Avatar } from './ui';
import { resolveAvatarSrc } from '../utils/avatar';
import { useUIStore } from '../stores/uiStore';
import { normalizeStorageUrl } from '../utils/storageUrl';
import { featureAccents } from '@lantern/shared/design';
import { resolveGroupChatSenderLabel, getQuestionVerificationThreshold } from '@lantern/shared/utils';
import { HandThumbUpIcon, HandThumbDownIcon, TagIcon, FlagIcon } from '@heroicons/react/24/outline';
import { HandThumbUpIcon as HandThumbUpSolidIcon, HandThumbDownIcon as HandThumbDownSolidIcon } from '@heroicons/react/24/solid';

function formatSenderLabel(
  sender: { id?: string; username?: string | null } | undefined,
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
}

const MessageItem = React.memo<MessageItemProps>(({ message, isCurrentUserMessage, currentUserVote, onVoteQuestion, onFlagAsSimilar, currentUserFlagged, group, currentUser, isGroupedWithPrevious = false }) => {
  const { lowDataMode } = useUIStore();
  const isOfferNotice = message.type === MessageType.TEXT && message.text?.startsWith('[Offer]');

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

  const fallbackAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E";

  return (
    <div className={`flex ${alignmentClass} items-end gap-2 group ${isGroupedWithPrevious ? 'mt-0.5' : 'mt-2'}`}>
      {/* Left avatar — spacer when grouped with previous message from same sender */}
      {!isCurrentUserMessage && (
        isGroupedWithPrevious ? (
          <div className="w-8 shrink-0" aria-hidden />
        ) : (
          <Avatar
            name={formatSenderLabel(message.sender, group?.members)}
            src={resolveAvatarSrc(message.sender?.avatarUrl, lowDataMode)}
            size="sm"
            localOnly={lowDataMode}
            className="self-end ring-1 ring-white dark:ring-lantern-border"
          />
        )
      )}

      {/* Bubble */}
      <div className={`max-w-xs md:max-w-md lg:max-w-lg px-3.5 py-2.5 ${bubbleClasses}`}>
        {/* Sender name for other users */}
        {!isCurrentUserMessage && !isGroupedWithPrevious && (
          <p className="text-xs font-semibold mb-0.5 text-lantern-primary">{formatSenderLabel(message.sender, group?.members)}</p>
        )}

        {/* Text message */}
        {message.type === MessageType.TEXT && message.text && (
          <p className="text-sm leading-relaxed break-words">{message.text}</p>
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
                <img
                  src={normalizeStorageUrl(message.imageUrl)}
                  alt="Question visual"
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

        {/* Timestamp */}
        <p className={`text-[11px] mt-1.5 ${onPrimaryChrome ? 'text-white/80' : 'text-lantern-text-tertiary'} text-right`}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* Right avatar */}
      {isCurrentUserMessage && (
        <img
          src={resolveAvatarSrc(message.sender.avatarUrl, lowDataMode)}
          alt={formatSenderLabel(message.sender, group?.members)}
          className="w-7 h-7 rounded-full self-end object-cover flex-shrink-0 ring-1 ring-white dark:ring-lantern-border"
          onError={(e) => { e.currentTarget.src = fallbackAvatar; }}
        />
      )}
    </div>
  );
});

export default MessageItem;
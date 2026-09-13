import React from 'react';
import {
  CHAT_HOME_COPY,
  type ChatHomeInquiry,
  type ChatHomeLounge,
  type ChatHomeModel,
  type ChatHomeRecent,
} from '@lantern/shared/chat';
import { FeatureDisc } from '../ui/FeatureDisc';
import { Button } from '../ui/Button';
import { AppIcon } from '../ui/AppIcon';
import { Avatar } from '../ui/Avatar';

export interface ChatHomePaneProps {
  model: ChatHomeModel;
  compact?: boolean;
  onMessageSomeone?: () => void;
  onNewGroup?: () => void;
  onSelectRecent?: (recent: ChatHomeRecent) => void;
  onOpenLounge?: (lounge: ChatHomeLounge) => void;
  onOpenInquiries?: () => void;
}

export const ChatHomePane: React.FC<ChatHomePaneProps> = ({
  model,
  compact = false,
  onMessageSomeone,
  onNewGroup,
  onSelectRecent,
  onOpenLounge,
  onOpenInquiries,
}) => {
  const firstRun = model.mode === 'firstRun';
  const title = firstRun ? CHAT_HOME_COPY.firstRunTitle : CHAT_HOME_COPY.inboxTitle;
  const body = firstRun ? CHAT_HOME_COPY.firstRunBody : CHAT_HOME_COPY.inboxBody;

  return (
    <div
      className={
        compact
          ? 'px-3 py-4 space-y-3'
          : 'flex flex-1 flex-col items-center justify-center p-8 text-center'
      }
    >
      {!compact && (
        <div className="w-20 h-20 rounded-2xl bg-lantern-feature-groups-tint flex items-center justify-center mb-6">
          <AppIcon name="chatbubbles" size={40} className="text-lantern-feature-groups-ink" />
        </div>
      )}
      <h2 className={compact ? 'text-body font-semibold text-lantern-text' : 'text-title text-lantern-text mb-2'}>
        {title}
      </h2>
      <p className={`text-lantern-text-secondary ${compact ? 'text-caption' : 'max-w-sm mb-6'}`}>
        {body}
      </p>
      {!compact && !firstRun && (
        <p className="text-caption text-lantern-text-tertiary mb-6">{CHAT_HOME_COPY.inboxHint}</p>
      )}

      {!compact && !firstRun && model.recents.length > 0 && onSelectRecent && (
        <div className="w-full max-w-md grid gap-2 mb-6 text-left">
          {model.recents.slice(0, 3).map((recent) => (
            <button
              key={`${recent.chatType}-${recent.id}`}
              type="button"
              onClick={() => onSelectRecent(recent)}
              className="flex items-center gap-3 rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2.5 hover:bg-lantern-background-secondary min-h-[52px]"
            >
              <Avatar name={recent.name} id={recent.id} src={recent.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-lantern-text truncate">{recent.name}</span>
                {recent.preview ? (
                  <span className="block text-caption text-lantern-text-secondary truncate">{recent.preview}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className={`flex flex-col ${compact ? 'gap-2' : 'sm:flex-row gap-2 justify-center mb-4'}`}>
        {onMessageSomeone && (
          <Button onClick={onMessageSomeone} size={compact ? 'sm' : 'md'}>
            {CHAT_HOME_COPY.messageSomeone}
          </Button>
        )}
        {onNewGroup && (
          <Button variant="secondary" onClick={onNewGroup} size={compact ? 'sm' : 'md'}>
            {CHAT_HOME_COPY.newGroup}
          </Button>
        )}
      </div>

      {(model.lounges.length > 0 || model.inquiries.length > 0) && (
        <div className={`w-full ${compact ? '' : 'max-w-md'} space-y-2 ${compact ? '' : 'mt-2 text-left'}`}>
          {model.lounges.slice(0, compact ? 2 : 3).map((lounge) => (
            <button
              key={lounge.communityId}
              type="button"
              onClick={() => onOpenLounge?.(lounge)}
              className="w-full flex items-center gap-3 rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2.5 hover:bg-lantern-background-secondary min-h-[48px] text-left"
            >
              <FeatureDisc
                feature="campus"
                size={32}
                icon={<AppIcon name="business" size={16} />}
              />
              <span className="min-w-0">
                <span className="block text-body font-semibold text-lantern-text truncate">{lounge.name}</span>
                <span className="block text-caption text-lantern-text-secondary">{CHAT_HOME_COPY.openLounge}</span>
              </span>
            </button>
          ))}
          {model.inquiries.length > 0 && onOpenInquiries && (
            <button
              type="button"
              onClick={onOpenInquiries}
              className="w-full flex items-center gap-3 rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-2.5 hover:bg-lantern-background-secondary min-h-[48px] text-left"
            >
              <FeatureDisc
                feature="budget"
                size={32}
                icon={<AppIcon name="pricetag" size={16} />}
              />
              <span className="min-w-0">
                <span className="block text-body font-semibold text-lantern-text">
                  {CHAT_HOME_COPY.viewInquiries}
                </span>
                <span className="block text-caption text-lantern-text-secondary truncate">
                  {model.inquiries[0].title}
                </span>
              </span>
            </button>
          )}
        </div>
      )}

      <p className={`text-lantern-text-tertiary ${compact ? 'text-label mt-3' : 'text-caption mt-6'}`}>
        {CHAT_HOME_COPY.privacy}
      </p>
    </div>
  );
};

import React from 'react';
import {
  BellIcon,
  CurrencyDollarIcon,
  ChatBubbleLeftEllipsisIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import {
  getNotificationMeta,
  formatRelativeTime,
  type NotificationIconKey,
} from '@lantern/shared';

const iconMap: Record<NotificationIconKey, React.ComponentType<{ className?: string }>> = {
  bell: BellIcon,
  currency: CurrencyDollarIcon,
  chat: ChatBubbleLeftEllipsisIcon,
  shopping: ShoppingBagIcon,
  envelope: ChatBubbleLeftEllipsisIcon,
};

interface NotificationRowProps {
  message: string;
  date: string | Date;
  read?: boolean;
  link?: string;
  type?: string;
  data?: Record<string, unknown>;
  onPress?: () => void;
  className?: string;
}

export const NotificationRow: React.FC<NotificationRowProps> = ({
  message,
  date,
  read = false,
  link,
  type,
  data,
  onPress,
  className = '',
}) => {
  const meta = getNotificationMeta(link, { type, data, link });
  const Icon = iconMap[meta.iconKey];
  const Wrapper = onPress ? 'button' : 'div';

  return (
    <Wrapper
      type={onPress ? 'button' : undefined}
      onClick={onPress}
      className={`w-full text-left p-4 transition-colors duration-200 ${
        read
          ? 'bg-lantern-surface hover:bg-lantern-background-secondary'
          : 'bg-lantern-primary-background hover:bg-lantern-primary-background/80'
      } ${onPress ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary focus-visible:ring-inset' : ''} ${className}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-lantern flex items-center justify-center flex-shrink-0 ${meta.webColorClass}`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              {meta.label ? (
                <span className="text-[10px] font-bold uppercase tracking-wider text-lantern-text-tertiary">
                  {meta.label}
                </span>
              ) : null}
              <p className="text-sm text-lantern-text">{message}</p>
            </div>
            {!read ? (
              <div
                className="w-2.5 h-2.5 bg-lantern-primary rounded-full flex-shrink-0 mt-1"
                aria-label="Unread"
              />
            ) : null}
          </div>
          <p className="text-xs text-lantern-text-tertiary mt-1">
            {formatRelativeTime(date)}
          </p>
        </div>
      </div>
    </Wrapper>
  );
};

export default NotificationRow;

import React from 'react';
import { AppNotification } from '../types';
import { XMarkIcon, BellIcon, EnvelopeOpenIcon } from '@heroicons/react/24/outline';
import { Button, NotificationRow } from './ui';
import {
  parseNotificationLink,
  getNotificationMessage,
  isNotificationRead,
  getNotificationDate,
} from '@lantern/shared';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAsRead?: (notificationId: string) => void;
  onMarkAllAsRead: () => void;
  onNavigate?: (screen: string, params?: any) => void;
}

const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onNavigate,
}) => {
  if (!isOpen) return null;

  const sortedNotifications = [...notifications].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const handleNotificationClick = (n: AppNotification) => {
    if (!n.read && onMarkAsRead) {
      onMarkAsRead(n.id);
    }
    if (onNavigate && (n.link || n.type?.startsWith('challenge') || n.type === 'dm_message')) {
      const parsed = parseNotificationLink(n.link, n);
      if (parsed) {
        if (parsed.type === 'offer' || parsed.type === 'inquiry') {
          onNavigate('MarketplaceInquiries');
        } else if (parsed.type === 'listing' && parsed.id) {
          onNavigate('MarketplaceListingDetail', { listingId: parsed.id });
        } else if (parsed.type === 'challenge' && parsed.id) {
          onNavigate('Challenges');
          onNavigate('PlayChallenge', { challengeId: parsed.id });
        } else if (parsed.type === 'dm' && parsed.id) {
          onNavigate('DirectMessages', { userId: parsed.id, threadId: parsed.threadId });
        }
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-modal-title"
    >
      <div className="bg-lantern-surface border border-lantern-border rounded-lantern-xl shadow-lantern-md w-full max-w-lg h-[70vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-lantern-border flex-shrink-0">
          <h2
            id="notification-modal-title"
            className="text-xl font-semibold text-lantern-text flex items-center gap-2"
          >
            <BellIcon className="w-6 h-6 text-lantern-primary" />
            Notifications
          </h2>
          <button
            onClick={onClose}
            className="text-lantern-text-tertiary hover:text-lantern-text p-1 rounded-lg transition-colors"
            aria-label="Close notifications"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="flex justify-end items-center px-4 py-2 border-b border-lantern-border flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onMarkAllAsRead} className="gap-1">
            <EnvelopeOpenIcon className="w-4 h-4" />
            Mark all as read
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto pb-safe">
          {sortedNotifications.length > 0 ? (
            <ul className="divide-y divide-lantern-border">
              {sortedNotifications.map(n => (
                <li key={n.id}>
                  <NotificationRow
                    message={getNotificationMessage(n)}
                    date={getNotificationDate(n)}
                    read={isNotificationRead(n)}
                    link={n.link}
                    type={n.type}
                    data={n.data}
                    onPress={() => handleNotificationClick(n)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-center py-16 px-6">
              <div className="w-14 h-14 mx-auto rounded-full bg-lantern-primary-background flex items-center justify-center">
                <BellIcon className="w-7 h-7 text-lantern-primary" />
              </div>
              <p className="mt-4 text-sm font-medium text-lantern-text">No notifications yet</p>
              <p className="mt-1 text-xs text-lantern-text-secondary">
                You&apos;re all caught up — we&apos;ll let you know when something needs your attention.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationModal;

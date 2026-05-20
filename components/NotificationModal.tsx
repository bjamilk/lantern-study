import React from 'react';
import { AppNotification } from '../types';
import { XCircleIcon, BellIcon, EnvelopeOpenIcon, CurrencyDollarIcon, ChatBubbleLeftEllipsisIcon, ShoppingBagIcon } from '@heroicons/react/24/outline';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAsRead?: (notificationId: string) => void;
  onMarkAllAsRead: () => void;
  onNavigate?: (screen: string, params?: any) => void;
}

const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return `${Math.floor(interval)}y ago`;
    interval = seconds / 2592000;
    if (interval > 1) return `${Math.floor(interval)}mo ago`;
    interval = seconds / 86400;
    if (interval > 1) return `${Math.floor(interval)}d ago`;
    interval = seconds / 3600;
    if (interval > 1) return `${Math.floor(interval)}h ago`;
    interval = seconds / 60;
    if (interval > 1) return `${Math.floor(interval)}m ago`;
    return "Just now";
};

const parseNotificationLink = (link?: string) => {
  if (!link) return null;
  const parts = link.split(':');
  if (parts[0] !== 'marketplace' || parts.length < 3) return null;
  return { type: parts[1], id: parts[2] }; // e.g. { type: 'offer', id: '...' }
};

const getNotificationMeta = (link?: string) => {
  const parsed = parseNotificationLink(link);
  if (!parsed) return { icon: BellIcon, color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/30', label: null };
  switch (parsed.type) {
    case 'offer': return { icon: CurrencyDollarIcon, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30', label: 'Offer' };
    case 'inquiry': return { icon: ChatBubbleLeftEllipsisIcon, color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30', label: 'Inquiry' };
    case 'listing': return { icon: ShoppingBagIcon, color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30', label: 'Listing' };
    default: return { icon: BellIcon, color: 'text-blue-500 bg-blue-50 dark:bg-blue-900/30', label: null };
  }
};


const NotificationModal: React.FC<NotificationModalProps> = ({ isOpen, onClose, notifications, onMarkAsRead, onMarkAllAsRead, onNavigate }) => {

  if (!isOpen) return null;

  const sortedNotifications = [...notifications].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleNotificationClick = (n: AppNotification) => {
    // Always mark the notification as read when clicked
    if (!n.read && onMarkAsRead) {
      onMarkAsRead(n.id);
    }
    // Navigate if there's a link
    if (onNavigate && n.link) {
      const parsed = parseNotificationLink(n.link);
      if (parsed) {
        if (parsed.type === 'offer') {
          onNavigate('MarketplaceInquiries');
        } else if (parsed.type === 'inquiry') {
          onNavigate('MarketplaceInquiries');
        } else if (parsed.type === 'listing') {
          onNavigate('MarketplaceListingDetail', { listingId: parsed.id });
        }
        onClose();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 dark:bg-opacity-75 flex items-center justify-center p-4 z-[80]" role="dialog" aria-modal="true" aria-labelledby="notification-modal-title">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 id="notification-modal-title" className="text-xl font-semibold text-gray-800 dark:text-gray-100 flex items-center">
            <BellIcon className="w-6 h-6 mr-2 text-blue-500" />
            Notifications
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100" aria-label="Close notifications">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        
        {/* Actions */}
        <div className="flex justify-end items-center p-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
            <button onClick={onMarkAllAsRead} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center">
                <EnvelopeOpenIcon className="w-4 h-4 mr-1"/>
                Mark all as read
            </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {sortedNotifications.length > 0 ? (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {sortedNotifications.map(n => {
                    const meta = getNotificationMeta(n.link);
                    return (
                    <li key={n.id}
                        className={`p-4 transition-colors ${n.read ? 'bg-white dark:bg-gray-800' : 'bg-blue-50 dark:bg-blue-900/30'} cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50`}
                        onClick={() => handleNotificationClick(n)}
                    >
                        <div className="flex items-start gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${meta.color}`}>
                                <meta.icon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start">
                                    <div className="min-w-0 pr-2">
                                        {meta.label && (
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{meta.label}</span>
                                        )}
                                        <p className="text-sm text-gray-700 dark:text-gray-200">{n.message}</p>
                                    </div>
                                    {!n.read && <div className="w-2.5 h-2.5 bg-blue-500 rounded-full flex-shrink-0 mt-1" aria-label="Unread"></div>}
                                </div>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{formatRelativeTime(new Date(n.date))}</p>
                            </div>
                        </div>
                    </li>
                    );
                })}
            </ul>
          ) : (
            <div className="text-center py-16">
                <BellIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto"/>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No notifications yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationModal;
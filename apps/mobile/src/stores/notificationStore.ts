import { create } from 'zustand';
import { fetchNotifications } from '../services/api';

type NotificationRow = {
  read?: boolean;
  is_read?: boolean;
};

function countUnread(notifications: NotificationRow[]): number {
  return notifications.filter(n => !(n.read ?? n.is_read)).length;
}

interface NotificationStore {
  unreadCount: number;
  loadUnreadCount: (userId: string) => Promise<void>;
  increment: () => void;
  decrement: () => void;
  setUnread: (count: number) => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  unreadCount: 0,
  loadUnreadCount: async (userId: string) => {
    try {
      const data = await fetchNotifications(userId);
      const list = Array.isArray(data) ? data : [];
      set({ unreadCount: countUnread(list) });
    } catch {
      set({ unreadCount: 0 });
    }
  },
  increment: () => set(state => ({ unreadCount: state.unreadCount + 1 })),
  decrement: () => set(state => ({ unreadCount: Math.max(0, state.unreadCount - 1) })),
  setUnread: (count: number) => set({ unreadCount: Math.max(0, count) }),
}));

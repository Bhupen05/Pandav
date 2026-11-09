import { createContext, useContext } from 'react';
import type { NotificationItem } from '../api/notificationAPI';

export type { NotificationItem };

export interface NotificationContextType {
  unreadCount: number;
  // The newest notifications (up to 10), for the menu in the top bar
  latest: NotificationItem[];
  loadingLatest: boolean;
  // The latest list could not be loaded
  latestFailed: boolean;
  // Counts the notifications that arrived live, so other parts of the shell
  // (the badges in the navigation) can refresh when it changes
  arrivals: number;
  // Fetch the latest list and the unread count again
  refresh: () => Promise<void>;
  // These update the screen at once and the server after it. They resolve to
  // false (after showing the error) when the server refused.
  markRead: (id: string) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

export const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
};

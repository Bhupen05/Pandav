import { useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from 'react';
import { notificationAPI, type NotificationItem } from '../api/notificationAPI';
import { getErrorMessage } from '../api/axios';
import { useAuth } from './useAuth';
import { useChat } from './useChat';
import { useFeedback } from './useFeedback';
import { NotificationContext } from './useNotifications';

const LATEST_COUNT = 10;
const POLL_MS = 60_000;

// Notifications of the signed-in user: the unread count for the bell, the
// newest ones for its menu, and live delivery over the chat socket.
export const NotificationProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { user, loading: sessionLoading } = useAuth();
  const { socket } = useChat();
  const { notify } = useFeedback();

  // Nothing is asked of the server before the session is confirmed, and not
  // while the user has to choose a new password first (every request is refused)
  const userId = user?._id;
  const active = Boolean(userId) && !sessionLoading && !user?.mustChangePassword;

  const [unreadCount, setUnreadCount] = useState(0);
  const [latest, setLatest] = useState<NotificationItem[]>([]);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [latestFailed, setLatestFailed] = useState(false);
  const [arrivals, setArrivals] = useState(0);

  const unreadRef = useRef(0);
  const requestRef = useRef(0);

  const applyCount = useCallback((count: number) => {
    unreadRef.current = count;
    setUnreadCount(count);
  }, []);

  const refresh = useCallback(async () => {
    // A later request wins: the answer of an earlier, slower one is dropped
    const request = ++requestRef.current;
    setLoadingLatest(true);
    try {
      const page = await notificationAPI.list({ limit: LATEST_COUNT });
      if (request !== requestRef.current) return;
      setLatest(page.data);
      applyCount(page.unreadCount);
      setLatestFailed(false);
    } catch {
      if (request === requestRef.current) setLatestFailed(true);
    } finally {
      if (request === requestRef.current) setLoadingLatest(false);
    }
  }, [applyCount]);

  // On sign-in, and again whenever the account changes
  useEffect(() => {
    if (!active) {
      requestRef.current += 1;
      applyCount(0);
      setLatest([]);
      setLatestFailed(false);
      setLoadingLatest(false);
      return;
    }
    void refresh();

    // The socket can miss events (a dropped connection), so the count is also
    // asked for every minute; when it differs from what is shown, so is the list
    const timer = window.setInterval(() => {
      notificationAPI
        .unreadCount()
        .then((count) => {
          if (count !== unreadRef.current) void refresh();
        })
        .catch(() => {
          // The next minute asks again
        });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, userId, refresh, applyCount]);

  // New notifications arrive live
  useEffect(() => {
    if (!socket || !active) return;
    const onNotification = (item: NotificationItem) => {
      if (!item?._id) return;
      setLatest((current) => [item, ...current.filter((existing) => existing._id !== item._id)].slice(0, LATEST_COUNT));
      if (!item.readAt) applyCount(unreadRef.current + 1);
      setArrivals((count) => count + 1);
      notify(item.title, 'info');
    };
    socket.on('notification', onNotification);
    return () => {
      socket.off('notification', onNotification);
    };
  }, [socket, active, notify, applyCount]);

  const markRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString();
    setLatest((current) => current.map((item) => (item._id === id && !item.readAt ? { ...item, readAt } : item)));
    try {
      const count = await notificationAPI.markRead(id);
      if (count !== undefined) applyCount(count);
      else applyCount(Math.max(0, unreadRef.current - 1));
      return true;
    } catch (error) {
      notify(getErrorMessage(error, 'Could not mark that notification as read.'), 'error');
      void refresh();
      return false;
    }
  }, [applyCount, notify, refresh]);

  const markAllRead = useCallback(async () => {
    try {
      await notificationAPI.markAllRead();
      const readAt = new Date().toISOString();
      setLatest((current) => current.map((item) => (item.readAt ? item : { ...item, readAt })));
      applyCount(0);
      return true;
    } catch (error) {
      notify(getErrorMessage(error, 'Could not mark the notifications as read.'), 'error');
      return false;
    }
  }, [applyCount, notify]);

  const remove = useCallback(async (id: string) => {
    try {
      const count = await notificationAPI.remove(id);
      setLatest((current) => current.filter((item) => item._id !== id));
      if (count !== undefined) applyCount(count);
      return true;
    } catch (error) {
      notify(getErrorMessage(error, 'Could not delete that notification.'), 'error');
      return false;
    }
  }, [applyCount, notify]);

  const value = useMemo(
    () => ({ unreadCount, latest, loadingLatest, latestFailed, arrivals, refresh, markRead, markAllRead, remove }),
    [unreadCount, latest, loadingLatest, latestFailed, arrivals, refresh, markRead, markAllRead, remove],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};

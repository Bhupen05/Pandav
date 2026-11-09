import api from './axios';

// A notification as the server returns it. Over the socket `actor` is just an id.
export interface NotificationItem {
  _id: string;
  type: string;
  title: string;
  body?: string;
  // A path in this app to open
  link?: string;
  actor?: string | { _id: string; name?: string; profileImage?: string | null } | null;
  data?: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  data: NotificationItem[];
  hasMore: boolean;
  unreadCount: number;
}

// The server answers changes with the new unread count
const countFrom = (body: { unreadCount?: unknown }): number | undefined =>
  typeof body?.unreadCount === 'number' ? body.unreadCount : undefined;

export const notificationAPI = {
  // Newest first. `before` (the id of the oldest one shown) loads the page before it.
  list: async (params: { limit?: number; before?: string; unread?: boolean } = {}): Promise<NotificationPage> => {
    const response = await api.get('/notifications', {
      params: {
        limit: params.limit,
        before: params.before,
        unread: params.unread ? 'true' : undefined,
      },
    });
    const { data, hasMore, unreadCount } = response.data;
    return {
      data: Array.isArray(data) ? data : [],
      hasMore: hasMore === true,
      unreadCount: Number(unreadCount) || 0,
    };
  },

  unreadCount: async (): Promise<number> => {
    const response = await api.get('/notifications/unread-count');
    return Number(response.data?.data?.count) || 0;
  },

  // These three resolve to the new unread count
  markRead: async (id: string) => {
    const response = await api.patch(`/notifications/${id}/read`);
    return countFrom(response.data);
  },

  markAllRead: async () => {
    const response = await api.patch('/notifications/read-all');
    return countFrom(response.data);
  },

  remove: async (id: string) => {
    const response = await api.delete(`/notifications/${id}`);
    return countFrom(response.data);
  },
};

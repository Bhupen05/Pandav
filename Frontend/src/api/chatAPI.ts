import api from './axios';

// ---------------------------------------------------------------------------
// Shapes the chat endpoints answer with (Backend/Doc/Chat.md)
// ---------------------------------------------------------------------------

// Populated by the API ({ _id, name }); a bare id if population is skipped
export type Participant = string | { _id: string; name?: string; email?: string };

// A direct message, or a team message (which has `team` and `readBy` instead
// of a receiver and isRead). A deleted message keeps its place with
// message "" and deletedAt set.
export interface Message {
  _id: string;
  sender: Participant;
  receiver?: Participant;
  message: string;
  // Direct messages are dated by timestamp, team messages by createdAt
  timestamp?: string;
  createdAt?: string;
  isRead?: boolean;
  team?: string | { _id: string; name?: string };
  readBy?: Array<{ user: Participant; readAt: string }>;
  isEdited?: boolean;
  editedAt?: string | null;
  deletedAt?: string | null;
}

export interface ConversationUser {
  _id: string;
  name: string;
  role: string | null;
  department: string | null;
  profileImage: string | null;
  isActive: boolean;
  // A deleted account: name "Deleted user", nothing else shown
  deleted: boolean;
}

// One row of GET /chat/conversations: a person and the latest message either way
export interface Conversation {
  user: ConversationUser;
  lastMessage: {
    _id: string;
    // The first 120 characters; "" once deleted
    text: string;
    at: string;
    fromMe: boolean;
    isRead: boolean;
    deleted: boolean;
  };
  unreadCount: number;
  // Whether the caller may still write to this person
  canMessage: boolean;
}

// One row of GET /chat/teams/chats
export interface TeamChat {
  teamId: string;
  teamName: string;
  // false while the team is frozen
  isActive: boolean;
  // null: no messages yet; "": the latest one was deleted
  lastMessage: string | null;
  lastMessageDeleted: boolean;
  lastMessageSender: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

// Someone the caller may message (GET /users/chat-list)
export interface ChatContact {
  _id: string;
  name: string;
  email?: string;
  role?: string;
  department?: string;
  profileImage?: string;
}

export interface BlockedUser {
  _id: string;
  name: string;
  profileImage?: string | null;
  blockedAt?: string;
}

export interface UnreadCounts {
  // Unread direct messages by sender id
  data: Record<string, number>;
  total: number;
  // Unread team messages by team id (always empty for admins)
  teams: Record<string, number>;
  teamTotal: number;
}

export interface TeamPerson {
  _id: string;
  name: string;
  email?: string;
  role?: string;
  department?: string;
  profileImage?: string;
  isActive?: boolean;
}

export interface TeamDetail {
  _id: string;
  name: string;
  description?: string;
  leaders: TeamPerson[];
  members: TeamPerson[];
  isActive?: boolean;
}

// Paging cursor: the oldest item shown (see "Paging" in Chat.md)
export interface Cursor {
  before: string;
  beforeId?: string;
}

export interface Page<T> {
  data: T[];
  hasMore: boolean;
}

const page = <T>(body: { data?: T[]; hasMore?: boolean }): Page<T> => ({
  data: Array.isArray(body?.data) ? body.data : [],
  hasMore: Boolean(body?.hasMore),
});

const isNotFound = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 404);

export const chatAPI = {
  // One-minute ticket for opening the chat socket
  socketToken: async (): Promise<string> => {
    const response = await api.post('/auth/socket-token');
    return response.data.data.token;
  },

  // ── Direct messages ──────────────────────────────────────────────────────

  send: async (receiverId: string, message: string): Promise<Message> => {
    const response = await api.post('/chat/send', { receiverId, message });
    return response.data.data;
  },

  conversations: async (cursor?: Cursor): Promise<Page<Conversation>> => {
    const response = await api.get('/chat/conversations', { params: cursor });
    return page<Conversation>(response.data);
  },

  // The latest 50 (which also reads the conversation), or the 50 before the cursor
  messages: async (userId: string, cursor?: Cursor): Promise<Page<Message>> => {
    const response = await api.get(`/chat/messages/${userId}`, { params: cursor });
    return page<Message>(response.data);
  },

  edit: async (messageId: string, message: string): Promise<Message> => {
    const response = await api.patch(`/chat/messages/${messageId}`, { message });
    return response.data.data;
  },

  remove: async (messageId: string): Promise<Message> => {
    const response = await api.delete(`/chat/messages/${messageId}`);
    return response.data.data;
  },

  markConversationRead: async (userId: string) => {
    await api.put(`/chat/read/${userId}`);
  },

  // Resolves to the server's thank-you message
  report: async (messageId: string, reason?: string): Promise<string> => {
    const response = await api.post(`/chat/messages/${messageId}/report`, reason ? { reason } : {});
    return response.data?.message || 'Thanks for telling us. An admin will look at this message.';
  },

  unread: async (): Promise<UnreadCounts> => {
    const response = await api.get('/chat/unread');
    const body = response.data || {};
    return {
      data: body.data || {},
      total: Number(body.total) || 0,
      teams: body.teams || {},
      teamTotal: Number(body.teamTotal) || 0,
    };
  },

  // ── Blocks ───────────────────────────────────────────────────────────────

  blocks: async (): Promise<BlockedUser[]> => {
    const response = await api.get('/chat/blocks');
    return Array.isArray(response.data?.data) ? response.data.data : [];
  },

  block: async (userId: string): Promise<{ person: BlockedUser | null; message: string }> => {
    const response = await api.post('/chat/blocks', { userId });
    return { person: response.data?.data ?? null, message: response.data?.message || 'Blocked' };
  },

  unblock: async (userId: string) => {
    await api.delete(`/chat/blocks/${userId}`);
  },

  // ── Team chat ────────────────────────────────────────────────────────────

  teamSend: async (teamId: string, message: string): Promise<Message> => {
    const response = await api.post(`/chat/teams/${teamId}/send`, { message });
    return response.data.data;
  },

  teamMessages: async (teamId: string, cursor?: Cursor): Promise<Page<Message>> => {
    const response = await api.get(`/chat/teams/${teamId}/messages`, { params: cursor });
    return page<Message>(response.data);
  },

  teamEdit: async (teamId: string, messageId: string, message: string): Promise<Message> => {
    const response = await api.patch(`/chat/teams/${teamId}/messages/${messageId}`, { message });
    return response.data.data;
  },

  teamRemove: async (teamId: string, messageId: string): Promise<Message> => {
    const response = await api.delete(`/chat/teams/${teamId}/messages/${messageId}`);
    return response.data.data;
  },

  teamReport: async (teamId: string, messageId: string, reason?: string): Promise<string> => {
    const response = await api.post(`/chat/teams/${teamId}/messages/${messageId}/report`, reason ? { reason } : {});
    return response.data?.message || 'Thanks for telling us. An admin will look at this message.';
  },

  teamMarkRead: async (teamId: string) => {
    await api.patch(`/chat/teams/${teamId}/read`);
  },

  // Admins: every team. Everyone else: the team they are in, if any
  teamChats: async (): Promise<TeamChat[]> => {
    const response = await api.get('/chat/teams/chats');
    return Array.isArray(response.data?.data) ? response.data.data : [];
  },

  // ── People and teams, for the chat screens ───────────────────────────────

  // Everyone the current user may message (GET /users/chat-list)
  contacts: async (): Promise<ChatContact[]> => {
    const response = await api.get('/users/chat-list');
    return Array.isArray(response.data?.data) ? response.data.data : [];
  },

  // The caller's team, or null when they are in none
  myTeam: async (): Promise<TeamDetail | null> => {
    try {
      const response = await api.get('/teams/my');
      return response.data?.data ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },

  team: async (teamId: string): Promise<TeamDetail> => {
    const response = await api.get(`/teams/${teamId}`);
    return response.data.data;
  },

  createTeam: async (data: { name: string; description?: string }): Promise<TeamDetail> => {
    const response = await api.post('/teams', data);
    return response.data.data;
  },

  updateTeam: async (teamId: string, data: { name?: string; description?: string }): Promise<TeamDetail> => {
    const response = await api.put(`/teams/${teamId}`, data);
    return response.data.data;
  },

  // By user id, email address or exact name
  inviteToTeam: async (teamId: string, who: string) => {
    const value = who.trim();
    const body = /^[a-f\d]{24}$/i.test(value)
      ? { userId: value }
      : value.includes('@')
        ? { email: value }
        : { username: value };
    const response = await api.post(`/teams/${teamId}/invite`, body);
    return response.data;
  },

  removeFromTeam: async (teamId: string, userId: string): Promise<TeamDetail> => {
    const response = await api.delete(`/teams/${teamId}/members/${userId}`);
    return response.data.data;
  },
};

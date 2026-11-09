import { createContext, useContext } from 'react';
import type { Socket } from 'socket.io-client';
import type {
  BlockedUser,
  Conversation,
  Message,
  Participant,
  TeamChat,
} from '../api/chatAPI';

export type { BlockedUser, Conversation, Message, Participant, TeamChat };

export interface TypingStatus {
  userId: string;
  userName: string;
}

// The live connection that brings new messages, read receipts and presence.
// Sending still works over HTTP while it is down.
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface ListStatus {
  // The first page has arrived at least once
  loaded: boolean;
  loading: boolean;
  // Why the last load failed; '' when it worked
  error: string;
  hasMore: boolean;
}

export interface ChatContextType {
  // For other screens that listen for live events (e.g. `notification`) or
  // emit `refresh_contacts`
  socket: Socket | null;
  connection: ConnectionState;
  // The current user's contacts who are online (never the user)
  activeUsers: string[];
  // Has the server look up who the user may message again, so presence
  // follows a new connection or a team change at once
  refreshContacts: () => void;

  // Unread direct messages by sender id, and unread team messages by team id
  unreadCounts: Record<string, number>;
  teamUnreadCounts: Record<string, number>;
  // All unread direct and team messages, for the navigation badge
  totalUnread: number;
  refreshUnread: () => Promise<void>;
  clearUnread: (userId: string) => void;

  // Direct conversations, newest first (loaded by the chat page)
  conversations: Conversation[];
  conversationsStatus: ListStatus;
  loadConversations: (options?: { older?: boolean }) => Promise<void>;
  // Team rooms: every team for admins, the user's own team otherwise
  teamChats: TeamChat[];
  teamChatsStatus: ListStatus;
  loadTeamChats: () => Promise<void>;

  // People the current user blocked
  blocked: BlockedUser[];
  blocksStatus: ListStatus;
  loadBlocks: () => Promise<void>;
  // Reject with the server's error
  blockUser: (person: { _id: string; name: string; profileImage?: string | null }) => Promise<string>;
  unblockUser: (userId: string) => Promise<void>;

  // The open conversation
  messages: Message[];
  loadingMessages: boolean;
  // Why the open conversation could not be loaded; '' when it worked
  messagesError: string;
  // Whether the open conversation has older messages than those loaded
  hasMoreMessages: boolean;
  // The newest message someone else sent to the open conversation while it
  // was open, for screen reader announcements
  latestIncoming: Message | null;
  fetchMessages: (userId: string) => Promise<void>;
  fetchTeamMessages: (teamId: string) => Promise<void>;
  // Rejects if the page could not be loaded
  loadOlderMessages: () => Promise<void>;
  closeChat: () => void;

  // Each rejects with the server's error
  sendMessage: (receiverId: string, message: string) => Promise<void>;
  sendTeamMessage: (teamId: string, message: string) => Promise<void>;
  editMessage: (message: Message, text: string) => Promise<void>;
  deleteMessage: (message: Message) => Promise<void>;
  // Resolves to the server's thank-you message
  reportMessage: (message: Message, reason?: string) => Promise<string>;
  markTeamMessagesAsRead: (teamId: string) => Promise<void>;

  // People typing to the current user in a direct chat
  typingUsers: TypingStatus[];
  setTyping: (isTyping: boolean, recipientId: string) => void;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const participantId = (participant: Participant | undefined | null) =>
  typeof participant === 'string' ? participant : participant?._id;

export const participantName = (participant: Participant | undefined | null) =>
  typeof participant === 'object' && participant ? participant.name : undefined;

// Team messages name their team as an id or { _id, name }
export const teamIdOf = (message: Message) =>
  typeof message.team === 'string' ? message.team : message.team?._id;

export const isDeleted = (message: Pick<Message, 'deletedAt'>) => Boolean(message.deletedAt);

// When it was sent: a direct message's timestamp, a team message's createdAt
export const sentAt = (message: Message) => message.timestamp || message.createdAt || '';

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');
  return context;
};

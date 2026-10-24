import { createContext, useContext } from 'react';
import type { Socket } from 'socket.io-client';

// Populated by the API ({ _id, name }); a bare id if population is skipped
export type Participant = string | { _id: string; name?: string; email?: string };

// A direct message, or a team message (which has `team` and `readBy` instead
// of a receiver and isRead)
export interface Message {
  _id: string;
  sender: Participant;
  receiver?: Participant;
  message: string;
  timestamp?: string;
  createdAt?: string;
  isRead?: boolean;
  team?: string | { _id: string; name?: string };
  readBy?: Array<{ user: Participant; readAt: string }>;
  isEdited?: boolean;
  editedAt?: string;
}

export interface TypingStatus {
  userId: string;
  userName: string;
}

export interface ChatContextType {
  socket: Socket | null;
  messages: Message[];
  activeUsers: string[];
  loadingMessages: boolean;
  unreadCounts: Record<string, number>;
  // All unread direct and team messages, for the navigation badge
  totalUnread: number;
  // People typing to the current user in a direct chat
  typingUsers: TypingStatus[];
  clearUnread: (userId: string) => void;
  // Reject if the message could not be sent
  sendMessage: (receiverId: string, message: string) => Promise<void>;
  sendTeamMessage: (teamId: string, message: string) => Promise<void>;
  fetchMessages: (userId: string) => Promise<void>;
  fetchTeamMessages: (teamId: string) => Promise<void>;
  markTeamMessagesAsRead: (teamId: string) => Promise<void>;
  setTyping: (isTyping: boolean, recipientId: string) => void;
  // Whether the open conversation has older messages than those loaded
  hasMoreMessages: boolean;
  loadOlderMessages: () => Promise<void>;
  closeChat: () => void;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const participantId = (participant: Participant | undefined) =>
  typeof participant === 'string' ? participant : participant?._id;

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');
  return context;
};

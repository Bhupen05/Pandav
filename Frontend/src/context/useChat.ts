import { createContext, useContext } from 'react';
import type { Socket } from 'socket.io-client';

// Populated by the API ({ _id, name }); a bare id if population is skipped
export type Participant = string | { _id: string; name?: string };

export interface Message {
  _id: string;
  sender: Participant;
  receiver: Participant;
  message: string;
  timestamp: string;
  isRead: boolean;
}

export interface ChatContextType {
  socket: Socket | null;
  messages: Message[];
  activeUsers: string[];
  loadingMessages: boolean;
  unreadCounts: Record<string, number>;
  clearUnread: (userId: string) => void;
  // Rejects if the message could not be sent
  sendMessage: (receiverId: string, message: string) => Promise<void>;
  fetchMessages: (userId: string) => Promise<void>;
  // Whether the open conversation has older messages than those loaded
  hasMoreMessages: boolean;
  loadOlderMessages: () => Promise<void>;
  closeChat: () => void;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');
  return context;
};

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';
import api from '../api/axios';
import { useAuth } from './AuthContext';

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

interface ChatContextType {
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

interface MessagesPage {
  data: Message[];
  hasMore: boolean;
}

const participantId = (participant: Participant) =>
  typeof participant === 'string' ? participant : participant?._id;

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const userId = user?._id;
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  // The conversation on screen. A ref, so the socket handler always sees the current value.
  const openChatUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !token) return;

    // The server identifies the user from this token and joins their room itself
    const newSocket = io(import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000', {
      auth: { token },
    });

    newSocket.on('connect_error', (error) => {
      console.error('Chat connection failed:', error.message);
    });

    // Unread counts are stored on the server, so they survive a page reload
    api.get<{ data: Record<string, number> }>('/chat/unread')
      .then(({ data }) => setUnreadCounts(data.data || {}))
      .catch((error) => console.error('Error loading unread counts:', error));

    newSocket.on('receive_message', (data: Message) => {
      const senderId = participantId(data.sender);
      // Show the message only in its own conversation; anything else counts as unread
      if (senderId === openChatUserIdRef.current) {
        setMessages(prev => [...prev, data]);
        api.put(`/chat/read/${senderId}`).catch((error) => console.error('Error marking messages read:', error));
      } else {
        setUnreadCounts(prev => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }));
      }
    });

    newSocket.on('update_active_users', (users: string[]) => {
      setActiveUsers(users);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
      // Don't leave one account's messages in memory for the next login
      setSocket(null);
      setMessages([]);
      setUnreadCounts({});
      openChatUserIdRef.current = null;
    };
  }, [userId, token]);

  const sendMessage = useCallback(async (receiverId: string, message: string) => {
    const { data } = await api.post<Message>('/chat/send', { receiverId, message });
    // The receiver gets it over the socket; add the sender's own copy here
    if (receiverId === openChatUserIdRef.current) {
      setMessages(prev => [...prev, data]);
    }
  }, []);

  const clearUnread = useCallback((chatUserId: string) => {
    setUnreadCounts(prev => ({ ...prev, [chatUserId]: 0 }));
  }, []);

  const fetchMessages = useCallback(async (chatUserId: string) => {
    openChatUserIdRef.current = chatUserId;
    clearUnread(chatUserId);
    setLoadingMessages(true);
    setMessages([]);
    setHasMoreMessages(false);
    try {
      // Loading the latest page also marks the conversation read on the server
      const { data } = await api.get<MessagesPage>(`/chat/messages/${chatUserId}`);
      // Ignore the response if the user switched to another conversation meanwhile
      if (openChatUserIdRef.current === chatUserId) {
        setMessages(Array.isArray(data.data) ? data.data : []);
        setHasMoreMessages(!!data.hasMore);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  }, [clearUnread]);

  const loadOlderMessages = useCallback(async () => {
    const chatUserId = openChatUserIdRef.current;
    const oldest = messages[0];
    if (!chatUserId || !oldest) return;

    try {
      const { data } = await api.get<MessagesPage>(`/chat/messages/${chatUserId}`, {
        params: { before: oldest.timestamp },
      });
      if (openChatUserIdRef.current === chatUserId) {
        setMessages(prev => [...data.data, ...prev]);
        setHasMoreMessages(!!data.hasMore);
      }
    } catch (error) {
      console.error('Error loading older messages:', error);
    }
  }, [messages]);

  const closeChat = useCallback(() => {
    openChatUserIdRef.current = null;
    setMessages([]);
    setHasMoreMessages(false);
  }, []);

  return (
    <ChatContext.Provider value={{ socket, messages, activeUsers, loadingMessages, unreadCounts, clearUnread, sendMessage, fetchMessages, hasMoreMessages, loadOlderMessages, closeChat }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');
  return context;
};

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface Message {
  _id: string;
  sender: any;
  receiver: any;
  message: string;
  timestamp: string;
  isRead: boolean;
  createdAt?: string;
  team?: any;
  readBy?: Array<{
    user: any;
    readAt: string;
  }>;
}

interface TypingStatus {
  userId: string;
  userName: string;
  isTyping: boolean;
}

interface ChatContextType {
  socket: Socket | null;
  messages: Message[];
  activeUsers: string[];
  loadingMessages: boolean;
  unreadCounts: Record<string, number>;
  typingUsers: TypingStatus[];
  clearUnread: (userId: string) => void;
  sendMessage: (receiverId: string, message: string) => void;
  fetchMessages: (userId: string) => Promise<void>;
  sendTeamMessage: (teamId: string, message: string) => void;
  fetchTeamMessages: (teamId: string) => Promise<void>;
  markTeamMessagesAsRead: (teamId: string) => Promise<void>;
  setTyping: (isTyping: boolean, recipientId: string) => void;
  markMessageAsRead: (messageId: string) => void;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

const apiBaseUrl = (import.meta.env.VITE_API_URL || '/api/v2').replace(/\/+$/, '');
const socketBaseUrl = /^https?:\/\//.test(apiBaseUrl)
  ? apiBaseUrl.replace(/\/api(?:\/v\d+)?$/, '')
  : window.location.origin;

const getMessageId = (message: Partial<Message> & Record<string, any>) => {
  if (!message) return null;
  return typeof message._id === 'string' && message._id.trim() ? message._id : null;
};

const mergeMessages = (current: Message[], incoming: Message | Message[]) => {
  const nextMessages = Array.isArray(incoming) ? incoming : [incoming];
  const merged = [...current];
  const indexById = new Map(
    current
      .map((message, index) => [getMessageId(message), index] as const)
      .filter(([messageId]) => Boolean(messageId))
  );

  nextMessages.forEach((message) => {
    const messageId = getMessageId(message);

    if (messageId && indexById.has(messageId)) {
      merged[indexById.get(messageId)!] = {
        ...merged[indexById.get(messageId)!],
        ...message,
      };
      return;
    }

    if (messageId) indexById.set(messageId, merged.length);
    merged.push(message);
  });

  return merged;
};

const normalizeMessages = (incoming: unknown) => {
  const list = Array.isArray(incoming) ? incoming : [];
  return mergeMessages([], list as Message[]);
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [typingUsers, setTypingUsers] = useState<TypingStatus[]>([]);
  const [, setOpenChatUserId] = useState<string | null>(null);
  const openTeamIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(async (receiverId: string, message: string) => {
    if (!user) return;
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');

    try {
      const response = await fetch(`${apiBaseUrl}/chat/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ receiverId, message })
      });
      const saved = await response.json();
      if (response.ok) {
        // add sender's own message immediately; receiver gets it via socket
        setMessages(prev => mergeMessages(prev, saved));
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }, [user]);

  const clearUnread = useCallback((userId: string) => {
    setUnreadCounts(prev => ({ ...prev, [userId]: 0 }));
  }, []);

  const fetchMessages = useCallback(async (userId: string) => {
    setOpenChatUserId(userId);
    setUnreadCounts(prev => ({ ...prev, [userId]: 0 }));
    setLoadingMessages(true);
    setMessages([]);
    try {
      const token = sessionStorage.getItem('token') || localStorage.getItem('token');
      const response = await fetch(`${apiBaseUrl}/chat/messages/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      setMessages(normalizeMessages(data));
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const sendTeamMessage = useCallback(async (teamId: string, message: string) => {
    if (!user) return;
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');

    try {
      const response = await fetch(`${apiBaseUrl}/chat/teams/${teamId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message })
      });
      const saved = await response.json();
      if (response.ok) {
        setMessages(prev => mergeMessages(prev, saved?.data || saved));
      }
    } catch (error) {
      console.error('Error sending team message:', error);
    }
  }, [user]);

  const markTeamMessagesAsRead = useCallback(async (teamId: string) => {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');

    try {
      const response = await fetch(`${apiBaseUrl}/chat/teams/${teamId}/read`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (response.ok && Array.isArray(data?.data) && data.data.length > 0) {
        setMessages((prev) => mergeMessages(prev, data.data));
      }
    } catch (error) {
      console.error('Error marking team messages as read:', error);
    }
  }, []);

  const fetchTeamMessages = useCallback(async (teamId: string) => {
    openTeamIdRef.current = teamId;
    setLoadingMessages(true);
    setMessages([]);
    try {
      const token = sessionStorage.getItem('token') || localStorage.getItem('token');
      const response = await fetch(`${apiBaseUrl}/chat/teams/${teamId}/messages`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      setMessages(normalizeMessages(Array.isArray(data) ? data : data?.data));
      await markTeamMessagesAsRead(teamId);
    } catch (error) {
      console.error('Error fetching team messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  }, [markTeamMessagesAsRead]);

  useEffect(() => {
    if (!user) return;

    const newSocket = io(socketBaseUrl);
    
    newSocket.on('connect', () => {
      newSocket.emit('user_online', user._id);
    });

    newSocket.on('receive_message', (data) => {
      setMessages(prev => mergeMessages(prev, data));
      const senderId = data.sender?._id || data.sender;
      setOpenChatUserId(current => {
        if (current !== senderId) {
          setUnreadCounts(prev => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }));
        }
        return current;
      });
    });

    newSocket.on('message_read', (message) => {
      setMessages((prev) => mergeMessages(prev, message));
    });

    newSocket.on('receive_team_message', (payload) => {
      const message = payload?.data || payload;
      const payloadTeamId = message?.team?._id || message?.team;

      if (openTeamIdRef.current && payloadTeamId && openTeamIdRef.current === payloadTeamId) {
        setMessages((prev) => mergeMessages(prev, message));
        if ((message?.sender?._id || message?.sender) !== user._id) {
          void markTeamMessagesAsRead(payloadTeamId);
        }
      }
    });

    newSocket.on('team_message_read', (message) => {
      const payloadTeamId = message?.team?._id || message?.team;

      if (!openTeamIdRef.current || !payloadTeamId || openTeamIdRef.current !== payloadTeamId) {
        return;
      }

      setMessages((prev) => mergeMessages(prev, message));
    });

    newSocket.on('user_typing', (data) => {
      setTypingUsers(prev => {
        const filtered = prev.filter(t => t.userId !== data.userId);
        return [...filtered, { ...data, isTyping: true }];
      });
    });

    newSocket.on('user_stopped_typing', (data) => {
      setTypingUsers(prev => prev.filter(t => t.userId !== data.userId));
    });

    newSocket.on('update_active_users', (users) => {
      setActiveUsers(users);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [markTeamMessagesAsRead, user]);

  const setTyping = useCallback((isTyping: boolean, recipientId: string) => {
    if (!socket) return;
    if (isTyping) {
      socket.emit('typing', { recipientId, userName: user?.name });
    } else {
      socket.emit('stopped_typing', { recipientId });
    }
  }, [socket, user?.name]);

  const markMessageAsRead = useCallback(async (messageId: string) => {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    try {
      await fetch(`${apiBaseUrl}/chat/messages/${messageId}/read`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  }, []);

  return (
    <ChatContext.Provider value={{ 
      socket, 
      messages, 
      activeUsers, 
      loadingMessages, 
      unreadCounts, 
      typingUsers,
      clearUnread, 
      sendMessage, 
      fetchMessages,
      sendTeamMessage,
      fetchTeamMessages,
      markTeamMessagesAsRead,
      setTyping,
      markMessageAsRead
    }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');
  return context;
};

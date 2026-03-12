import React, { createContext, useContext, useEffect, useState } from 'react';
import io, { Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';

interface Message {
  _id: string;
  sender: any;
  receiver: any;
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
  sendMessage: (receiverId: string, message: string) => void;
  fetchMessages: (userId: string) => Promise<void>;
}

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [, setOpenChatUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const newSocket = io(import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000');
    
    newSocket.on('connect', () => {
      // use _id to register into the socket room
      newSocket.emit('user_online', user._id);
    });

    newSocket.on('receive_message', (data) => {
      setMessages(prev => [...prev, data]);
      // increment unread only if this chat is not currently open
      const senderId = data.sender?._id || data.sender;
      setOpenChatUserId(current => {
        if (current !== senderId) {
          setUnreadCounts(prev => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }));
        }
        return current;
      });
    });

    newSocket.on('update_active_users', (users) => {
      setActiveUsers(users);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [user]);

  const sendMessage = async (receiverId: string, message: string) => {
    if (!user) return;
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/chat/send`, {
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
        setMessages(prev => [...prev, saved]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const clearUnread = (userId: string) => {
    setUnreadCounts(prev => ({ ...prev, [userId]: 0 }));
  };

  const fetchMessages = async (userId: string) => {
    setOpenChatUserId(userId);
    clearUnread(userId);
    setLoadingMessages(true);
    setMessages([]);
    try {
      const token = sessionStorage.getItem('token') || localStorage.getItem('token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/chat/messages/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  };

  return (
    <ChatContext.Provider value={{ socket, messages, activeUsers, loadingMessages, unreadCounts, clearUnread, sendMessage, fetchMessages }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within ChatProvider');
  return context;
};
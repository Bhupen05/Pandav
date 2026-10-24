import React, { useCallback, useEffect, useRef, useState } from 'react';
import io, { Socket } from 'socket.io-client';
import api, { socketBaseUrl } from '../api/axios';
import { authAPI } from '../api/authAPI';
import { useAuth } from './useAuth';
import { ChatContext, participantId, type Message, type TypingStatus } from './useChat';

interface MessagesPage {
  data: Message[];
  hasMore: boolean;
}

const teamIdOf = (message: Message) =>
  typeof message.team === 'string' ? message.team : message.team?._id;

// Sent once when someone in the team reads it: every message up to readAt
// that someone else sent now lists them as a reader
interface TeamReadReceipt {
  teamId: string;
  reader: { _id: string; name: string };
  readAt: string;
}

const applyTeamReadReceipt = (messages: Message[], { reader, readAt }: TeamReadReceipt) =>
  messages.map((message) => {
    const sentAt = message.createdAt ? new Date(message.createdAt).getTime() : NaN;
    const alreadyRead = message.readBy?.some((entry) => participantId(entry.user) === reader._id);
    if (participantId(message.sender) === reader._id || alreadyRead || !(sentAt <= new Date(readAt).getTime())) {
      return message;
    }
    return { ...message, readBy: [...(message.readBy || []), { user: reader, readAt }] };
  });

// Adds messages, replacing any already shown (the sender's own copy, a read
// receipt) instead of showing them twice
const mergeMessages = (current: Message[], incoming: Message | Message[]) => {
  const merged = [...current];
  const indexById = new Map(current.map((message, index) => [message._id, index]));

  (Array.isArray(incoming) ? incoming : [incoming]).forEach((message) => {
    if (!message?._id) return;
    const index = indexById.get(message._id);
    if (index !== undefined) {
      merged[index] = { ...merged[index], ...message };
    } else {
      indexById.set(message._id, merged.length);
      merged.push(message);
    }
  });

  return merged;
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const userId = user?._id;
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [typingUsers, setTypingUsers] = useState<TypingStatus[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  // The conversation on screen: a person or a team. Refs, so the socket
  // handlers always see the current value.
  const openChatUserIdRef = useRef<string | null>(null);
  const openTeamIdRef = useRef<string | null>(null);

  // The team, this user included, hears about it over the socket
  const markTeamMessagesAsRead = useCallback(async (teamId: string) => {
    try {
      await api.patch(`/chat/teams/${teamId}/read`);
    } catch (error) {
      console.error('Error marking team messages as read:', error);
    }
  }, []);

  useEffect(() => {
    // Wait until the session has been confirmed: a rejected session would
    // otherwise fail these requests and redirect to the login page
    if (!userId || loading) return;

    // The socket server never sees the session cookie, so every (re)connection
    // gets a fresh one-minute ticket. The server identifies the user from it
    // and joins their room itself.
    const newSocket = io(socketBaseUrl, {
      auth: (callback) => {
        authAPI.socketToken()
          .then((token) => callback({ token }))
          .catch(() => callback({}));
      },
    });

    newSocket.on('connect_error', (error) => {
      console.error('Chat connection failed:', error.message);
    });
    // Who is online is unknown until the socket reconnects and the server
    // sends the list again
    newSocket.on('disconnect', () => setActiveUsers([]));

    // Unread counts are stored on the server, so they survive a page reload
    api.get<{ data: Record<string, number> }>('/chat/unread')
      .then(({ data }) => setUnreadCounts(data.data || {}))
      .catch((error) => console.error('Error loading unread counts:', error));

    newSocket.on('receive_message', (data: Message) => {
      const senderId = participantId(data.sender);
      if (!senderId) return;
      // Show the message only in its own conversation; anything else counts as unread
      if (senderId === openChatUserIdRef.current) {
        setMessages((prev) => mergeMessages(prev, data));
        api.put(`/chat/read/${senderId}`).catch((error) => console.error('Error marking messages read:', error));
      } else {
        setUnreadCounts((prev) => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }));
      }
      setTypingUsers((prev) => prev.filter((t) => t.userId !== senderId));
    });

    // Read receipts for messages this user sent
    newSocket.on('message_read', (message: Message) => {
      setMessages((prev) => (prev.some((m) => m._id === message._id) ? mergeMessages(prev, message) : prev));
    });
    newSocket.on('messages_read', ({ readerId }: { readerId: string }) => {
      setMessages((prev) => prev.map((m) => (participantId(m.receiver) === readerId ? { ...m, isRead: true } : m)));
    });

    newSocket.on('receive_team_message', (payload: Message | { data: Message }) => {
      const message = 'data' in payload ? payload.data : payload;
      const teamId = teamIdOf(message);
      if (!teamId || openTeamIdRef.current !== teamId) return;

      setMessages((prev) => mergeMessages(prev, message));
      if (participantId(message.sender) !== userId) {
        void markTeamMessagesAsRead(teamId);
      }
    });

    newSocket.on('team_messages_read', (receipt: TeamReadReceipt) => {
      if (openTeamIdRef.current !== receipt.teamId) return;
      setMessages((prev) => applyTeamReadReceipt(prev, receipt));
    });

    newSocket.on('user_typing', (data: TypingStatus) => {
      setTypingUsers((prev) => [...prev.filter((t) => t.userId !== data.userId), data]);
    });

    newSocket.on('user_stopped_typing', ({ userId: typingUserId }: { userId: string }) => {
      setTypingUsers((prev) => prev.filter((t) => t.userId !== typingUserId));
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
      setTypingUsers([]);
      openChatUserIdRef.current = null;
      openTeamIdRef.current = null;
    };
  }, [userId, loading, markTeamMessagesAsRead]);

  const sendMessage = useCallback(async (receiverId: string, message: string) => {
    const { data } = await api.post<{ data: Message }>('/chat/send', { receiverId, message });
    // The receiver gets it over the socket; add the sender's own copy here
    if (receiverId === openChatUserIdRef.current) {
      setMessages((prev) => mergeMessages(prev, data.data));
    }
  }, []);

  const sendTeamMessage = useCallback(async (teamId: string, message: string) => {
    const { data } = await api.post<{ data: Message }>(`/chat/teams/${teamId}/send`, { message });
    // Everyone in the team, the sender included, also gets it over the socket
    if (teamId === openTeamIdRef.current) {
      setMessages((prev) => mergeMessages(prev, data.data));
    }
  }, []);

  const clearUnread = useCallback((chatUserId: string) => {
    setUnreadCounts((prev) => ({ ...prev, [chatUserId]: 0 }));
  }, []);

  const fetchMessages = useCallback(async (chatUserId: string) => {
    openChatUserIdRef.current = chatUserId;
    openTeamIdRef.current = null;
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

  const fetchTeamMessages = useCallback(async (teamId: string) => {
    openTeamIdRef.current = teamId;
    openChatUserIdRef.current = null;
    setLoadingMessages(true);
    setMessages([]);
    setHasMoreMessages(false);
    try {
      const { data } = await api.get<MessagesPage>(`/chat/teams/${teamId}/messages`);
      if (openTeamIdRef.current === teamId) {
        setMessages(Array.isArray(data.data) ? data.data : []);
        setHasMoreMessages(!!data.hasMore);
        await markTeamMessagesAsRead(teamId);
      }
    } catch (error) {
      console.error('Error fetching team messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  }, [markTeamMessagesAsRead]);

  const loadOlderMessages = useCallback(async () => {
    const chatUserId = openChatUserIdRef.current;
    const teamId = openTeamIdRef.current;
    const oldest = messages[0];
    if ((!chatUserId && !teamId) || !oldest) return;

    // Direct messages are dated by timestamp, team messages by createdAt
    const url = teamId ? `/chat/teams/${teamId}/messages` : `/chat/messages/${chatUserId}`;
    const before = teamId ? oldest.createdAt : oldest.timestamp;
    const stillOpen = () => (teamId ? openTeamIdRef.current === teamId : openChatUserIdRef.current === chatUserId);

    try {
      const { data } = await api.get<MessagesPage>(url, { params: { before } });
      if (stillOpen()) {
        setMessages((prev) => mergeMessages(data.data, prev));
        setHasMoreMessages(!!data.hasMore);
      }
    } catch (error) {
      console.error('Error loading older messages:', error);
    }
  }, [messages]);

  const setTyping = useCallback((isTyping: boolean, recipientId: string) => {
    socket?.emit(isTyping ? 'typing' : 'stopped_typing', { recipientId });
  }, [socket]);

  const closeChat = useCallback(() => {
    openChatUserIdRef.current = null;
    openTeamIdRef.current = null;
    setMessages([]);
    setHasMoreMessages(false);
  }, []);

  // Everything unread, for the badge in the navigation
  const totalUnread = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);

  return (
    <ChatContext.Provider
      value={{
        socket,
        messages,
        activeUsers,
        loadingMessages,
        unreadCounts,
        totalUnread,
        typingUsers,
        clearUnread,
        sendMessage,
        sendTeamMessage,
        fetchMessages,
        fetchTeamMessages,
        markTeamMessagesAsRead,
        setTyping,
        hasMoreMessages,
        loadOlderMessages,
        closeChat,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

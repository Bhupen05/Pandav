import React, { useCallback, useEffect, useRef, useState } from 'react';
import io, { type Socket } from 'socket.io-client';
import { getErrorMessage, socketBaseUrl } from '../api/axios';
import { chatAPI, type BlockedUser, type Conversation, type Cursor, type TeamChat } from '../api/chatAPI';
import { useAuth } from './useAuth';
import {
  ChatContext,
  isDeleted,
  participantId,
  sentAt,
  teamIdOf,
  type ConnectionState,
  type ListStatus,
  type Message,
  type TypingStatus,
} from './useChat';

const INITIAL_STATUS: ListStatus = { loaded: false, loading: false, error: '', hasMore: false };

// Typing stops showing if the other side's "stopped typing" never arrives
const TYPING_EXPIRY_MS = 6000;
// A refused connection is not retried by the socket library, so ask again
const SOCKET_RETRY_MS = 5000;
// Admins are in no team, so team rooms don't push to them: look again
const ADMIN_TEAM_POLL_MS = 10000;
const PREVIEW_LENGTH = 120;

// Sent once when someone in the team reads it: every message up to readAt
// that someone else sent now lists them as a reader
interface TeamReadReceipt {
  teamId: string;
  reader: { _id: string; name: string };
  readAt: string;
}

const applyTeamReadReceipt = (messages: Message[], { reader, readAt }: TeamReadReceipt) =>
  messages.map((message) => {
    const sent = message.createdAt ? new Date(message.createdAt).getTime() : NaN;
    const alreadyRead = message.readBy?.some((entry) => participantId(entry.user) === reader._id);
    if (participantId(message.sender) === reader._id || alreadyRead || !(sent <= new Date(readAt).getTime())) {
      return message;
    }
    return { ...message, readBy: [...(message.readBy || []), { user: reader, readAt }] };
  });

const timeOf = (message: Message) => {
  const time = new Date(sentAt(message)).getTime();
  return Number.isNaN(time) ? 0 : time;
};

// Oldest first; messages sent in the same millisecond keep their id order
const sortMessages = (messages: Message[]) =>
  [...messages].sort((a, b) => timeOf(a) - timeOf(b) || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));

// Adds messages, replacing any already shown (the sender's own copy, a read
// receipt, an edit) instead of showing them twice
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

  return sortMessages(merged);
};

const toLastMessage = (message: Message, meId: string): Conversation['lastMessage'] => ({
  _id: message._id,
  text: (message.message || '').slice(0, PREVIEW_LENGTH),
  at: sentAt(message),
  fromMe: participantId(message.sender) === meId,
  isRead: Boolean(message.isRead),
  deleted: isDeleted(message),
});

const byRecent = (a: Conversation, b: Conversation) =>
  new Date(b.lastMessage.at).getTime() - new Date(a.lastMessage.at).getTime();

// Replaces the rows with the same person, keeps the others, newest first
const mergeConversations = (current: Conversation[], incoming: Conversation[]) => {
  const byPerson = new Map(current.map((row) => [row.user._id, row]));
  incoming.forEach((row) => byPerson.set(row.user._id, row));
  return [...byPerson.values()].sort(byRecent);
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const userId = user?._id;
  const isAdmin = user?.role === 'admin';
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [activeUsers, setActiveUsers] = useState<string[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [teamUnreadCounts, setTeamUnreadCounts] = useState<Record<string, number>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsStatus, setConversationsStatus] = useState<ListStatus>(INITIAL_STATUS);
  const [teamChats, setTeamChats] = useState<TeamChat[]>([]);
  const [teamChatsStatus, setTeamChatsStatus] = useState<ListStatus>(INITIAL_STATUS);
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [blocksStatus, setBlocksStatus] = useState<ListStatus>(INITIAL_STATUS);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [latestIncoming, setLatestIncoming] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<TypingStatus[]>([]);

  // The conversation on screen: a person or a team. Refs, so the socket
  // handlers always see the current value.
  const openChatUserIdRef = useRef<string | null>(null);
  const openTeamIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  const teamChatsRef = useRef<TeamChat[]>([]);
  // Whether the first page of each list has been loaded: only then is a list
  // kept up to date
  const conversationsLoadedRef = useRef(false);
  const teamChatsLoadedRef = useRef(false);
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  useEffect(() => {
    teamChatsRef.current = teamChats;
  }, [teamChats]);
  useEffect(() => {
    conversationsLoadedRef.current = conversationsStatus.loaded;
  }, [conversationsStatus.loaded]);
  useEffect(() => {
    teamChatsLoadedRef.current = teamChatsStatus.loaded;
  }, [teamChatsStatus.loaded]);

  // ── Unread counts ────────────────────────────────────────────────────────

  const refreshUnread = useCallback(async () => {
    try {
      const counts = await chatAPI.unread();
      // The conversation on screen is being read, whatever an older answer says
      const openUser = openChatUserIdRef.current;
      const openTeam = openTeamIdRef.current;
      setUnreadCounts(openUser ? { ...counts.data, [openUser]: 0 } : counts.data);
      setTeamUnreadCounts(openTeam ? { ...counts.teams, [openTeam]: 0 } : counts.teams);
    } catch (error) {
      console.error('Error loading unread counts:', error);
    }
  }, []);

  const clearUnread = useCallback((chatUserId: string) => {
    setUnreadCounts((prev) => ({ ...prev, [chatUserId]: 0 }));
  }, []);

  // ── Lists ────────────────────────────────────────────────────────────────

  const loadConversations = useCallback(async ({ older = false }: { older?: boolean } = {}) => {
    let cursor: Cursor | undefined;
    if (older) {
      const last = conversationsRef.current[conversationsRef.current.length - 1];
      if (!last) return;
      cursor = { before: last.lastMessage.at, beforeId: last.lastMessage._id };
    }

    setConversationsStatus((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const page = await chatAPI.conversations(cursor);
      const hadOlderPages = conversationsRef.current.length > page.data.length;
      setConversations((prev) => (older || prev.length ? mergeConversations(prev, page.data) : page.data));
      setConversationsStatus((prev) => ({
        loaded: true,
        loading: false,
        error: '',
        // Refreshing the first page must not forget that older pages exist
        hasMore: older || !hadOlderPages ? page.hasMore : prev.hasMore,
      }));
    } catch (error) {
      setConversationsStatus((prev) => ({
        ...prev,
        loading: false,
        error: getErrorMessage(error, 'Could not load your conversations.'),
      }));
    }
  }, []);

  const loadTeamChats = useCallback(async () => {
    setTeamChatsStatus((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const list = await chatAPI.teamChats();
      setTeamChats(list);
      setTeamChatsStatus({ loaded: true, loading: false, error: '', hasMore: false });
    } catch (error) {
      setTeamChatsStatus((prev) => ({
        ...prev,
        loading: false,
        error: getErrorMessage(error, 'Could not load the team chats.'),
      }));
    }
  }, []);

  const loadBlocks = useCallback(async () => {
    setBlocksStatus((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      setBlocked(await chatAPI.blocks());
      setBlocksStatus({ loaded: true, loading: false, error: '', hasMore: false });
    } catch (error) {
      setBlocksStatus((prev) => ({
        ...prev,
        loading: false,
        error: getErrorMessage(error, 'Could not load the people you blocked.'),
      }));
    }
  }, []);

  const blockUser = useCallback(async (person: { _id: string; name: string; profileImage?: string | null }) => {
    const { person: blockedPerson, message } = await chatAPI.block(person._id);
    const entry: BlockedUser = {
      _id: person._id,
      name: person.name,
      profileImage: person.profileImage ?? null,
      blockedAt: new Date().toISOString(),
      ...(blockedPerson || {}),
    };
    setBlocked((prev) => [entry, ...prev.filter((item) => item._id !== person._id)]);
    setConversations((prev) => prev.map((row) => (row.user._id === person._id ? { ...row, canMessage: false } : row)));
    return message;
  }, []);

  const unblockUser = useCallback(async (blockedUserId: string) => {
    await chatAPI.unblock(blockedUserId);
    setBlocked((prev) => prev.filter((item) => item._id !== blockedUserId));
    // Whether they can be messaged again depends on the server's rules
    void loadConversations();
  }, [loadConversations]);

  // The newest message of a conversation row, after a message was sent or arrived
  const noteConversationMessage = useCallback((message: Message) => {
    if (!userId) return;
    const fromMe = participantId(message.sender) === userId;
    const otherId = participantId(fromMe ? message.receiver : message.sender);
    if (!otherId) return;

    if (!conversationsRef.current.some((row) => row.user._id === otherId)) {
      // A new conversation: the server knows the person's details
      if (conversationsLoadedRef.current) void loadConversations();
      return;
    }
    setConversations((prev) =>
      prev
        .map((row) => (row.user._id === otherId ? { ...row, lastMessage: toLastMessage(message, userId) } : row))
        .sort(byRecent),
    );
  }, [userId, loadConversations]);

  // An edit, a deletion or a read receipt of a message already shown as the preview
  const patchConversationMessage = useCallback((message: Message) => {
    if (!userId) return;
    setConversations((prev) =>
      prev.map((row) =>
        row.lastMessage._id === message._id ? { ...row, lastMessage: toLastMessage(message, userId) } : row,
      ),
    );
  }, [userId]);

  const noteTeamMessage = useCallback((message: Message) => {
    const teamId = teamIdOf(message);
    if (!teamId) return;
    if (!teamChatsRef.current.some((row) => row.teamId === teamId)) {
      if (teamChatsLoadedRef.current) void loadTeamChats();
      return;
    }
    setTeamChats((prev) =>
      prev
        .map((row) =>
          row.teamId === teamId
            ? {
                ...row,
                lastMessage: message.message || '',
                lastMessageDeleted: isDeleted(message),
                lastMessageSender: participantId(message.sender) ?? null,
                lastMessageAt: message.createdAt ?? row.lastMessageAt,
              }
            : row,
        )
        .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime()),
    );
  }, [loadTeamChats]);

  // An edit or deletion of a team message that may be the one shown as the preview
  const patchTeamMessage = useCallback((message: Message) => {
    const teamId = teamIdOf(message);
    if (!teamId || !message.createdAt) return;
    const sentTime = new Date(message.createdAt).getTime();
    setTeamChats((prev) =>
      prev.map((row) =>
        row.teamId === teamId && row.lastMessageAt && new Date(row.lastMessageAt).getTime() === sentTime
          ? { ...row, lastMessage: message.message || '', lastMessageDeleted: isDeleted(message) }
          : row,
      ),
    );
  }, []);

  // ── The open conversation ────────────────────────────────────────────────

  // The team, this user included, hears about it over the socket. Admins
  // leave no read receipts, so there is nothing to tell the server.
  const markTeamMessagesAsRead = useCallback(async (teamId: string) => {
    setTeamUnreadCounts((prev) => ({ ...prev, [teamId]: 0 }));
    setTeamChats((prev) => prev.map((row) => (row.teamId === teamId ? { ...row, unreadCount: 0 } : row)));
    if (isAdmin) return;
    try {
      await chatAPI.teamMarkRead(teamId);
    } catch (error) {
      console.error('Error marking team messages as read:', error);
    }
  }, [isAdmin]);

  const fetchMessages = useCallback(async (chatUserId: string) => {
    openChatUserIdRef.current = chatUserId;
    openTeamIdRef.current = null;
    clearUnread(chatUserId);
    setLoadingMessages(true);
    setMessages([]);
    setHasMoreMessages(false);
    setMessagesError('');
    setLatestIncoming(null);
    try {
      // Loading the latest page also marks the conversation read on the server
      const page = await chatAPI.messages(chatUserId);
      // Ignore the response if the user switched to another conversation meanwhile
      if (openChatUserIdRef.current === chatUserId) {
        // Messages that arrived while loading are kept
        setMessages((prev) => mergeMessages(prev, page.data));
        setHasMoreMessages(page.hasMore);
        setLoadingMessages(false);
      }
    } catch (error) {
      if (openChatUserIdRef.current === chatUserId) {
        setMessagesError(getErrorMessage(error, 'Could not load this conversation.'));
        setLoadingMessages(false);
      }
    }
  }, [clearUnread]);

  const fetchTeamMessages = useCallback(async (teamId: string) => {
    openTeamIdRef.current = teamId;
    openChatUserIdRef.current = null;
    setLoadingMessages(true);
    setMessages([]);
    setHasMoreMessages(false);
    setMessagesError('');
    setLatestIncoming(null);
    try {
      const page = await chatAPI.teamMessages(teamId);
      if (openTeamIdRef.current === teamId) {
        setMessages((prev) => mergeMessages(prev, page.data));
        setHasMoreMessages(page.hasMore);
        setLoadingMessages(false);
        void markTeamMessagesAsRead(teamId);
      }
    } catch (error) {
      if (openTeamIdRef.current === teamId) {
        setMessagesError(getErrorMessage(error, 'Could not load this team chat.'));
        setLoadingMessages(false);
      }
    }
  }, [markTeamMessagesAsRead]);

  // Messages missed while the connection was down (or never pushed, for admins
  // in a team room): the latest page, merged into what is shown
  const resyncOpen = useCallback(async () => {
    const chatUserId = openChatUserIdRef.current;
    const teamId = openTeamIdRef.current;
    try {
      if (chatUserId) {
        const page = await chatAPI.messages(chatUserId);
        if (openChatUserIdRef.current === chatUserId) setMessages((prev) => mergeMessages(prev, page.data));
      } else if (teamId) {
        const page = await chatAPI.teamMessages(teamId);
        if (openTeamIdRef.current === teamId) setMessages((prev) => mergeMessages(prev, page.data));
      }
    } catch {
      // The next resync tries again
    }
  }, []);

  // Rejects if the page could not be loaded
  const loadOlderMessages = useCallback(async () => {
    const chatUserId = openChatUserIdRef.current;
    const teamId = openTeamIdRef.current;
    const oldest = messagesRef.current[0];
    if ((!chatUserId && !teamId) || !oldest) return;

    // Direct messages are dated by timestamp, team messages by createdAt
    const cursor: Cursor = { before: sentAt(oldest), beforeId: oldest._id };
    const stillOpen = () => (teamId ? openTeamIdRef.current === teamId : openChatUserIdRef.current === chatUserId);

    const page = teamId
      ? await chatAPI.teamMessages(teamId, cursor)
      : await chatAPI.messages(chatUserId as string, cursor);
    if (stillOpen()) {
      setMessages((prev) => mergeMessages(prev, page.data));
      setHasMoreMessages(page.hasMore);
    }
  }, []);

  const closeChat = useCallback(() => {
    openChatUserIdRef.current = null;
    openTeamIdRef.current = null;
    setMessages([]);
    setLoadingMessages(false);
    setMessagesError('');
    setHasMoreMessages(false);
    setLatestIncoming(null);
  }, []);

  // ── Sending, editing, deleting, reporting ────────────────────────────────

  const sendMessage = useCallback(async (receiverId: string, message: string) => {
    const sent = await chatAPI.send(receiverId, message);
    // The receiver gets it over the socket; add the sender's own copy here
    if (receiverId === openChatUserIdRef.current) {
      setMessages((prev) => mergeMessages(prev, sent));
    }
    noteConversationMessage(sent);
  }, [noteConversationMessage]);

  const sendTeamMessage = useCallback(async (teamId: string, message: string) => {
    const sent = await chatAPI.teamSend(teamId, message);
    // Everyone in the team, the sender included, also gets it over the socket
    if (teamId === openTeamIdRef.current) {
      setMessages((prev) => mergeMessages(prev, sent));
    }
    noteTeamMessage(sent);
  }, [noteTeamMessage]);

  const showChanged = useCallback((changed: Message) => {
    const teamId = teamIdOf(changed);
    if (teamId) {
      if (teamId === openTeamIdRef.current) setMessages((prev) => mergeMessages(prev, changed));
      patchTeamMessage(changed);
    } else {
      setMessages((prev) => mergeMessages(prev, changed));
      patchConversationMessage(changed);
    }
  }, [patchConversationMessage, patchTeamMessage]);

  const editMessage = useCallback(async (message: Message, text: string) => {
    const teamId = teamIdOf(message);
    showChanged(teamId ? await chatAPI.teamEdit(teamId, message._id, text) : await chatAPI.edit(message._id, text));
  }, [showChanged]);

  const deleteMessage = useCallback(async (message: Message) => {
    const teamId = teamIdOf(message);
    showChanged(teamId ? await chatAPI.teamRemove(teamId, message._id) : await chatAPI.remove(message._id));
  }, [showChanged]);

  const reportMessage = useCallback((message: Message, reason?: string) => {
    const teamId = teamIdOf(message);
    return teamId ? chatAPI.teamReport(teamId, message._id, reason) : chatAPI.report(message._id, reason);
  }, []);

  const setTyping = useCallback((isTyping: boolean, recipientId: string) => {
    socket?.emit(isTyping ? 'typing' : 'stopped_typing', { recipientId });
  }, [socket]);

  const refreshContacts = useCallback(() => {
    socket?.emit('refresh_contacts');
  }, [socket]);

  // ── The live connection ──────────────────────────────────────────────────

  useEffect(() => {
    // Wait until the session has been confirmed: a rejected session would
    // otherwise fail these requests and redirect to the login page
    if (!userId || loading) return;

    const typingTimers = typingTimersRef.current;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hasConnected = false;

    // The socket server never sees the session cookie, so every (re)connection
    // gets a fresh one-minute ticket. The server identifies the user from it
    // and joins their room itself.
    const newSocket = io(socketBaseUrl, {
      auth: (callback) => {
        chatAPI.socketToken()
          .then((token) => callback({ token }))
          .catch(() => callback({}));
      },
    });

    // Unread counts are stored on the server, so they survive a page reload
    void refreshUnread();

    const scheduleRetry = () => {
      if (retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!newSocket.connected && !newSocket.active) newSocket.connect();
      }, SOCKET_RETRY_MS);
    };
    const connectionLost = () => {
      setConnection(navigator.onLine ? 'reconnecting' : 'offline');
      if (!newSocket.active) scheduleRetry();
    };

    newSocket.on('connect', () => {
      setConnection('connected');
      if (hasConnected) {
        // Anything sent while the connection was down is fetched now
        void refreshUnread();
        if (conversationsLoadedRef.current) void loadConversations();
        if (teamChatsLoadedRef.current) void loadTeamChats();
        void resyncOpen();
      }
      hasConnected = true;
    });
    newSocket.on('connect_error', (error) => {
      console.error('Chat connection failed:', error.message);
      connectionLost();
    });
    newSocket.on('disconnect', (reason) => {
      // Who is online is unknown until the socket reconnects and the server
      // sends the list again
      setActiveUsers([]);
      // We closed it ourselves (signing out)
      if (reason !== 'io client disconnect') connectionLost();
    });

    const onOffline = () => setConnection('offline');
    const onOnline = () => {
      if (newSocket.connected) return;
      setConnection('reconnecting');
      if (!newSocket.active) newSocket.connect();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    newSocket.on('receive_message', (data: Message) => {
      const senderId = participantId(data.sender);
      if (!senderId) return;
      // Show the message only in its own conversation; anything else counts as unread
      if (senderId === openChatUserIdRef.current) {
        setMessages((prev) => mergeMessages(prev, data));
        setLatestIncoming(data);
        chatAPI.markConversationRead(senderId).catch((error) => console.error('Error marking messages read:', error));
        noteConversationMessage({ ...data, isRead: true });
      } else {
        setUnreadCounts((prev) => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }));
        noteConversationMessage(data);
      }
      setTypingUsers((prev) => prev.filter((t) => t.userId !== senderId));
    });

    // An edit or a deletion, on either side
    const directChanged = (message: Message) => {
      if (!message?._id) return;
      setMessages((prev) => (prev.some((m) => m._id === message._id) ? mergeMessages(prev, message) : prev));
      patchConversationMessage(message);
      // A deleted message no longer counts as unread
      if (isDeleted(message) && participantId(message.receiver) === userId) void refreshUnread();
    };
    newSocket.on('message_updated', directChanged);
    newSocket.on('message_deleted', directChanged);

    // Read receipts for messages this user sent
    newSocket.on('message_read', (message: Message) => {
      setMessages((prev) => (prev.some((m) => m._id === message._id) ? mergeMessages(prev, message) : prev));
      patchConversationMessage(message);
    });
    newSocket.on('messages_read', ({ readerId }: { readerId: string }) => {
      setMessages((prev) => prev.map((m) => (participantId(m.receiver) === readerId ? { ...m, isRead: true } : m)));
      setConversations((prev) =>
        prev.map((row) =>
          row.user._id === readerId && row.lastMessage.fromMe
            ? { ...row, lastMessage: { ...row.lastMessage, isRead: true } }
            : row,
        ),
      );
    });

    newSocket.on('receive_team_message', (payload: Message | { data: Message }) => {
      const message = 'data' in payload ? payload.data : payload;
      const teamId = teamIdOf(message);
      if (!teamId) return;
      const mine = participantId(message.sender) === userId;

      if (openTeamIdRef.current === teamId) {
        setMessages((prev) => mergeMessages(prev, message));
        if (!mine) {
          setLatestIncoming(message);
          void markTeamMessagesAsRead(teamId);
        }
      } else if (!mine) {
        setTeamUnreadCounts((prev) => ({ ...prev, [teamId]: (prev[teamId] || 0) + 1 }));
      }
      noteTeamMessage(message);
    });

    const teamChanged = (payload: Message | { data: Message }) => {
      const message = 'data' in payload ? payload.data : payload;
      const teamId = teamIdOf(message);
      if (!teamId) return;
      if (openTeamIdRef.current === teamId) {
        setMessages((prev) => (prev.some((m) => m._id === message._id) ? mergeMessages(prev, message) : prev));
      } else if (isDeleted(message)) {
        // It may have been one of the unread ones
        void refreshUnread();
      }
      patchTeamMessage(message);
    };
    newSocket.on('team_message_updated', teamChanged);
    newSocket.on('team_message_deleted', teamChanged);

    newSocket.on('team_messages_read', (receipt: TeamReadReceipt) => {
      if (openTeamIdRef.current !== receipt.teamId) return;
      setMessages((prev) => applyTeamReadReceipt(prev, receipt));
    });

    const stopTyping = (typingUserId: string) => {
      const timer = typingTimers.get(typingUserId);
      if (timer) clearTimeout(timer);
      typingTimers.delete(typingUserId);
      setTypingUsers((prev) => prev.filter((t) => t.userId !== typingUserId));
    };
    newSocket.on('user_typing', (data: TypingStatus) => {
      setTypingUsers((prev) => [...prev.filter((t) => t.userId !== data.userId), data]);
      const timer = typingTimers.get(data.userId);
      if (timer) clearTimeout(timer);
      typingTimers.set(data.userId, setTimeout(() => stopTyping(data.userId), TYPING_EXPIRY_MS));
    });
    newSocket.on('user_stopped_typing', ({ userId: typingUserId }: { userId: string }) => stopTyping(typingUserId));

    // Now only the user's own contacts who are online
    newSocket.on('update_active_users', (users: string[]) => {
      setActiveUsers(Array.isArray(users) ? users : []);
    });

    setSocket(newSocket);

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      typingTimers.forEach((timer) => clearTimeout(timer));
      typingTimers.clear();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      newSocket.close();
      // Don't leave one account's messages in memory for the next login
      setSocket(null);
      setConnection('connecting');
      setActiveUsers([]);
      setMessages([]);
      setUnreadCounts({});
      setTeamUnreadCounts({});
      setConversations([]);
      setConversationsStatus(INITIAL_STATUS);
      setTeamChats([]);
      setTeamChatsStatus(INITIAL_STATUS);
      setBlocked([]);
      setBlocksStatus(INITIAL_STATUS);
      setLatestIncoming(null);
      setTypingUsers([]);
      openChatUserIdRef.current = null;
      openTeamIdRef.current = null;
    };
  }, [
    userId,
    loading,
    refreshUnread,
    loadConversations,
    loadTeamChats,
    resyncOpen,
    markTeamMessagesAsRead,
    noteConversationMessage,
    patchConversationMessage,
    noteTeamMessage,
    patchTeamMessage,
  ]);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = setInterval(() => {
      if (openTeamIdRef.current) void resyncOpen();
    }, ADMIN_TEAM_POLL_MS);
    return () => clearInterval(timer);
  }, [isAdmin, resyncOpen]);

  // Everything unread, for the badge in the navigation
  const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0);
  const totalUnread = sum(unreadCounts) + sum(teamUnreadCounts);

  return (
    <ChatContext.Provider
      value={{
        socket,
        connection,
        activeUsers,
        refreshContacts,
        unreadCounts,
        teamUnreadCounts,
        totalUnread,
        refreshUnread,
        clearUnread,
        conversations,
        conversationsStatus,
        loadConversations,
        teamChats,
        teamChatsStatus,
        loadTeamChats,
        blocked,
        blocksStatus,
        loadBlocks,
        blockUser,
        unblockUser,
        messages,
        loadingMessages,
        messagesError,
        hasMoreMessages,
        latestIncoming,
        fetchMessages,
        fetchTeamMessages,
        loadOlderMessages,
        closeChat,
        sendMessage,
        sendTeamMessage,
        editMessage,
        deleteMessage,
        reportMessage,
        markTeamMessagesAsRead,
        typingUsers,
        setTyping,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

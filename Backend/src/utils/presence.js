import User from '../models/User.js';
import { directMessageProblem, messageableUserIds } from './messaging.js';
import { getIo } from './realtime.js';

// What each chat socket knows and is told: its user's room, who is online
// among the people that user may message, and typing indicators.
//
// Every socket keeps its own list of contacts (the people its user may
// message, from messageableUserIds; null for an admin, who may message
// everyone) and is only ever told which of them are online. Like the rate
// limits, this lives in memory: one backend instance only.

// Tests can shorten these outside production
const setting = (name, fallback) => {
  const value = Number(process.env[name]);
  return process.env.NODE_ENV !== 'production' && value > 0 ? value : fallback;
};
// A socket's contacts are looked up again once they are this old
const CONTACTS_TTL_MS = setting('CHAT_CONTACTS_TTL_MS', 5 * 60 * 1000);
// Someone a socket may send typing indicators to is checked again after this
const TYPING_TTL_MS = setting('CHAT_TYPING_TTL_MS', 60 * 1000);
// Presence changes go out at most once a second, all together
const BROADCAST_EVERY_MS = 1000;
// A client's own refresh_contacts requests run at most once in this time
const REFRESH_REQUEST_EVERY_MS = 5000;

// userId -> number of open sockets, so closing one tab doesn't mark the user offline
const onlineUsers = new Map();

const sockets = () => getIo()?.of('/').sockets.values() ?? [];

// Sends a socket the online contacts of its user, unless it already has
// exactly that list. The user themselves is never in it.
const sendPresence = (socket, online = [...onlineUsers.keys()]) => {
  if (!socket.data.contactsReady) return;
  const { contacts, userId } = socket.data;
  const visible = online.filter((id) => id !== userId && (contacts === null || contacts.has(id))).sort();
  const key = visible.join(',');
  if (key === socket.data.presenceKey) return;
  socket.data.presenceKey = key;
  socket.emit('update_active_users', visible);
};

const loadContacts = async (socket) => {
  const user = await User.findById(socket.data.userId).select('role isActive');
  const ids = user?.isActive ? await messageableUserIds(user) : [];
  socket.data.contacts = ids === null ? null : new Set(ids);
  socket.data.contactsAt = Date.now();
  socket.data.contactsReady = true;
  // Typing permissions are checked again too, so a new block or a frozen
  // team takes effect at once
  socket.data.typingAllowed = new Map();
  sendPresence(socket);
};

// Looks up a socket's contacts again and sends it the new list if it changed.
// One lookup at a time per socket; a request during one runs once it ends.
const refreshContacts = (socket) => {
  if (socket.data.contactsLoading) {
    socket.data.contactsStale = true;
    return;
  }
  socket.data.contactsLoading = true;
  loadContacts(socket)
    .catch((error) => console.error('Loading chat contacts failed:', error.message))
    .finally(() => {
      socket.data.contactsLoading = false;
      if (socket.data.contactsStale && socket.connected) {
        socket.data.contactsStale = false;
        refreshContacts(socket);
      }
    });
};

const isStale = (socket, now = Date.now()) =>
  socket.data.contactsReady && now - socket.data.contactsAt > CONTACTS_TTL_MS;

let broadcastTimer = null;
let lastBroadcastAt = 0;

const broadcastPresence = () => {
  lastBroadcastAt = Date.now();
  const online = [...onlineUsers.keys()];
  for (const socket of sockets()) {
    sendPresence(socket, online);
    if (isStale(socket, lastBroadcastAt)) refreshContacts(socket);
  }
};

// Coalesces presence changes: the first change after a quiet second goes out
// at once, later ones wait for the rest of that second and go out together
const schedulePresence = () => {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastPresence();
  }, Math.max(0, lastBroadcastAt + BROADCAST_EVERY_MS - Date.now()));
};

// Contacts also change without anyone connecting (a new connection, a team
// change), so stale ones are looked up again in the background
let sweepTimer = null;
const startSweep = () => {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const socket of sockets()) if (isStale(socket, now)) refreshContacts(socket);
  }, Math.min(60 * 1000, CONTACTS_TTL_MS));
  sweepTimer.unref();
};

// Looks up again whom these users may message, for each of their open
// sockets: call it with both people after something changes between them
// (a block, a new connection). Each socket whose list of online contacts
// changes gets a new update_active_users, and typing permissions are checked
// again.
export const refreshPresenceFor = (userIds) => {
  const ids = new Set([].concat(userIds || []).map(String));
  for (const socket of sockets()) {
    if (ids.has(socket.data.userId)) refreshContacts(socket);
  }
};

// Typing indicators for direct chats. Who is typing comes from the verified
// ticket; the client only says to whom, and only someone this user may
// message is told. An allowed recipient is remembered for TYPING_TTL_MS.
const relayTyping = async (socket, recipientId, event, payload) => {
  const { userId } = socket.data;
  if (typeof recipientId !== 'string' || recipientId === userId) return;

  // A refused recipient is checked again on the next event, so typing works
  // as soon as the two may message each other
  const allowed = socket.data.typingAllowed;
  if (!(allowed.get(recipientId) > Date.now())) {
    const sender = await User.findById(userId).select('role');
    if (!sender || (await directMessageProblem(sender, recipientId))) {
      allowed.delete(recipientId);
      return;
    }
    allowed.set(recipientId, Date.now() + TYPING_TTL_MS);
  }
  socket.to(recipientId).emit(event, payload);
};

// Socket.io connection handler (server.js). The room each socket joins comes
// from the verified ticket (socket.data.userId), never from the client.
export const handleChatSocket = (socket) => {
  const { userId } = socket.data;
  socket.join(userId);
  socket.data.typingAllowed = new Map();
  onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1);
  startSweep();

  // This socket gets its own first list once its contacts are known; the
  // people who have this user as a contact hear in the next broadcast
  refreshContacts(socket);
  schedulePresence();

  // The payload is whatever the client sent (null, a number, ...): read it
  // defensively, because an exception in a socket handler stops the server
  socket.on('typing', (data) => {
    relayTyping(socket, data?.recipientId, 'user_typing', { userId, userName: socket.data.userName }).catch(() => {});
  });
  socket.on('stopped_typing', (data) => {
    relayTyping(socket, data?.recipientId, 'user_stopped_typing', { userId }).catch(() => {});
  });

  // The client asks for this after something that changes whom the user may
  // message (accepting a connection, joining a team). At most once in
  // REFRESH_REQUEST_EVERY_MS; a request inside that time runs at its end.
  let refreshTimer = null;
  socket.on('refresh_contacts', () => {
    if (refreshTimer) return;
    const wait = (socket.data.refreshRequestedAt || 0) + REFRESH_REQUEST_EVERY_MS - Date.now();
    const run = () => {
      refreshTimer = null;
      socket.data.refreshRequestedAt = Date.now();
      refreshContacts(socket);
    };
    if (wait <= 0) run();
    else refreshTimer = setTimeout(run, wait);
  });

  socket.on('disconnect', () => {
    clearTimeout(refreshTimer);
    const remaining = (onlineUsers.get(userId) || 1) - 1;
    if (remaining > 0) {
      onlineUsers.set(userId, remaining);
    } else {
      onlineUsers.delete(userId);
    }
    schedulePresence();
  });
};

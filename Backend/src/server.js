import express from 'express';
import http from 'http';
import { Server as SocketIO } from 'socket.io';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import connectDB from './config/database.js';
import { getUserFromToken } from './middleware/auth.js';
import User from './models/User.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { directMessageProblem, messageableUserIds, onContactsChanged } from './utils/messaging.js';
import { SOCKET_AUDIENCE, originMatcher, rejectForeignOrigin, requireProxy } from './utils/session.js';
import { setIo } from './utils/realtime.js';
import { startScheduler } from './utils/scheduler.js';
import './jobs/index.js';
import v2Routes from './routes/v2Routes.js';

dotenv.config();

// Fail at startup instead of on the first login
for (const name of ['MONGODB_URI', 'JWT_SECRET']) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

// Browser origins allowed to call the API and open sockets. Set CLIENT_URL to
// the deployed frontend's origin (comma-separated for more than one; * patterns
// work for preview deployments, see originMatcher).
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://pandav.onrender.com',
  ...[process.env.CLIENT_URL, process.env.FRONTEND_URL]
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
];
const isAllowedOrigin = originMatcher(allowedOrigins);

if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_URL && !process.env.FRONTEND_URL) {
  console.warn('CLIENT_URL is not set: browsers on the deployed frontend will be blocked by CORS');
}
if (process.env.NODE_ENV === 'production' && !process.env.ORIGIN_SECRET) {
  console.warn('ORIGIN_SECRET is not set: rate limits will count every visitor behind the frontend proxy as one');
}

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: {
    origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
    methods: ['GET', 'POST']
  }
});
setIo(io);

const PORT = process.env.PORT || 5000;
const API_V2_PREFIX = process.env.API_V2_PREFIX || '/api/v2';

// Socket.io: only authenticated users can connect, and the room each socket
// joins comes from the verified ticket (POST /api/auth/socket-token), never
// from the client
io.use(async (socket, next) => {
  try {
    const { user, claims } = (await getUserFromToken(socket.handshake.auth?.token, SOCKET_AUDIENCE)) || {};
    if (!user) return next(new Error('Not authorized'));
    socket.data.userId = user._id.toString();
    socket.data.userName = user.name;
    // The session the ticket was issued to (see disconnectUserSockets)
    socket.data.sid = claims.sid;
    next();
  } catch {
    next(new Error('Not authorized'));
  }
});

// ---------- Chat sockets: rooms, who is online, typing ----------
// Every socket keeps its own list of contacts (the people its user may
// message, from messageableUserIds; null for an admin, who may message
// everyone) and is only ever told which of them are online. Like the rate
// limits, this lives in memory: one backend instance only.

// Tests can shorten these outside production
const chatSetting = (name, fallback) => {
  const value = Number(process.env[name]);
  return process.env.NODE_ENV !== 'production' && value > 0 ? value : fallback;
};
// A socket's contacts are looked up again once they are this old,
const CONTACTS_TTL_MS = chatSetting('CHAT_CONTACTS_TTL_MS', 5 * 60 * 1000);
// and this long after a lookup that failed
const CONTACTS_RETRY_MS = chatSetting('CHAT_CONTACTS_RETRY_MS', 5 * 1000);
// Someone a socket may send typing indicators to is checked again after this
const TYPING_TTL_MS = chatSetting('CHAT_TYPING_TTL_MS', 60 * 1000);
// Presence changes go out at most once a second, all together
const PRESENCE_EVERY_MS = 1000;
// A client's own refresh_contacts requests run at most once in this time
const REFRESH_REQUEST_EVERY_MS = 5000;

// userId -> number of open sockets, so closing one tab doesn't mark the user offline
const onlineUsers = new Map();

const chatSockets = () => io.of('/').sockets.values();

// Sends a socket the online contacts of its user, unless it already has
// exactly that list. The user themselves is never in it. A socket whose
// contacts were never loaded gets nothing yet.
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
  socket.data.contactsReady = true;
  // Typing permissions are checked again too, so a block or a frozen team
  // takes effect at once
  socket.data.typingAllowed = new Map();
  sendPresence(socket);
};

// Looks up a socket's contacts again and sends it the new list if it changed.
// One lookup at a time per socket; a request during one runs once it ends.
// A lookup that fails keeps the list the socket had (none, the first time)
// and is tried again CONTACTS_RETRY_MS later (see contactsDue).
const refreshContacts = (socket) => {
  if (socket.data.contactsLoading) {
    socket.data.contactsStale = true;
    return;
  }
  socket.data.contactsLoading = true;
  loadContacts(socket)
    .then(() => { socket.data.contactsFailed = false; })
    .catch((error) => {
      socket.data.contactsFailed = true;
      console.error('Loading chat contacts failed:', error.message);
    })
    .finally(() => {
      socket.data.contactsAt = Date.now();
      socket.data.contactsLoading = false;
      if (socket.data.contactsStale && socket.connected) {
        socket.data.contactsStale = false;
        refreshContacts(socket);
      }
    });
};

// Whether a socket's contacts should be looked up again: CONTACTS_TTL_MS
// after the last lookup, or CONTACTS_RETRY_MS after one that failed
const contactsDue = (socket, now = Date.now()) =>
  !socket.data.contactsLoading &&
  now - (socket.data.contactsAt ?? 0) > (socket.data.contactsFailed ? CONTACTS_RETRY_MS : CONTACTS_TTL_MS);

let presenceTimer = null;
let lastPresenceAt = 0;

const broadcastPresence = () => {
  lastPresenceAt = Date.now();
  const online = [...onlineUsers.keys()];
  for (const socket of chatSockets()) {
    sendPresence(socket, online);
    if (contactsDue(socket, lastPresenceAt)) refreshContacts(socket);
  }
};

// Coalesces presence changes: the first change after a quiet second goes out
// at once, later ones wait for the rest of that second and go out together
const schedulePresence = () => {
  if (presenceTimer) return;
  presenceTimer = setTimeout(() => {
    presenceTimer = null;
    broadcastPresence();
  }, Math.max(0, lastPresenceAt + PRESENCE_EVERY_MS - Date.now()));
};

// Contacts also change without anyone connecting (a new connection, a team
// change), and a lookup can fail, so due ones are looked up in the background
let contactsSweep = null;
const startContactsSweep = () => {
  if (contactsSweep) return;
  contactsSweep = setInterval(() => {
    const now = Date.now();
    for (const socket of chatSockets()) if (contactsDue(socket, now)) refreshContacts(socket);
  }, Math.min(CONTACTS_TTL_MS, CONTACTS_RETRY_MS));
  contactsSweep.unref();
};

// A block or an unblock (contactsChanged in utils/messaging.js): both
// people's sockets look up their contacts again at once
onContactsChanged((userIds) => {
  for (const socket of chatSockets()) {
    if (userIds.includes(socket.data.userId)) refreshContacts(socket);
  }
});

// Typing indicators for direct chats. Who is typing comes from the verified
// ticket; the client only says to whom, and only someone this user may
// message is told. An allowed recipient is remembered for TYPING_TTL_MS.
const relayTyping = async (socket, recipientId, event, payload) => {
  if (typeof recipientId !== 'string') return;
  // Rooms are named after lower-case ids
  const recipient = recipientId.toLowerCase();
  if (recipient === socket.data.userId) return;

  // A refused recipient is checked again on the next event, so typing works
  // as soon as the two may message each other
  const allowed = socket.data.typingAllowed;
  if (!(allowed.get(recipient) > Date.now())) {
    const sender = await User.findById(socket.data.userId).select('role');
    if (!sender || (await directMessageProblem(sender, recipient))) {
      allowed.delete(recipient);
      return;
    }
    allowed.set(recipient, Date.now() + TYPING_TTL_MS);
  }
  socket.to(recipient).emit(event, payload);
};

io.on('connection', (socket) => {
  const { userId } = socket.data;
  socket.join(userId);
  socket.data.typingAllowed = new Map();
  onlineUsers.set(userId, (onlineUsers.get(userId) || 0) + 1);
  startContactsSweep();

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
});

// Connect to MongoDB
connectDB();

// Make io accessible in controllers
app.set('io', io);

// Hosts like Render put one proxy in front of the app; without this every
// client shares the proxy's IP and rate limits apply to everyone at once
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    // Requests without an Origin header (Postman, curl, server-to-server) aren't subject to CORS
    callback(null, !origin || isAllowedOrigin(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use('/api', requireProxy);
// Responses are per-user; never let the proxy's CDN or the browser cache them
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', rejectForeignOrigin(isAllowedOrigin));
// Bodies are at most 1 MB (the largest is a profile image, ~200 KB), except
// file uploads (POST .../attachments), which carry a file of up to 2 MB as base64
const jsonBody = express.json({ limit: '1mb' });
const uploadBody = express.json({ limit: '3mb' });
app.use((req, res, next) =>
  (req.method === 'POST' && /\/attachments\/?$/.test(req.path) ? uploadBody : jsonBody)(req, res, next));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(sanitizeInput);

// The whole API, health check included (${API_V2_PREFIX}/health). The old
// copies under /api and /api/v1 are gone.
app.use(API_V2_PREFIX, v2Routes);

// Error handling middleware (Express recognises it by its four parameters)
app.use((err, req, res, _next) => {
  // Body parsing errors (too large, malformed JSON) are the client's, with their own 4xx status
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({
      success: false,
      message: err.type === 'entity.too.large' ? 'Request is too large' : 'Invalid request body',
    });
  }

  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

startScheduler();

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}${API_V2_PREFIX}`);
});



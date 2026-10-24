// The Socket.io server, for code that runs outside a request (background
// jobs, notifications) and has no req.app to get it from. Set once by server.js.
let io = null;

export const setIo = (server) => {
  io = server;
};

export const getIo = () => io;

// Each user's sockets are in a room named after their id. Every socket also
// remembers the session it was opened from (socket.data.sid, from the socket
// ticket), so one browser's sign-out can close only that browser's sockets.
//   disconnectUserSockets(userId)                    every socket of the user
//   disconnectUserSockets(userId, { onlySid })       one session's sockets
//   disconnectUserSockets(userId, { exceptSid })     all but one session's
export const disconnectUserSockets = async (userId, { onlySid, exceptSid } = {}) => {
  if (!io || !userId) return;
  const room = String(userId);
  if (onlySid === undefined && exceptSid === undefined) {
    io.in(room).disconnectSockets(true);
    return;
  }
  const sockets = await io.in(room).fetchSockets();
  for (const socket of sockets) {
    const sid = socket.data?.sid;
    if (onlySid !== undefined && sid !== onlySid) continue;
    if (exceptSid !== undefined && sid === exceptSid) continue;
    socket.disconnect(true);
  }
};

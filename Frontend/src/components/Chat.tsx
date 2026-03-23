import { useState, useRef, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';

interface ChatProps {
  receiverId: string;
  receiverName: string;
  teamId?: string;
}

type ChatMessage = Record<string, any>;

const getMessageDate = (message: ChatMessage) => {
  const rawValue = message.timestamp || message.createdAt || message.updatedAt;

  if (!rawValue) return null;

  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatMessageTime = (message: ChatMessage) => {
  const date = getMessageDate(message);
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
};

const formatMessageDateTime = (message: ChatMessage) => {
  const date = getMessageDate(message);
  return date
    ? date.toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Not available';
};

const getSenderName = (message: ChatMessage, fallbackName: string) => {
  if (typeof message.sender === 'object' && message.sender?.name) {
    return message.sender.name;
  }

  return fallbackName;
};

const getTeamReaders = (message: ChatMessage, currentUserId?: string) => {
  const readByList = Array.isArray(message.readBy) ? message.readBy : [];

  return readByList
    .map((entry) => entry?.user)
    .filter((reader) => reader && reader._id && reader._id !== currentUserId);
};

const getMessageStatus = (message: ChatMessage, isMine: boolean, isTeamChat: boolean) => {
  if (!isMine) return null;
  if (isTeamChat) {
    const readerCount = getTeamReaders(message).length;
    return readerCount > 0 ? `Seen by ${readerCount}` : 'Team sent';
  }
  return message.isRead ? 'Read' : 'Sent';
};

const getReadByLabel = (
  message: ChatMessage,
  isMine: boolean,
  isTeamChat: boolean,
  receiverName: string,
  currentUserId?: string,
) => {
  if (!isMine) return null;

  if (isTeamChat) {
    const readers = getTeamReaders(message, currentUserId);

    if (readers.length === 0) {
      return 'No team members have read this yet.';
    }

    return readers.map((reader) => reader.name || reader.email || 'Unknown user').join(', ');
  }

  return message.isRead ? `Read by ${receiverName}` : `Not read by ${receiverName} yet`;
};

export default function Chat({ receiverId, receiverName, teamId }: ChatProps) {
  const {
    messages,
    sendMessage,
    fetchMessages,
    loadingMessages,
    typingUsers,
    setTyping,
    sendTeamMessage,
    fetchTeamMessages,
    markMessageAsRead,
  } = useChat();
  const { user } = useAuth();
  const [inputMessage, setInputMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isTypingLocally, setIsTypingLocally] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTeamChat = Boolean(teamId);

  useEffect(() => {
    if (teamId) {
      fetchTeamMessages(teamId);
    } else {
      fetchMessages(receiverId);
    }
  }, [fetchMessages, fetchTeamMessages, receiverId, teamId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputMessage(value);

    if (!isTypingLocally && value.length > 0) {
      setIsTypingLocally(true);
      setTyping(true, teamId || receiverId);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (value.length === 0) {
        setIsTypingLocally(false);
        setTyping(false, teamId || receiverId);
      }
    }, 1500);
  };

  const handleSend = async () => {
    if (!inputMessage.trim() || sending) return;
    setSending(true);
    setIsTypingLocally(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setTyping(false, teamId || receiverId);

    try {
      if (teamId) {
        await sendTeamMessage(teamId, inputMessage);
      } else {
        await sendMessage(receiverId, inputMessage);
      }
      setInputMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    messages.forEach((msg) => {
      if (!msg.isRead && msg.receiver?._id === user?._id) {
        markMessageAsRead(msg._id);
      }
    });
  }, [markMessageAsRead, messages, user?._id]);

  const currentUserId = user?._id;
  const remoteTypingUsers = typingUsers.filter((t) => t.userId !== currentUserId);

  useEffect(() => {
    if (!selectedMessage?._id) return;

    const updatedSelectedMessage = messages.find((message) => message._id === selectedMessage._id);
    if (updatedSelectedMessage) {
      setSelectedMessage(updatedSelectedMessage as ChatMessage);
    }
  }, [messages, selectedMessage?._id]);

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b bg-neutral-50 px-4 py-3">
          <div>
            <p className="font-semibold text-neutral-800">{receiverName}</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {isTeamChat ? 'Team conversation' : 'Direct conversation'}
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            Tap a message for info
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4">
          {loadingMessages ? (
            <div className="flex animate-pulse flex-col gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                  <div className={`h-12 rounded-2xl bg-gray-200 ${i % 2 === 0 ? 'w-48' : 'w-36'}`} />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <p className="mt-8 text-center text-sm text-neutral-400">No messages yet. Say hello!</p>
          ) : (
            messages.map((msg, idx) => {
              const isMine = (msg.sender?._id || msg.sender) === currentUserId;
              const messageTime = formatMessageTime(msg as ChatMessage);
              const messageStatus = getMessageStatus(msg as ChatMessage, isMine, isTeamChat);
              const senderName = getSenderName(msg as ChatMessage, receiverName);

              return (
                <div key={msg._id || idx} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedMessage(msg as ChatMessage)}
                    className={`max-w-md rounded-2xl px-4 py-3 text-left shadow-sm transition-transform hover:scale-[1.01] ${
                      isMine
                        ? 'bg-emerald-600 text-white'
                        : 'border border-slate-200 bg-white text-gray-900'
                    }`}
                  >
                    {isTeamChat && !isMine ? (
                      <p className={`mb-1 text-xs font-semibold ${isMine ? 'text-emerald-100' : 'text-emerald-700'}`}>
                        {senderName}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm leading-6">{msg.message}</p>
                    <div className="mt-2 flex items-center justify-end gap-2 text-[11px]">
                      {messageTime ? (
                        <span className={isMine ? 'text-emerald-100' : 'text-slate-500'}>{messageTime}</span>
                      ) : null}
                      {messageStatus ? (
                        <span
                          className={`rounded-full px-2 py-0.5 font-semibold ${
                            isMine
                              ? msg.isRead
                                ? 'bg-emerald-500/30 text-white'
                                : 'bg-white/20 text-emerald-50'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {messageStatus}
                        </span>
                      ) : null}
                    </div>
                  </button>
                </div>
              );
            })
          )}

          {remoteTypingUsers.length > 0 && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-gray-900 shadow-sm">
                <span className="text-xs text-gray-600">
                  {remoteTypingUsers.map((t) => t.userName).join(', ')}{' '}
                  {remoteTypingUsers.length === 1 ? 'is' : 'are'} typing
                </span>
                <span className="flex gap-0.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: '0.2s' }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: '0.4s' }}
                  />
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t bg-white p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputMessage}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={`Message ${receiverName}...`}
              className="flex-1 rounded-xl border px-3 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              onClick={handleSend}
              disabled={sending || !inputMessage.trim()}
              className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white transition-opacity hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Send message (Enter)"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {selectedMessage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-md rounded-3xl border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Message info</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {isTeamChat ? 'Team chat details' : 'Direct chat details'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMessage(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm leading-6 text-slate-900">{selectedMessage.message}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sender</p>
                  <p className="mt-2 text-sm text-slate-900">
                    {getSenderName(selectedMessage, receiverName)}
                  </p>
                </div>
                <div className="rounded-2xl border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
                  <p className="mt-2 text-sm text-slate-900">
                    {getMessageStatus(
                      selectedMessage,
                      (selectedMessage.sender?._id || selectedMessage.sender) === currentUserId,
                      isTeamChat,
                    ) || 'Received'}
                  </p>
                </div>
                <div className="rounded-2xl border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Read by</p>
                  <p className="mt-2 text-sm text-slate-900">
                    {getReadByLabel(
                      selectedMessage,
                      (selectedMessage.sender?._id || selectedMessage.sender) === currentUserId,
                      isTeamChat,
                      receiverName,
                      currentUserId,
                    ) || 'You received this message'}
                  </p>
                </div>
                <div className="rounded-2xl border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sent at</p>
                  <p className="mt-2 text-sm text-slate-900">{formatMessageDateTime(selectedMessage)}</p>
                </div>
                <div className="rounded-2xl border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Message type</p>
                  <p className="mt-2 text-sm text-slate-900">
                    {isTeamChat ? 'Team message' : 'Direct message'}
                  </p>
                </div>
              </div>

              {selectedMessage.isEdited ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Edited {selectedMessage.editedAt ? formatMessageDateTime(selectedMessage) : 'after sending'}.
                </div>
              ) : null}

              {!isTeamChat && (selectedMessage.sender?._id || selectedMessage.sender) === currentUserId ? (
                <div
                  className={`rounded-2xl px-4 py-3 text-sm ${
                    selectedMessage.isRead
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border border-slate-200 bg-slate-50 text-slate-700'
                  }`}
                >
                  {selectedMessage.isRead
                    ? `This message has been read by ${receiverName}.`
                    : `This message has been sent, but ${receiverName} has not read it yet.`}
                </div>
              ) : null}

              {isTeamChat && (selectedMessage.sender?._id || selectedMessage.sender) === currentUserId ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {getTeamReaders(selectedMessage, currentUserId).length > 0
                    ? `Read by ${getReadByLabel(selectedMessage, true, true, receiverName, currentUserId)}`
                    : 'No team members have read this message yet.'}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

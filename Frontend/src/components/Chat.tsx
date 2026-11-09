import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Ban, Snowflake, Users } from 'lucide-react';
import { getErrorMessage } from '../api/axios';
import { useAuth } from '../context/useAuth';
import { useChat, isDeleted, participantId, type Message } from '../context/useChat';
import { useFeedback } from '../context/useFeedback';
import Avatar from './chat/Avatar';
import Composer from './chat/Composer';
import ConnectionStrip from './chat/ConnectionStrip';
import MessageInfoDialog from './chat/MessageInfoDialog';
import MessageItem from './chat/MessageItem';
import { useBlocking } from './chat/useBlocking';
import { describePerson, dayKey, dayLabel, EDIT_WINDOW_MS, messageDate, participantLabel } from './chat/format';

// The person on the other side of a direct conversation
export interface ChatPerson {
  _id: string;
  name: string;
  profileImage?: string | null;
  role?: string | null;
  department?: string | null;
  // A deleted account: nothing is shown about it and nobody can write to it
  deleted?: boolean;
  // Whether the server says this person can be written to right now
  canMessage?: boolean;
}

interface ChatProps {
  // The person (direct chat) ...
  receiverId: string;
  receiverName: string;
  person?: ChatPerson | null;
  // ... or the team room
  teamId?: string;
  // Under the team's name, e.g. who leads it
  subtitle?: string;
  // The team is frozen: readable, but nothing in it changes
  frozen?: boolean;
  // May delete other people's messages in this team (its leaders)
  canModerate?: boolean;
  // Shown on phones, where the conversation replaces the list
  onBack?: () => void;
  // Extra buttons for the header
  actions?: ReactNode;
}

const NEAR_BOTTOM_PX = 120;
const ANNOUNCEMENT_MS = 5000;

export default function Chat({
  receiverId,
  receiverName,
  person,
  teamId,
  subtitle,
  frozen,
  canModerate,
  onBack,
  actions,
}: ChatProps) {
  const { user, isAdmin } = useAuth();
  const { notify, confirm, prompt } = useFeedback();
  const {
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
    typingUsers,
    setTyping,
    activeUsers,
    blocked,
    blocksStatus,
  } = useChat();
  const { block, unblock, busy: blockBusy } = useBlocking();
  const isTeamChat = Boolean(teamId);
  const currentUserId = user?._id;
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState('');
  const [infoId, setInfoId] = useState<string | null>(null);
  // Moves on, so that edit windows and "Today" stay right in a long-open tab
  const [now, setNow] = useState(() => Date.now());
  // The message whose announcement has been read out by now
  const [announcedId, setAnnouncedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const heightBeforeOlderRef = useRef<number | null>(null);

  const loadConversation = () => {
    if (teamId) void fetchTeamMessages(teamId);
    else if (receiverId) void fetchMessages(receiverId);
  };

  useEffect(() => {
    if (teamId) void fetchTeamMessages(teamId);
    else if (receiverId) void fetchMessages(receiverId);
    // Leaving the conversation makes new messages from it count as unread
    return () => closeChat();
  }, [fetchMessages, fetchTeamMessages, closeChat, receiverId, teamId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // An announcement is not left in the page once it has been read out
  const incomingId = latestIncoming?._id;
  useEffect(() => {
    if (!incomingId) return;
    const timer = setTimeout(() => setAnnouncedId(incomingId), ANNOUNCEMENT_MS);
    return () => clearTimeout(timer);
  }, [incomingId]);

  // ── Scrolling ────────────────────────────────────────────────────────────

  const oldestId = messages[0]?._id;
  const newestMessage = messages[messages.length - 1];
  const newestId = newestMessage?._id;
  const newestIsMine = participantId(newestMessage?.sender) === currentUserId;

  // Keep what the reader was looking at in place when older messages arrive
  useLayoutEffect(() => {
    const list = scrollRef.current;
    if (list && heightBeforeOlderRef.current !== null) {
      list.scrollTop += list.scrollHeight - heightBeforeOlderRef.current;
      heightBeforeOlderRef.current = null;
    }
  }, [oldestId]);

  // Follow new messages, unless the reader scrolled up to read older ones
  useEffect(() => {
    const list = scrollRef.current;
    if (!list || loadingMessages) return;
    if (stickToBottomRef.current || newestIsMine) list.scrollTop = list.scrollHeight;
  }, [newestId, newestIsMine, loadingMessages]);

  const handleScroll = () => {
    const list = scrollRef.current;
    if (list) stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
  };

  const handleLoadOlder = async () => {
    setLoadingOlder(true);
    setOlderError('');
    heightBeforeOlderRef.current = scrollRef.current?.scrollHeight ?? null;
    try {
      await loadOlderMessages();
    } catch (error) {
      heightBeforeOlderRef.current = null;
      setOlderError(getErrorMessage(error, 'Could not load earlier messages.'));
    } finally {
      setLoadingOlder(false);
    }
  };

  // ── What may be done with each message ───────────────────────────────────

  // In a frozen team only an admin can still change anything
  const canChangeTeam = !isTeamChat || !frozen || isAdmin;
  const canWriteToPerson = !isTeamChat && person?.canMessage !== false && !person?.deleted;
  const blockedByMe = !isTeamChat && blocked.some((entry) => entry._id === receiverId);

  const isMineMessage = (message: Message) => participantId(message.sender) === currentUserId;

  const canEdit = (message: Message) => {
    if (isDeleted(message) || !isMineMessage(message) || !canChangeTeam) return false;
    if (!isTeamChat && (!canWriteToPerson || blockedByMe)) return false;
    const sent = messageDate(message);
    return Boolean(sent) && now - (sent as Date).getTime() < EDIT_WINDOW_MS;
  };

  const canDelete = (message: Message) => {
    if (isDeleted(message) || !canChangeTeam) return false;
    return isMineMessage(message) || Boolean(isTeamChat && (canModerate || isAdmin));
  };

  // Messages sent to you, and other people's messages in your team. Admins
  // are in no team, so they review reports instead of making them.
  const canReport = (message: Message) =>
    !isDeleted(message) && !isMineMessage(message) && !(isTeamChat && isAdmin);

  const handleSend = (text: string) => (teamId ? sendTeamMessage(teamId, text) : sendMessage(receiverId, text));

  const handleDelete = async (message: Message) => {
    const mine = isMineMessage(message);
    const ok = await confirm({
      title: 'Delete this message?',
      message: mine
        ? 'It will show as "Message deleted" for everyone in this conversation.'
        : 'It will show as "Message deleted" for everyone in the team.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMessage(message);
      notify('Deleted for everyone.', 'success');
    } catch (error) {
      notify(getErrorMessage(error, 'Could not delete the message.'), 'error');
    }
  };

  const handleReport = async (message: Message) => {
    const reason = await prompt({
      title: 'Report this message?',
      message: 'An admin will look at it. The sender is not told.',
      label: 'What is wrong with it?',
      confirmLabel: 'Report',
    });
    if (reason === null) return;
    const text = reason.trim();
    if (text.length > 500) {
      notify('Please keep the reason under 500 characters.', 'error');
      return;
    }
    try {
      notify(await reportMessage(message, text), 'success');
    } catch (error) {
      notify(getErrorMessage(error, 'Could not report the message.'), 'error');
    }
  };

  const handleBlock = () => block({ _id: receiverId, name: receiverName, profileImage: person?.profileImage });
  const handleUnblock = () => unblock({ _id: receiverId, name: receiverName });

  // ── Rendering ────────────────────────────────────────────────────────────

  const remoteTypingUsers = isTeamChat ? [] : typingUsers.filter((t) => t.userId === receiverId);
  const infoMessage = infoId ? messages.find((message) => message._id === infoId) : undefined;
  const announcement = latestIncoming && latestIncoming._id !== announcedId
    ? `New message from ${participantLabel(latestIncoming.sender, receiverName)}: ${latestIncoming.message}`
    : '';
  const canBlock = !isTeamChat && !person?.deleted && person?.role !== 'admin';
  const subline = isTeamChat ? subtitle || 'Team conversation' : person ? describePerson(person) : '';

  const today = new Date(now);

  return (
    <section
      aria-label={isTeamChat ? `Team chat: ${receiverName}` : `Conversation with ${receiverName}`}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex items-center gap-3 border-b border-slate-200 bg-neutral-50 px-3 py-3 sm:px-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to conversations"
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-200 lg:hidden"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {isTeamChat ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Users className="h-5 w-5" aria-hidden="true" />
          </div>
        ) : (
          <Avatar
            name={receiverName}
            src={person?.profileImage}
            online={person?.deleted ? undefined : activeUsers.includes(receiverId)}
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-neutral-900">{receiverName}</h2>
          <p className="truncate text-xs text-slate-600">
            {remoteTypingUsers.length > 0 ? 'typing...' : subline || (isTeamChat ? 'Team conversation' : 'Direct conversation')}
          </p>
        </div>
        {actions}
        {canBlock && (
          <button
            type="button"
            onClick={blockedByMe ? handleUnblock : handleBlock}
            disabled={blockBusy || (blocksStatus.loading && !blocksStatus.loaded)}
            aria-label={blockedByMe ? 'Unblock this person' : 'Block this person'}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{blockedByMe ? 'Unblock' : 'Block'}</span>
          </button>
        )}
      </header>

      <ConnectionStrip />

      <div
        ref={scrollRef}
        data-chat-scroll
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 p-3 sm:p-4"
      >
        {!loadingMessages && !messagesError && hasMoreMessages && (
          <div className="mb-3 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={handleLoadOlder}
              disabled={loadingOlder}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {loadingOlder ? 'Loading...' : 'Load earlier messages'}
            </button>
            {olderError && (
              <p role="alert" className="text-xs text-red-700">
                {olderError}
              </p>
            )}
          </div>
        )}

        {loadingMessages ? (
          <div className="flex animate-pulse flex-col gap-3" role="status" aria-label="Loading messages">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                <div className={`h-12 rounded-2xl bg-gray-200 ${i % 2 === 0 ? 'w-48' : 'w-36'}`} />
              </div>
            ))}
          </div>
        ) : messagesError ? (
          <div role="alert" className="mx-auto mt-8 max-w-sm rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800">
            <p>{messagesError}</p>
            <button
              type="button"
              onClick={loadConversation}
              className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-slate-600">
            {isTeamChat || canWriteToPerson ? 'No messages yet. Say hello!' : 'No messages yet.'}
          </p>
        ) : (
          <ol aria-label="Messages" className="space-y-3">
            {messages.map((message, index) => {
              const date = messageDate(message);
              const previous = index > 0 ? messageDate(messages[index - 1]) : null;
              const newDay = Boolean(date) && (!previous || dayKey(previous) !== dayKey(date as Date));

              return (
                <Fragment key={message._id}>
                  {newDay && date ? (
                    <li className="flex justify-center py-1">
                      <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">
                        {dayLabel(date, today)}
                      </span>
                    </li>
                  ) : null}
                  <MessageItem
                    message={message}
                    isMine={isMineMessage(message)}
                    isTeam={isTeamChat}
                    senderName={participantLabel(message.sender, receiverName)}
                    canEdit={canEdit(message)}
                    canDelete={canDelete(message)}
                    canReport={canReport(message)}
                    onInfo={() => setInfoId(message._id)}
                    onEdit={(text) => editMessage(message, text)}
                    onDelete={() => void handleDelete(message)}
                    onReport={() => void handleReport(message)}
                  />
                </Fragment>
              );
            })}
          </ol>
        )}

        {remoteTypingUsers.length > 0 && (
          <div className="mt-3 flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-slate-900 shadow-sm">
              <span className="text-xs text-slate-700">
                {remoteTypingUsers.map((t) => t.userName).join(', ')} {remoteTypingUsers.length === 1 ? 'is' : 'are'}{' '}
                typing
              </span>
              <span className="flex gap-0.5" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 motion-reduce:animate-none" />
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 motion-reduce:animate-none"
                  style={{ animationDelay: '0.2s' }}
                />
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 motion-reduce:animate-none"
                  style={{ animationDelay: '0.4s' }}
                />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* New messages are read out as they arrive, without moving the focus */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        <span key={latestIncoming?._id}>{announcement}</span>
      </p>

      {isTeamChat ? (
        frozen ? (
          <p role="status" className="flex items-start gap-2 border-t border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <Snowflake className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            This team is frozen. You can read its chat, but nothing can be sent or changed until an admin unfreezes it.
          </p>
        ) : (
          <Composer
            placeholder={`Message ${receiverName}...`}
            label={`Message the team ${receiverName}`}
            onSend={handleSend}
          />
        )
      ) : blockedByMe ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-800">
          <p role="status">You blocked {receiverName}. You can't message each other until you unblock them.</p>
          <button
            type="button"
            onClick={handleUnblock}
            disabled={blockBusy}
            className="rounded-lg border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            Unblock
          </button>
        </div>
      ) : !canWriteToPerson ? (
        <p role="status" className="border-t border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-800">
          {person?.deleted
            ? 'This account no longer exists, so it cannot be messaged.'
            : `You can't send messages to ${receiverName} at the moment. You can still read your conversation.`}
        </p>
      ) : (
        <Composer
          placeholder={`Message ${receiverName}...`}
          label={`Message ${receiverName}`}
          onSend={handleSend}
          onTyping={(typing) => setTyping(typing, receiverId)}
        />
      )}

      {infoMessage ? (
        <MessageInfoDialog
          message={infoMessage}
          isTeam={isTeamChat}
          currentUserId={currentUserId}
          receiverName={receiverName}
          onClose={() => setInfoId(null)}
        />
      ) : null}
    </section>
  );
}

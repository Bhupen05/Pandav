import { Snowflake, Users } from 'lucide-react';
import type { Conversation } from '../../api/chatAPI';
import Avatar from './Avatar';
import { describePerson, listTime } from './format';

// What the conversation list shows about one person
export interface ListPerson {
  id: string;
  name: string;
  email?: string;
  photo?: string | null;
  role?: string | null;
  department?: string | null;
  deleted?: boolean;
  // The latest message, for people the user has talked with
  lastMessage?: Conversation['lastMessage'];
}

export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-700 px-1.5 text-xs font-semibold text-white">
      {count > 99 ? '99+' : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

const rowClass = (selected: boolean) =>
  `mx-2 my-1 flex w-[calc(100%-1rem)] items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-emerald-600 ${
    selected ? 'border-emerald-200 bg-emerald-50 shadow-sm' : 'border-transparent'
  }`;

interface PersonRowProps {
  person: ListPerson;
  selected: boolean;
  online: boolean;
  unread: number;
  blocked: boolean;
  onOpen: () => void;
}

export function PersonRow({ person, selected, online, unread, blocked, onOpen }: PersonRowProps) {
  const last = person.lastMessage;
  const details = person.deleted ? '' : describePerson(person);

  return (
    <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined} className={rowClass(selected)}>
      <Avatar name={person.name} src={person.photo} online={person.deleted ? undefined : online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-neutral-900">{person.name}</span>
            {blocked && (
              <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                Blocked
              </span>
            )}
          </p>
          {last && <span className="shrink-0 text-[11px] text-slate-600">{listTime(last.at)}</span>}
        </div>
        {last ? (
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-slate-600">
              {last.deleted ? (
                <span className="italic">{last.fromMe ? 'You: ' : ''}Message deleted</span>
              ) : (
                <>
                  {last.fromMe ? 'You: ' : ''}
                  {last.text}
                </>
              )}
            </p>
            <UnreadBadge count={unread} />
          </div>
        ) : null}
        {details ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{details}</p> : null}
      </div>
    </button>
  );
}

interface TeamRowProps {
  name: string;
  frozen: boolean;
  lastMessage: string | null;
  lastMessageDeleted: boolean;
  lastMessageAt: string | null;
  unread: number;
  selected: boolean;
  onOpen: () => void;
}

export function TeamRow({ name, frozen, lastMessage, lastMessageDeleted, lastMessageAt, unread, selected, onOpen }: TeamRowProps) {
  return (
    <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined} className={rowClass(selected)}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
        <Users className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900">{name}</span>
            {frozen && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                <Snowflake className="h-3 w-3" aria-hidden="true" />
                Frozen
              </span>
            )}
          </p>
          {lastMessageAt && <span className="shrink-0 text-[11px] text-slate-600">{listTime(lastMessageAt)}</span>}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-slate-600">
            {lastMessage === null ? (
              'No messages yet'
            ) : lastMessageDeleted ? (
              <span className="italic">Message deleted</span>
            ) : (
              lastMessage
            )}
          </p>
          <UnreadBadge count={unread} />
        </div>
      </div>
    </button>
  );
}

import { participantId, sentAt, type Message, type Participant } from '../../context/useChat';

// Direct and team messages are at most this long, and can be edited this
// long after they were sent (Backend/Doc/Chat.md)
export const MAX_MESSAGE_LENGTH = 2000;
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

// "Team leader" instead of team_leader
export const roleLabel = (role?: string | null) => {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'team_leader':
      return 'Team leader';
    case 'team_member':
      return 'Team member';
    case 'user':
      return 'User';
    default:
      return role ? role.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()) : '';
  }
};

// "Design · Team member", leaving out what is not known
export const describePerson = (person: { role?: string | null; department?: string | null }) =>
  [person.department, roleLabel(person.role)].filter(Boolean).join(' · ');

export const toDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const messageDate = (message: Message) => toDate(sentAt(message));

export const formatTime = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const formatDateTime = (value?: string | Date | null) => {
  const date = value instanceof Date ? value : toDate(value);
  return date
    ? date.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Not available';
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const daysBetween = (later: Date, earlier: Date) =>
  Math.round((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / 86_400_000);

// One key per local calendar day, to tell where a new day starts
export const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// "Today", "Yesterday", "Mon, 3 Nov", and the year for earlier years
export const dayLabel = (date: Date, now = new Date()) => {
  const days = daysBetween(now, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString([], {
    weekday: days < 7 ? 'long' : 'short',
    day: days < 7 ? undefined : 'numeric',
    month: days < 7 ? undefined : 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
};

// For the conversation lists: the time today, otherwise the day
export const listTime = (value?: string | null, now = new Date()) => {
  const date = toDate(value);
  if (!date) return '';
  const days = daysBetween(now, date);
  if (days === 0) return formatTime(date);
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : '2-digit',
  });
};

export const participantLabel = (participant: Participant | undefined | null, fallback: string) =>
  (typeof participant === 'object' && participant?.name) || fallback;

export const isSameUser = (participant: Participant | undefined | null, userId?: string) =>
  Boolean(userId) && participantId(participant) === userId;

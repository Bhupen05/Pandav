import { participantId, type Message, type Participant } from '../../context/useChat';

type Person = Exclude<Participant, string>;

// Who has read a team message, leaving out its sender
export const getTeamReaders = (message: Message, senderId?: string) => {
  const readBy = Array.isArray(message.readBy) ? message.readBy : [];

  return readBy
    .map((entry) => entry?.user)
    .filter((reader): reader is Person => typeof reader === 'object' && reader !== null && reader._id !== senderId);
};

// "Sent" / "Read" for a direct message, "Team sent" / "Seen by N" for a team one
export const getMessageStatus = (message: Message, isMine: boolean, isTeam: boolean) => {
  if (!isMine) return null;
  if (isTeam) {
    const readers = getTeamReaders(message, participantId(message.sender)).length;
    return readers > 0 ? `Seen by ${readers}` : 'Team sent';
  }
  return message.isRead ? 'Read' : 'Sent';
};

export const getReadByLabel = (message: Message, isMine: boolean, isTeam: boolean, receiverName: string) => {
  if (!isMine) return null;

  if (isTeam) {
    const readers = getTeamReaders(message, participantId(message.sender));
    if (readers.length === 0) return 'No team members have read this yet.';
    return readers.map((reader) => reader.name || reader.email || 'Unknown user').join(', ');
  }

  return message.isRead ? `Read by ${receiverName}` : `Not read by ${receiverName} yet`;
};

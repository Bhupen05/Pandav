import { useEffect, useRef, type ReactNode } from 'react';
import { isDeleted, participantId, type Message } from '../../context/useChat';
import { formatDateTime, messageDate, participantLabel } from './format';
import { getMessageStatus, getReadByLabel } from './messageStatus';

interface MessageInfoDialogProps {
  message: Message;
  isTeam: boolean;
  currentUserId?: string;
  // The other person in a direct chat, or the team
  receiverName: string;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</dt>
      <dd className="mt-2 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export default function MessageInfoDialog({ message, isTeam, currentUserId, receiverName, onClose }: MessageInfoDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const isMine = participantId(message.sender) === currentUserId;
  const deleted = isDeleted(message);

  // showModal keeps focus inside the dialog and closes it on Escape
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  const senderName = participantLabel(message.sender, isMine ? 'You' : receiverName);
  const status = deleted ? 'Deleted' : getMessageStatus(message, isMine, isTeam) || 'Received';
  const readBy = deleted ? null : getReadByLabel(message, isMine, isTeam, receiverName);

  return (
    <dialog
      ref={ref}
      aria-labelledby="message-info-title"
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl bg-white p-0 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 id="message-info-title" className="text-base font-semibold text-slate-900">
            Message info
          </h2>
          <p className="mt-1 text-xs text-slate-600">{isTeam ? 'Team chat details' : 'Direct chat details'}</p>
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      <div className="space-y-4 p-5">
        <div className="rounded-2xl bg-slate-50 p-4">
          {deleted ? (
            <p className="text-sm italic text-slate-600">Message deleted</p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-900 [overflow-wrap:anywhere]">
              {message.message}
            </p>
          )}
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Sender">{isMine ? 'You' : senderName}</Field>
          <Field label="Status">{status}</Field>
          <Field label="Read by">{readBy || 'You received this message'}</Field>
          <Field label="Sent at">{formatDateTime(messageDate(message))}</Field>
          <Field label="Message type">{isTeam ? 'Team message' : 'Direct message'}</Field>
          {message.isEdited && !deleted ? (
            <Field label="Edited at">{message.editedAt ? formatDateTime(message.editedAt) : 'After sending'}</Field>
          ) : null}
          {deleted ? <Field label="Deleted at">{formatDateTime(message.deletedAt)}</Field> : null}
        </dl>
      </div>
    </dialog>
  );
}

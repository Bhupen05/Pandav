import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Ban, Flag, Info, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { getErrorMessage } from '../../api/axios';
import { isDeleted, type Message } from '../../context/useChat';
import { formatTime, MAX_MESSAGE_LENGTH, messageDate } from './format';
import { getMessageStatus } from './messageStatus';

interface MessageItemProps {
  message: Message;
  isMine: boolean;
  isTeam: boolean;
  senderName: string;
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  onInfo: () => void;
  // Rejects with the reason the edit was refused
  onEdit: (text: string) => Promise<void>;
  onDelete: () => void;
  onReport: () => void;
}

// One message, with its own menu (info, edit, delete, report) so that the
// bubble itself is plain text that can be selected and copied
export default function MessageItem({
  message,
  isMine,
  isTeam,
  senderName,
  canEdit,
  canDelete,
  canReport,
  onInfo,
  onEdit,
  onDelete,
  onReport,
}: MessageItemProps) {
  const deleted = isDeleted(message);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  // Which edge of the menu button the menu lines up with: it opens towards
  // the side that has room
  const [menuAlign, setMenuAlign] = useState<'left' | 'right'>('left');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const time = messageDate(message);
  const status = deleted ? null : getMessageStatus(message, isMine, isTeam);

  // Close the menu on a click elsewhere
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (editing) {
      const field = editRef.current;
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
    }
  }, [editing]);

  const toggleMenu = () => {
    if (!menuOpen) {
      // Open upwards when there is little room below, inside the message list
      const button = menuButtonRef.current;
      const scroller = button?.closest('[data-chat-scroll]');
      if (button && scroller) {
        const area = scroller.getBoundingClientRect();
        const spot = button.getBoundingClientRect();
        setMenuAbove(area.bottom - spot.bottom < 190);
        setMenuAlign(area.right - spot.left < 190 ? 'right' : 'left');
      }
    }
    setMenuOpen((open) => !open);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  // The menu closes with the focus back on its button, where a dialog opened
  // from it hands the focus back when it closes
  const choose = (action: () => void) => () => {
    closeMenu();
    action();
  };

  const startEditing = () => {
    setDraft(message.message);
    setEditError('');
    setEditing(true);
  };

  const saveEdit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || saving) return;
    if (text === message.message.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await onEdit(text);
      setEditing(false);
    } catch (error) {
      setEditError(getErrorMessage(error, 'Could not save the change. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const onEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void saveEdit();
    }
  };

  const meta = isMine ? 'text-emerald-50' : 'text-slate-600';

  return (
    <li className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`flex min-w-0 items-end gap-1 ${editing ? 'w-full max-w-md' : 'max-w-[92%] sm:max-w-lg'} ${
          isMine ? 'flex-row-reverse' : ''
        }`}
      >
        <div
          className={`min-w-0 rounded-2xl px-4 py-2.5 shadow-sm ${editing ? 'flex-1' : ''} ${
            deleted
              ? 'border border-dashed border-slate-300 bg-slate-100 text-slate-600'
              : isMine
                ? 'bg-emerald-700 text-white'
                : 'border border-slate-200 bg-white text-slate-900'
          }`}
        >
          {isTeam && !isMine && !deleted ? (
            <p className="mb-1 text-xs font-semibold text-emerald-700">{senderName}</p>
          ) : null}

          {editing ? (
            <form onSubmit={saveEdit}>
              <label htmlFor={`edit-${message._id}`} className="sr-only">
                Edit message
              </label>
              <textarea
                id={`edit-${message._id}`}
                ref={editRef}
                value={draft}
                rows={3}
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setEditError('');
                }}
                onKeyDown={onEditKeyDown}
                className="block w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {editError && (
                <p role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
                  {editError}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs tabular-nums text-emerald-50">
                  {draft.length}/{MAX_MESSAGE_LENGTH}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="rounded-lg border border-white/60 px-3 py-1 text-xs font-semibold text-white hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !draft.trim()}
                    className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          ) : deleted ? (
            <p className="flex items-center gap-2 text-sm italic">
              <Ban className="h-4 w-4 shrink-0" aria-hidden="true" />
              Message deleted
            </p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
              {message.message}
            </p>
          )}

          {!editing && (
            <div
              className={`mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] ${
                deleted ? 'text-slate-600' : meta
              }`}
            >
              {time ? <time dateTime={time.toISOString()}>{formatTime(time)}</time> : null}
              {message.isEdited && !deleted ? <span>(edited)</span> : null}
              {status ? (
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold text-white ${
                    message.isRead || status.startsWith('Seen') ? 'bg-white/25' : 'bg-black/15'
                  }`}
                >
                  {status}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {!deleted && !editing && (
          <div className="relative shrink-0">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={toggleMenu}
              aria-label="Message options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                aria-label="Message options"
                onKeyDown={onMenuKeyDown}
                className={`absolute z-20 w-44 rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg ${
                  menuAlign === 'right' ? 'right-0' : 'left-0'
                } ${menuAbove ? 'bottom-full mb-1' : 'top-full mt-1'}`}
              >
                <MenuItem icon={<Info className="h-4 w-4" aria-hidden="true" />} onClick={choose(onInfo)}>
                  Message info
                </MenuItem>
                {canEdit && (
                  <MenuItem icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={choose(startEditing)}>
                    Edit
                  </MenuItem>
                )}
                {canDelete && (
                  <MenuItem icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={choose(onDelete)} danger>
                    Delete
                  </MenuItem>
                )}
                {canReport && (
                  <MenuItem icon={<Flag className="h-4 w-4" aria-hidden="true" />} onClick={choose(onReport)}>
                    Report
                  </MenuItem>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function MenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-100 focus:outline-none ${
        danger ? 'text-red-700' : 'text-slate-800'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

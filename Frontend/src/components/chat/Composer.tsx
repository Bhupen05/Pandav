import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { getErrorMessage } from '../../api/axios';
import { MAX_MESSAGE_LENGTH } from './format';

interface ComposerProps {
  // Placeholder and accessible name of the text box
  placeholder: string;
  label: string;
  // Rejects with the reason it could not be sent; the text stays for another try
  onSend: (text: string) => Promise<void>;
  // Called when the writer starts and stops typing (direct chats only)
  onTyping?: (typing: boolean) => void;
}

const TYPING_REPEAT_MS = 3000;
const TYPING_PAUSE_MS = 1500;
const MAX_HEIGHT_PX = 160;

// A multi-line message box: Enter sends, Shift+Enter starts a new line
export default function Composer({ placeholder, label, onSend, onTyping }: ComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRef = useRef(false);
  const onTypingRef = useRef(onTyping);

  useEffect(() => {
    onTypingRef.current = onTyping;
  }, [onTyping]);

  // Grows with the text, up to a few lines
  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const stopTyping = () => {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = null;
    if (typingRef.current) {
      typingRef.current = false;
      lastTypingRef.current = 0;
      onTypingRef.current?.(false);
    }
  };

  // Leaving the conversation ends "typing..." on the other side
  useEffect(
    () => () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (typingRef.current) onTypingRef.current?.(false);
    },
    [],
  );

  const handleChange = (value: string) => {
    setText(value);
    setError('');
    if (!onTyping) return;

    if (value.length === 0) {
      stopTyping();
      return;
    }
    // The other side forgets a typing signal after a few seconds, so repeat it
    const now = Date.now();
    if (!typingRef.current || now - lastTypingRef.current > TYPING_REPEAT_MS) {
      typingRef.current = true;
      lastTypingRef.current = now;
      onTyping(true);
    }
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(stopTyping, TYPING_PAUSE_MS);
  };

  const submit = async () => {
    if (!text.trim() || sending) return;
    const outgoing = text;
    setSending(true);
    setError('');
    // Emptied at once, so that what is typed while this one goes out is kept
    setText('');
    stopTyping();

    try {
      await onSend(outgoing);
    } catch (sendError) {
      // Put the text back for another try, unless something new was typed
      setText((current) => current || outgoing);
      setError(getErrorMessage(sendError, 'Message not sent. Please try again.'));
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const nearLimit = text.length >= MAX_MESSAGE_LENGTH - 100;

  return (
    <form onSubmit={handleSubmit} className="border-t border-slate-200 bg-white p-3 sm:p-4">
      {error && (
        <p role="alert" className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={label}
          aria-describedby="composer-count"
          className="max-h-40 min-h-12 min-w-0 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          title="Send message (Enter)"
          className="flex h-12 shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-4 font-semibold text-white transition-opacity hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          <span>{sending ? 'Sending...' : 'Send'}</span>
        </button>
      </div>
      <div className="mt-1 flex justify-between gap-3 text-xs text-slate-500">
        <span className="hidden sm:inline">Enter to send, Shift+Enter for a new line</span>
        <span
          id="composer-count"
          className={`ml-auto tabular-nums ${nearLimit ? 'font-semibold text-red-600' : ''}`}
        >
          {text.length}/{MAX_MESSAGE_LENGTH}
        </span>
      </div>
    </form>
  );
}

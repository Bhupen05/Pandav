import { useCallback, useEffect, useMemo, useRef, useState, type FC, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTopModal } from '../components/shell/useTopModal';
import { FeedbackContext, type ConfirmOptions, type NoticeTone, type PromptOptions } from './useFeedback';

interface Notice {
  id: number;
  message: string;
  tone: NoticeTone;
}

interface OpenDialog {
  id: number;
  options: ConfirmOptions | PromptOptions;
  // A prompt asks for a value; a confirmation doesn't
  asksForInput: boolean;
  // Closes the dialog; null means cancelled
  finish: (value: string | null) => void;
}

// A popover is closed (display: none) until it is shown, hence the open: variant
const POPOVER_SUPPORTED = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

const NOTICE_DURATION_MS: Record<NoticeTone, number> = { success: 4000, info: 4000, error: 7000 };

const NOTICE_CLASSES: Record<NoticeTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-neutral-200 bg-white text-neutral-800',
};

// Replaces window.alert/confirm/prompt with in-page notices and dialogs
export const FeedbackProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const openDialog = useRef<OpenDialog | null>(null);
  const nextId = useRef(0);
  const modal = useTopModal();

  const dismiss = useCallback((id: number) => {
    setNotices((prev) => prev.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: NoticeTone = 'info') => {
    const id = ++nextId.current;
    setNotices((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => dismiss(id), NOTICE_DURATION_MS[tone]);
  }, [dismiss]);

  const open = useCallback((options: OpenDialog['options'], asksForInput: boolean) =>
    new Promise<string | null>((resolve) => {
      // Only one dialog at a time: a new one cancels the previous
      openDialog.current?.finish(null);
      const opened: OpenDialog = {
        id: ++nextId.current,
        options,
        asksForInput,
        finish: (value) => {
          if (openDialog.current === opened) {
            openDialog.current = null;
            setDialog(null);
          }
          resolve(value);
        },
      };
      openDialog.current = opened;
      setDialog(opened);
    }), []);

  const confirm = useCallback(
    async (options: ConfirmOptions) => (await open(options, false)) !== null,
    [open],
  );
  const prompt = useCallback((options: PromptOptions) => open(options, true), [open]);

  const value = useMemo(() => ({ notify, confirm, prompt }), [notify, confirm, prompt]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}

      {/* While a modal dialog is open everything outside it is inert, so the
          toasts move into it (and move out again when it closes) */}
      {modal ? (
        createPortal(<ToastRegion notices={notices} dismiss={dismiss} inModal />, modal)
      ) : (
        <ToastRegion notices={notices} dismiss={dismiss} dialogId={dialog?.id} />
      )}

      {dialog && <DialogBox key={dialog.id} dialog={dialog} />}
    </FeedbackContext.Provider>
  );
};

interface ToastRegionProps {
  notices: Notice[];
  dismiss: (id: number) => void;
  // Inside a modal dialog, which is already in the top layer
  inModal?: boolean;
  // Changes when a Feedback dialog opens
  dialogId?: number;
}

// The live region holding the toasts. It stays in the page (empty) between
// toasts, so screen readers announce each one as it is added.
function ToastRegion({ notices, dismiss, inModal = false, dialogId }: ToastRegionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const asPopover = POPOVER_SUPPORTED && !inModal;

  // Outside a modal the toasts live in the browser's top layer (a manual
  // popover: it never takes focus and nothing closes it). Showing it again
  // after something else was put on top (or a toast was added) lifts it back
  // above whatever is there. Inside a modal the dialog's own layer is enough.
  useEffect(() => {
    const element = ref.current;
    if (!asPopover || !element || typeof element.showPopover !== 'function') return;
    if (element.matches(':popover-open')) element.hidePopover();
    element.showPopover();
  }, [asPopover, notices, dialogId]);

  return (
    <div
      ref={ref}
      popover={asPopover ? 'manual' : undefined}
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 bottom-0 top-auto z-[60] m-0 h-auto w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-4 sm:items-end ${asPopover ? 'open:flex' : 'flex'}`}
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${NOTICE_CLASSES[notice.tone]}`}
        >
          <p className="flex-1">{notice.message}</p>
          <button
            type="button"
            onClick={() => dismiss(notice.id)}
            aria-label="Dismiss"
            className="-mr-1 rounded px-1 text-lg leading-none opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function DialogBox({ dialog }: { dialog: OpenDialog }) {
  const { options, asksForInput, finish } = dialog;
  const [input, setInput] = useState('');
  const ref = useRef<HTMLDialogElement>(null);

  // showModal keeps focus inside the dialog and closes it on Escape. Closing
  // it (rather than just removing it) puts focus back where it was.
  useEffect(() => {
    const element = ref.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    finish(asksForInput ? input : '');
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="feedback-dialog-title"
      aria-describedby={options.message ? 'feedback-dialog-message' : undefined}
      onCancel={(e) => {
        e.preventDefault();
        finish(null);
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={onSubmit}>
        <h3 id="feedback-dialog-title" className="text-lg font-bold text-neutral-900">{options.title}</h3>
        {options.message && <p id="feedback-dialog-message" className="mt-1 text-sm text-neutral-600">{options.message}</p>}

        {asksForInput && 'label' in options && (
          <div className="mt-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-700">{options.label}</span>
              <input
                type={options.type ?? 'text'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                minLength={options.minLength}
                maxLength={options.maxLength}
                required={options.required ?? true}
                aria-describedby={options.maxLength !== undefined ? 'feedback-dialog-count' : undefined}
                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
              />
            </label>
            {options.maxLength !== undefined && (
              <p id="feedback-dialog-count" className="mt-1 text-right text-xs text-neutral-500">
                {input.length}/{options.maxLength}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => finish(null)}
            className="flex-1 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
              options.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {options.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

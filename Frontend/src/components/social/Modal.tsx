import { useEffect, useId, useRef, type ReactNode } from 'react'

// A native <dialog> opened with showModal: focus stays inside it and Escape
// closes it. Toasts sit behind a modal dialog, so whatever happens inside one
// is shown inside it (the forms using this show their own errors).
export default function Modal({
  title,
  description,
  onClose,
  busy,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  // While something is saving, Escape doesn't close it
  busy?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <h3 id={titleId} className="text-lg font-bold text-neutral-900">{title}</h3>
      {description ? <p id={descriptionId} className="mt-1 text-sm text-neutral-600">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </dialog>
  )
}

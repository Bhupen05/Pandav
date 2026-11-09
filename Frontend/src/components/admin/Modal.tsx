import { useEffect, useId, useRef, type ReactNode } from 'react'

// A dialog on the native <dialog>: showModal keeps focus inside it and closes
// it on Escape. The parent mounts it while it is open.
export function Modal({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className={`m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm ${
        wide ? 'max-w-2xl' : 'max-w-md'
      }`}
    >
      <h3 id={titleId} className="text-lg font-bold text-neutral-900">
        {title}
      </h3>
      {description && <p className="mt-1 text-sm text-neutral-600">{description}</p>}
      <div className="mt-4">{children}</div>
    </dialog>
  )
}

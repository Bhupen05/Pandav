import { useEffect, useId, useRef, type ReactNode } from 'react'

type Props = {
  title: string
  description?: string
  onClose: () => void
  // While something is being saved, Escape does nothing
  busy?: boolean
  wide?: boolean
  children: ReactNode
}

// Native <dialog>, as in ShareTaskDialog: showModal keeps focus inside and
// closes it on Escape
export default function Dialog({ title, description, onClose, busy, wide, children }: Props) {
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
        if (!busy) onClose()
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm ${wide ? 'max-w-2xl' : 'max-w-md'}`}
    >
      <h3 id={titleId} className="text-lg font-bold text-neutral-900">{title}</h3>
      {description && <p className="mt-1 text-sm text-neutral-600">{description}</p>}
      <div className="mt-4">{children}</div>
    </dialog>
  )
}

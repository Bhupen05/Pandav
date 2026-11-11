import { useEffect, useState } from 'react'

const isOpenModal = (dialog: HTMLDialogElement) => {
  try {
    return dialog.open && dialog.matches(':modal')
  } catch {
    // A browser without :modal keeps the toasts where they were
    return false
  }
}

// The modal dialog that is on top right now (null when none is open).
//
// Every other part of the app makes its own <dialog> and opens it with
// showModal(), so nothing here knows about them: a MutationObserver watches
// the `open` attribute of any dialog (and dialogs being removed while open),
// and the `close` event, which doesn't bubble, is caught on its way down.
// Dialogs are kept in the order they opened, because the browser stacks the
// modals that way and the last one opened is the one the person can use.
export function useTopModal(): HTMLDialogElement | null {
  const [top, setTop] = useState<HTMLDialogElement | null>(null)

  useEffect(() => {
    let stack: HTMLDialogElement[] = []

    const refresh = () => {
      const open = Array.from(document.querySelectorAll('dialog')).filter(isOpenModal)
      stack = [...stack.filter((dialog) => open.includes(dialog)), ...open.filter((dialog) => !stack.includes(dialog))]
      const next = stack[stack.length - 1] ?? null
      setTop((current) => (current === next ? current : next))
    }

    const observer = new MutationObserver((records) => {
      const opened = records.some((record) => record.type === 'attributes' && record.target instanceof HTMLDialogElement)
      // A dialog that is taken out of the page while open fires no close event
      const removed = stack.some((dialog) => !dialog.isConnected)
      if (opened || removed) refresh()
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
    document.addEventListener('close', refresh, true)
    refresh()

    return () => {
      observer.disconnect()
      document.removeEventListener('close', refresh, true)
    }
  }, [])

  return top
}

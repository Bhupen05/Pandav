import { useState } from 'react'

// Long notes are cut to two lines, show in full on hover (title) and open
// with the button
export default function ExpandableText({ text, className = '' }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 70
  return (
    <div className={className}>
      <p title={text} className={`break-words ${long && !open ? 'line-clamp-2' : ''}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-0.5 text-xs font-medium text-blue-700 underline hover:text-blue-900">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

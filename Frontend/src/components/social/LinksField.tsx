import { useId, useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { LINKS_MAX, linkLabel, linkProblem } from './links'
import { hintClass, inputClass, labelClass, secondaryButton } from './styles'

// The "Links" field of a post: type a link, add it, remove any of them.
// `draft` is the text in the box; the parent keeps it so that a link typed but
// not added yet isn't lost when the post is saved (see linksToSend).
export default function LinksField({
  links,
  onLinksChange,
  draft,
  onDraftChange,
  disabled = false,
}: {
  links: string[]
  onLinksChange: (links: string[]) => void
  draft: string
  onDraftChange: (draft: string) => void
  disabled?: boolean
}) {
  const id = useId()
  const [problem, setProblem] = useState('')
  const full = links.length >= LINKS_MAX

  const add = () => {
    const found = linkProblem(draft, links)
    setProblem(found)
    if (found) return
    onLinksChange([...links, draft.trim()])
    onDraftChange('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    // Enter adds the link; it doesn't save the whole post
    event.preventDefault()
    if (!full) add()
  }

  return (
    <div>
      <label htmlFor={`${id}-link`} className={labelClass}>
        Links <span className="font-normal text-slate-500">(optional)</span>
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-link`}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={draft}
          disabled={disabled || full}
          onChange={(event) => {
            onDraftChange(event.target.value)
            setProblem('')
          }}
          onKeyDown={onKeyDown}
          placeholder="https://example.com/page"
          aria-describedby={`${id}-hint${problem ? ` ${id}-problem` : ''}`}
          aria-invalid={problem ? true : undefined}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || full}
          className={`${secondaryButton} shrink-0`}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add link
        </button>
      </div>
      {problem ? <p id={`${id}-problem`} role="alert" className="mt-1 text-xs font-semibold text-rose-700">{problem}</p> : null}
      <p id={`${id}-hint`} className={hintClass}>
        {full
          ? `That’s the most: ${LINKS_MAX} links. Remove one to add another.`
          : `Up to ${LINKS_MAX} links, each starting with “https://”. They show with the post here and aren’t sent to LinkedIn or GitHub.`}
        {links.length > 0 ? ` ${links.length} of ${LINKS_MAX} added.` : ''}
      </p>
      {links.length > 0 ? (
        <ul aria-label="Added links" className="mt-2 space-y-1.5">
          {links.map((link, index) => (
            <li key={`${link}-${index}`} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white py-1.5 pl-3 pr-1.5 text-sm text-slate-700">
              <span className="min-w-0 flex-1 break-all" title={link}>{linkLabel(link, 80)}</span>
              <button
                type="button"
                onClick={() => onLinksChange(links.filter((_, position) => position !== index))}
                disabled={disabled}
                aria-label={`Remove the link ${linkLabel(link, 40)}`}
                className="shrink-0 rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-60"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

import { useState, type ReactNode } from 'react'
import { Globe2 } from 'lucide-react'
import { ImageGrid, type GridImage } from './ImageGrid'
import { initials } from './format'

// About what LinkedIn's feed shows before "…more"
const FOLD = 210

// Hashtags in LinkedIn's blue, as LinkedIn shows them
function withHashtags(text: string) {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_])(#[\p{L}\p{N}_]+)/gu)) {
    const at = (match.index ?? 0) + match[1].length
    parts.push(text.slice(last, at), <span key={at} className="font-semibold text-[#0a66c2]">{match[2]}</span>)
    last = at + match[2].length
  }
  parts.push(text.slice(last))
  return parts
}

// The post as it will look in LinkedIn's feed
export default function LinkedInPreview({
  name,
  picture,
  when,
  text,
  images,
}: {
  name: string
  picture?: string | null
  when: string
  text: string
  images: GridImage[]
}) {
  const [open, setOpen] = useState(false)
  const folded = !open && text.length > FOLD

  return (
    <figure className="rounded-2xl border border-slate-200 bg-white p-4 text-[#191919] shadow-sm">
      <figcaption className="sr-only">Preview of the post on LinkedIn</figcaption>
      <div className="flex items-center gap-2.5">
        {picture ? (
          <img src={picture} alt="" className="h-11 w-11 rounded-full object-cover" />
        ) : (
          <div aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0a66c2] text-sm font-bold text-white">
            {initials(name)}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name || 'You'}</p>
          <p className="flex items-center gap-1 text-xs text-slate-500">
            {when} · <Globe2 className="h-3 w-3" aria-label="Public" />
          </p>
        </div>
      </div>
      {text ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-5">
          {withHashtags(folded ? text.slice(0, FOLD).trimEnd() : text)}
          {folded ? (
            <>
              …{' '}
              <button type="button" onClick={() => setOpen(true)} className="font-semibold text-slate-500 hover:text-[#0a66c2] hover:underline">
                more
              </button>
            </>
          ) : null}
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-400">Your post will show here.</p>
      )}
      {images.length > 0 ? (
        <div className="-mx-4 mt-3">
          <ImageGrid images={images} />
        </div>
      ) : null}
    </figure>
  )
}

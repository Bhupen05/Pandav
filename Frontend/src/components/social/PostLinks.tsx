import { ExternalLink } from 'lucide-react'
import { isOpenableLink, linkLabel } from './links'

// The links of a post. An https link opens in a new tab, without handing the
// page over (noopener) or telling the site where it came from (noreferrer);
// anything else (an older http link) is shown as text and isn't opened.
export default function PostLinks({ links }: { links?: string[] }) {
  if (!links || links.length === 0) return null
  return (
    <ul aria-label="Links" className="mt-3 space-y-1">
      {links.map((link, index) => (
        <li key={`${link}-${index}`} className="min-w-0 text-sm">
          {isOpenableLink(link) ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              title={link}
              className="inline-flex max-w-full items-center gap-1.5 rounded font-semibold text-sky-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{linkLabel(link)}</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <span title={link} className="block truncate text-slate-600">{linkLabel(link)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

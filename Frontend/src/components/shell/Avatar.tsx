import { useState } from 'react'
import { initialsOf } from '../../utils/initials'

// A round photo; the initials stand in when there is none or it can't be loaded.
// `className` sets the size and the look of the initials circle.
export default function Avatar({
  name,
  src,
  className = 'h-8 w-8 text-sm',
  imageClassName = '',
}: {
  name?: string | null
  src?: string | null
  className?: string
  imageClassName?: string
}) {
  // Remembers which photo failed, so a new one gets its own chance
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailedSrc(src)}
        className={`shrink-0 rounded-full object-cover ${className} ${imageClassName}`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-700 ${className}`}
    >
      {initialsOf(name)}
    </span>
  )
}

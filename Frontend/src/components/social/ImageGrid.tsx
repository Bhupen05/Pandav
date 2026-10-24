import { socialImageUrl } from '../../api/socialV2API'
import type { PostImage } from './types'

export type GridImage = { key: string; src: string; alt: string; width?: number; height?: number }

// Up to four images the way LinkedIn lays them out: one wide; two side by
// side; three as one large and two small; four in a square
export function ImageGrid({ images, linked = false }: { images: GridImage[]; linked?: boolean }) {
  if (images.length === 0) return null
  const layout =
    images.length === 1 ? 'grid-cols-1' : images.length === 3 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2'

  return (
    <div className={`grid gap-1 overflow-hidden rounded-2xl ${layout}`}>
      {images.map((image, index) => {
        const tall = images.length === 3 && index === 0
        const picture = (
          <img
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            loading="lazy"
            className={`h-full w-full bg-slate-100 object-cover ${images.length === 1 ? 'max-h-112' : tall ? '' : 'aspect-square'}`}
          />
        )
        return (
          <div key={image.key} className={tall ? 'row-span-2' : undefined}>
            {linked ? (
              <a href={image.src} target="_blank" rel="noreferrer" className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                {picture}
              </a>
            ) : (
              picture
            )}
          </div>
        )
      })}
    </div>
  )
}

// A post's uploaded images, in the feed
export function PostImages({ images }: { images?: PostImage[] }) {
  if (!images?.length) return null
  return (
    <div className="mt-4">
      <ImageGrid
        linked
        images={images.map((image) => ({
          key: image._id,
          src: socialImageUrl(image._id),
          alt: image.altText ?? '',
          width: image.width,
          height: image.height,
        }))}
      />
    </div>
  )
}

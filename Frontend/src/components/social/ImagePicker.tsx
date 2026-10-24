import { useEffect, useId, useRef, type Dispatch, type SetStateAction } from 'react'
import { ImagePlus, LoaderCircle, X } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { errorText } from './format'
import { ALT_TEXT_MAX, IMAGES_PER_POST, IMAGE_MAX_BYTES, IMAGE_TYPES, readAsBase64 } from './linkedin'
import { hintClass, inputClass } from './styles'

// An image chosen for a post. It is uploaded as soon as it is chosen; the
// post then names it by `id`.
export type PickedImage = {
  key: string
  name: string
  previewUrl: string
  status: 'uploading' | 'ready' | 'failed'
  id?: string
  width?: number
  height?: number
  altText: string
  error?: string
}

export default function ImagePicker({
  images,
  setImages,
  disabled,
}: {
  images: PickedImage[]
  setImages: Dispatch<SetStateAction<PickedImage[]>>
  disabled?: boolean
}) {
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const nextKey = useRef(0)
  const room = IMAGES_PER_POST - images.length

  // A preview lives while its image is in the list (the composer empties the
  // list after posting), and no longer than the picker
  const previews = useRef(new Set<string>())
  useEffect(() => {
    const shown = new Set(images.map((image) => image.previewUrl))
    for (const url of previews.current) {
      if (shown.has(url)) continue
      URL.revokeObjectURL(url)
      previews.current.delete(url)
    }
  }, [images])

  // Uploads that finish after their image was removed (or the picker went)
  // remove what they uploaded: it would otherwise count against the
  // server's limit of images not posted yet for a day
  const dropped = useRef(new Set<string>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const urls = previews.current
    return () => {
      mounted.current = false
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const update = (key: string, patch: Partial<PickedImage>) =>
    setImages((current) => current.map((image) => (image.key === key ? { ...image, ...patch } : image)))

  async function uploadOne(key: string, file: File) {
    try {
      const response = await socialV2API.uploadImage({ type: file.type, data: await readAsBase64(file) })
      const uploaded = response?.data
      if (dropped.current.has(key) || !mounted.current) {
        dropped.current.delete(key)
        if (uploaded?._id) void socialV2API.deleteImage(uploaded._id).catch(() => undefined)
        return
      }
      update(key, { status: 'ready', id: uploaded?._id, width: uploaded?.width, height: uploaded?.height })
    } catch (error) {
      dropped.current.delete(key)
      update(key, { status: 'failed', error: errorText(error, 'The image didn’t upload.') })
    }
  }

  function addFiles(files: FileList | File[]) {
    const picked: Array<{ image: PickedImage; file: File }> = []
    for (const file of [...files].slice(0, Math.max(0, room))) {
      const previewUrl = URL.createObjectURL(file)
      previews.current.add(previewUrl)
      nextKey.current += 1
      const key = `image-${nextKey.current}`
      const problem = !IMAGE_TYPES.includes(file.type)
        ? 'Use a PNG, JPEG or GIF image.'
        : file.size > IMAGE_MAX_BYTES
          ? 'Images can be at most 2 MB.'
          : ''
      picked.push({
        file,
        image: { key, name: file.name, previewUrl, status: problem ? 'failed' : 'uploading', altText: '', error: problem || undefined },
      })
    }
    if (picked.length === 0) return
    setImages((current) => [...current, ...picked.map(({ image }) => image)])
    picked.filter(({ image }) => image.status === 'uploading').forEach(({ image, file }) => void uploadOne(image.key, file))
  }

  function remove(image: PickedImage) {
    setImages((current) => current.filter((item) => item.key !== image.key))
    // Not posted yet: the server would remove it after a day anyway
    if (image.id) void socialV2API.deleteImage(image.id).catch(() => undefined)
    else if (image.status === 'uploading') dropped.current.add(image.key)
  }

  return (
    <div>
      {images.length > 0 ? (
        <ul className="mb-3 grid gap-3 sm:grid-cols-2">
          {images.map((image, index) => (
            <li key={image.key} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-2.5">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                <img src={image.previewUrl} alt="" className="h-full w-full object-cover" />
                {image.status === 'uploading' ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70" role="status" aria-label={`Uploading ${image.name}`}>
                    <LoaderCircle className="h-5 w-5 animate-spin text-slate-700" aria-hidden="true" />
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-slate-700" title={image.name}>{image.name}</p>
                  <button
                    type="button"
                    onClick={() => remove(image)}
                    disabled={disabled}
                    aria-label={`Remove ${image.name}`}
                    className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                {image.status === 'failed' ? (
                  <p role="alert" className="mt-1 text-xs text-rose-700">{image.error}</p>
                ) : (
                  <>
                    <label htmlFor={`${id}-alt-${index}`} className="sr-only">Description of {image.name}</label>
                    <input
                      id={`${id}-alt-${index}`}
                      value={image.altText}
                      maxLength={ALT_TEXT_MAX}
                      disabled={disabled}
                      onChange={(event) => update(image.key, { altText: event.target.value })}
                      placeholder="Describe it for screen readers"
                      className={`${inputClass} mt-1 rounded-xl px-3 py-2 text-xs`}
                    />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {room > 0 ? (
        <>
          <input
            ref={fileInput}
            id={`${id}-files`}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            multiple
            disabled={disabled}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files)
              event.target.value = ''
            }}
            className="sr-only"
          />
          <label
            htmlFor={`${id}-files`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              if (!disabled) addFiles(event.dataTransfer.files)
            }}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-sky-400 hover:bg-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-400"
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            {images.length === 0 ? 'Add images' : 'Add more images'}
          </label>
          <p className={hintClass}>Up to {IMAGES_PER_POST} PNG, JPEG or GIF images, 2 MB each. Drop them here or choose them.</p>
        </>
      ) : (
        <p className={hintClass}>A post can have {IMAGES_PER_POST} images.</p>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Download, Paperclip, Trash2 } from 'lucide-react'
import { taskAPI } from '../../api/taskAPI'
import { getErrorMessage } from '../../api/axios'
import { useFeedback } from '../../context/useFeedback'
import { formatDateTime, formatFileSize, personId, personName } from './taskFormat'
import type { TaskAttachment } from './types'
import { InlineError } from './ui'

// The limits of Backend/Doc/Tasks.md "Attachments", checked here first so a
// wrong file is refused before it is sent
const MAX_BYTES = 2 * 1024 * 1024
const MAX_FILES = 10

const EXTENSION_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const ALLOWED_TYPES = new Set([...Object.values(EXTENSION_TYPE), 'image/jpg', 'application/x-zip-compressed'])

const BLOCKED_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'svg', 'xml', 'js', 'mjs', 'cjs', 'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'ps1', 'psm1', 'vbs', 'jar', 'sh', 'php', 'dll', 'lnk',
])

const ACCEPT = Object.keys(EXTENSION_TYPE).map((extension) => `.${extension}`).join(',')

const extensionOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')

// Why this file can't be attached, or null if it can
const fileProblem = (file: File, count: number): string | null => {
  const extension = extensionOf(file.name)
  if (count >= MAX_FILES) return `A task can have at most ${MAX_FILES} files. Remove one first.`
  if (BLOCKED_EXTENSIONS.has(extension)) return `.${extension} files can't be attached.`
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_BYTES) return `That file is ${formatFileSize(file.size)}. A file can be at most 2 MB.`
  const type = file.type || EXTENSION_TYPE[extension] || ''
  if (!ALLOWED_TYPES.has(type)) {
    return 'Attach images (PNG, JPEG, GIF, WebP), PDFs, text or CSV files, ZIP archives, or Word, Excel or PowerPoint documents.'
  }
  return null
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject({ message: "Couldn't read that file." })
    reader.readAsDataURL(file)
  })

type Props = {
  taskId: string
  viewerId: string
  // Whether this person may add files
  canAttach: boolean
  // Managers and admins may remove anyone's file
  canModerate: boolean
  report: (message: string, tone: 'success' | 'error') => void
  onActivity: () => void
}

export default function TaskFiles({ taskId, viewerId, canAttach, canModerate, report, onActivity }: Props) {
  const { confirm } = useFeedback()
  const [files, setFiles] = useState<TaskAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [problem, setProblem] = useState('')
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const response = await taskAPI.getAttachments(taskId)
      if (id === requestId.current) setFiles(response.data || [])
    } catch (failure) {
      if (id === requestId.current) setError(getErrorMessage(failure, "Couldn't load the files."))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    load()
  }, [load])

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    input.value = ''
    if (!file || uploading) return
    const refused = fileProblem(file, files.length)
    setProblem(refused || '')
    if (refused) return

    setUploading(true)
    try {
      const data = await readAsDataUrl(file)
      const response = await taskAPI.addAttachment(taskId, { name: file.name, type: file.type || EXTENSION_TYPE[extensionOf(file.name)] || '', data })
      setFiles((current) => [...current, response.data])
      report(`Attached ${file.name}.`, 'success')
      onActivity()
    } catch (failure) {
      setProblem(getErrorMessage(failure, "Couldn't attach the file."))
    } finally {
      setUploading(false)
    }
  }

  const download = async (file: TaskAttachment) => {
    if (busyId) return
    setBusyId(file._id)
    try {
      const blob = await taskAPI.downloadAttachment(taskId, file._id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (failure) {
      report(getErrorMessage(failure, "Couldn't download the file."), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (file: TaskAttachment) => {
    const ok = await confirm({
      title: 'Remove this file?',
      message: `"${file.name}" is removed from the task for everyone.`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok || busyId) return
    setBusyId(file._id)
    try {
      await taskAPI.deleteAttachment(taskId, file._id)
      setFiles((current) => current.filter((entry) => entry._id !== file._id))
      report(`Removed ${file.name}.`, 'success')
      onActivity()
    } catch (failure) {
      report(getErrorMessage(failure, "Couldn't remove the file."), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="task-files-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="task-files-heading" className="text-sm font-semibold text-neutral-900">
          Files <span className="font-normal text-neutral-500">({files.length} of {MAX_FILES})</span>
        </h3>
        {canAttach && (
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 focus-within:ring-2 focus-within:ring-neutral-900/20 hover:bg-neutral-50 ${
              uploading ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            <Paperclip aria-hidden="true" className="h-4 w-4" />
            <input type="file" accept={ACCEPT} onChange={upload} disabled={uploading} className="sr-only" />
            {uploading ? 'Uploading…' : 'Attach a file'}
          </label>
        )}
      </div>
      {canAttach && !problem && <p className="mb-2 text-xs text-neutral-500">Images, PDFs, text, CSV, ZIP and Office files, up to 2 MB each.</p>}
      {problem && <p role="alert" className="mb-2 text-sm text-red-600">{problem}</p>}

      {loading && files.length === 0 ? (
        <p role="status" className="text-sm text-neutral-500">Loading files…</p>
      ) : error ? (
        <InlineError title="Files didn't load" message={error} onRetry={load} />
      ) : files.length === 0 ? (
        <p className="text-sm text-neutral-500">No files attached.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => (
            <li key={file._id} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900" title={file.name}>{file.name}</p>
                <p className="text-xs text-neutral-500">
                  {formatFileSize(file.size)} · {personName(file.uploadedBy, 'Someone')} · {formatDateTime(file.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => download(file)}
                disabled={busyId === file._id}
                aria-label={`Download ${file.name}`}
                className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-200 disabled:opacity-50"
              >
                <Download aria-hidden="true" className="h-4 w-4" />
              </button>
              {(canModerate || personId(file.uploadedBy) === viewerId) && (
                <button
                  type="button"
                  onClick={() => remove(file)}
                  disabled={busyId === file._id}
                  aria-label={`Remove ${file.name}`}
                  className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

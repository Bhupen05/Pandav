import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { contactAPI } from '../api/contactAPI'
import { getErrorMessage } from '../api/axios'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'

type ContactStatus = 'new' | 'in-progress' | 'resolved' | 'closed'

type ContactMessage = {
  _id: string
  name: string
  email: string
  phone?: string
  subject: string
  message: string
  status: ContactStatus
  resolvedBy?: { _id: string; name: string }
  resolvedAt?: string
  createdAt: string
}

const STATUSES: ContactStatus[] = ['new', 'in-progress', 'resolved', 'closed']

const statusColor = (status: ContactStatus) => {
  switch (status) {
    case 'new':
      return 'bg-purple-100 text-purple-800'
    case 'in-progress':
      return 'bg-blue-100 text-blue-800'
    case 'resolved':
      return 'bg-emerald-100 text-emerald-800'
    default:
      return 'bg-neutral-200 text-neutral-700'
  }
}

export default function ContactMessages() {
  const { notify, confirm } = useFeedback()
  const navigate = useNavigate()
  const { isAdmin, isAuthenticated } = useAuth()
  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [filter, setFilter] = useState<'all' | ContactStatus>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadMessages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await contactAPI.getContacts()
      setMessages(Array.isArray(response.data) ? response.data : [])
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load messages'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated && isAdmin) loadMessages()
  }, [isAuthenticated, isAdmin, loadMessages])

  const handleStatusChange = async (id: string, status: ContactStatus) => {
    try {
      const response = await contactAPI.updateContact(id, { status })
      setMessages((prev) => prev.map((m) => (m._id === id ? response.data : m)))
    } catch (err) {
      notify(getErrorMessage(err, 'Failed to update message status'), 'error')
    }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: 'Delete this message?', message: "This can't be undone.", confirmLabel: 'Delete', danger: true }))) return
    try {
      await contactAPI.deleteContact(id)
      setMessages((prev) => prev.filter((m) => m._id !== id))
    } catch (err) {
      notify(getErrorMessage(err, 'Failed to delete message'), 'error')
    }
  }

  const visibleMessages = filter === 'all' ? messages : messages.filter((m) => m.status === filter)
  const countFor = (status: 'all' | ContactStatus) =>
    status === 'all' ? messages.length : messages.filter((m) => m.status === status).length

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      {/* Header */}
      <div className="bg-linear-to-r from-blue-500 to-emerald-500 text-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold md:text-3xl">Contact Messages</h1>
            <p className="text-sm text-white/80">Messages sent through the contact form</p>
          </div>
          <button
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-2 self-start rounded-lg bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm hover:bg-white/20 transition-colors"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Status filter */}
        <div className="mb-6 flex flex-wrap gap-2">
          {(['all', ...STATUSES] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium capitalize transition-all ${
                filter === status ? 'bg-neutral-900 text-white shadow-lg' : 'border bg-white text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              {status.replace('-', ' ')}
              <span className={`rounded-full px-2 py-0.5 text-xs ${filter === status ? 'bg-white/20' : 'bg-neutral-100'}`}>
                {countFor(status)}
              </span>
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
            <button onClick={loadMessages} className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900"></div>
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-neutral-200 bg-white py-16 text-center text-sm text-neutral-500">
            {filter === 'all' ? 'No messages yet.' : `No ${filter.replace('-', ' ')} messages.`}
          </div>
        ) : (
          <div className="space-y-4">
            {visibleMessages.map((m) => (
              <article key={m._id} className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-neutral-900">{m.subject}</h2>
                    <p className="text-sm text-neutral-600">
                      {m.name} · <a href={`mailto:${m.email}`} className="text-emerald-700 hover:underline">{m.email}</a>
                      {m.phone && <> · {m.phone}</>}
                    </p>
                    <p className="text-xs text-neutral-400">{new Date(m.createdAt).toLocaleString()}</p>
                  </div>
                  <span className={`self-start rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusColor(m.status)}`}>
                    {m.status.replace('-', ' ')}
                  </span>
                </div>

                <p className="mb-4 whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{m.message}</p>

                {m.status === 'resolved' && m.resolvedBy && (
                  <p className="mb-4 text-xs text-neutral-500">
                    Resolved by {m.resolvedBy.name}
                    {m.resolvedAt && ` on ${new Date(m.resolvedAt).toLocaleDateString()}`}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <label htmlFor={`status-${m._id}`} className="text-xs text-neutral-500">Status</label>
                  <select
                    id={`status-${m._id}`}
                    value={m.status}
                    onChange={(e) => handleStatusChange(m._id, e.target.value as ContactStatus)}
                    className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm capitalize outline-none focus:border-neutral-900"
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>{status.replace('-', ' ')}</option>
                    ))}
                  </select>
                  <a
                    href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`}
                    className="ml-auto rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                  >
                    Reply by email
                  </a>
                  <button
                    onClick={() => handleDelete(m._id)}
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

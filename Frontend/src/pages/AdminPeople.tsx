import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Search } from 'lucide-react'
import { adminAPI, type AdminUser, type UserSort } from '../api/adminAPI'
import { useAuth } from '../context/useAuth'
import { useFeedback } from '../context/useFeedback'
import { AdminHeader, Avatar, Loadable, Pager } from '../components/admin/ui'
import { PersonActionButtons } from '../components/admin/PersonActionButtons'
import { PersonBadges } from '../components/admin/PersonBadges'
import { usePersonActions } from '../components/admin/usePersonActions'
import { useDebouncedValue } from '../components/admin/useDebouncedValue'
import { useResource } from '../components/admin/useResource'
import { useBusy } from '../components/admin/useBusy'
import { errorText, formatDateTime } from '../components/admin/format'
import { ROLE_LABELS } from '../components/admin/labels'
import { BTN, FIELD, LABEL } from '../components/admin/buttons'

const PAGE_SIZE = 20

const SORTS: Array<{ value: UserSort; label: string }> = [
  { value: 'name', label: 'Name, A to Z' },
  { value: '-name', label: 'Name, Z to A' },
  { value: 'email', label: 'Email, A to Z' },
  { value: '-createdAt', label: 'Newest accounts first' },
  { value: 'createdAt', label: 'Oldest accounts first' },
  { value: '-lastLoginAt', label: 'Signed in most recently' },
]

const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

export default function AdminPeople() {
  const { user: me } = useAuth()
  const { notify } = useFeedback()
  const [params, setParams] = useSearchParams()
  const { run, isBusy } = useBusy()

  const q = params.get('q') ?? ''
  const role = params.get('role') ?? ''
  const status = params.get('status') ?? ''
  const sort = (SORTS.find((item) => item.value === params.get('sort'))?.value ?? 'name') as UserSort
  const page = Math.max(1, Number(params.get('page')) || 1)

  const change = useCallback(
    (changes: Record<string, string>, keepPage = false) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          if (!keepPage) next.delete('page')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  // The search box is typed into freely; the list follows once typing pauses
  const [search, setSearch] = useState(q)
  const debounced = useDebouncedValue(search.trim(), 300)
  const appliedQ = useRef(q)
  useEffect(() => {
    appliedQ.current = q
  }, [q])
  useEffect(() => {
    if (debounced !== appliedQ.current) change({ q: debounced })
  }, [debounced, change])

  const loader = useCallback(
    (signal: AbortSignal) =>
      adminAPI.getUsers(
        { q, role, isActive: status ? status === 'active' : undefined, sort, page, limit: PAGE_SIZE },
        { signal },
      ),
    [q, role, status, sort, page],
  )
  const people = useResource(loader)
  const teams = useResource(useCallback((signal: AbortSignal) => adminAPI.getTeams({ signal }), []))
  const actions = usePersonActions(people.reload)

  const teamName = (user: AdminUser) => {
    if (!user.teamId) return '—'
    return teams.data?.find((team) => team._id === user.teamId)?.name ?? 'In a team'
  }

  const filtered = Boolean(q || role || status)
  const clearFilters = () => {
    setSearch('')
    setParams({}, { replace: true })
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    change({ q: search.trim() })
  }

  const exportCsv = () =>
    run('export', async () => {
      try {
        await adminAPI.exportUsers()
        notify('The list of people was downloaded.', 'success')
      } catch (error) {
        notify(errorText(error, 'Could not export the list of people'), 'error')
      }
    })

  return (
    <div className="min-h-screen bg-linear-to-br from-neutral-50 via-white to-neutral-100">
      <AdminHeader
        title="People"
        subtitle="Everyone with an account. Search, change roles, reset passwords and manage access."
        back={{ to: '/admin', label: 'Back to dashboard' }}
        actions={
          <button
            type="button"
            onClick={exportCsv}
            disabled={isBusy('export')}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white/90 disabled:opacity-60"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {isBusy('export') ? 'Exporting...' : 'Export CSV'}
          </button>
        }
      />

      <div className="mx-auto max-w-7xl px-4 py-6">
        <form onSubmit={onSubmit} role="search" aria-label="Find people" className="mb-5 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto] lg:items-end">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="people-search" className={LABEL}>
              Search people
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
              <input
                id="people-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or email"
                className={`${FIELD} pl-9`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="people-role" className={LABEL}>
              Role
            </label>
            <select id="people-role" value={role} onChange={(event) => change({ role: event.target.value })} className={FIELD}>
              <option value="">Any role</option>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="people-status" className={LABEL}>
              Status
            </label>
            <select id="people-status" value={status} onChange={(event) => change({ status: event.target.value })} className={FIELD}>
              {STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="people-sort" className={LABEL}>
              Sort by
            </label>
            <select id="people-sort" value={sort} onChange={(event) => change({ sort: event.target.value })} className={FIELD}>
              {SORTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={`${BTN.md} ${BTN.primary}`}>
              Search
            </button>
            {filtered && (
              <button type="button" onClick={clearFilters} className={`${BTN.md} ${BTN.neutral}`}>
                Clear
              </button>
            )}
          </div>
        </form>

        <Loadable
          data={people.data}
          error={people.error}
          loading={people.loading}
          onRetry={people.reload}
          errorFallback="Could not load the people list"
          isEmpty={(data) => data.data.length === 0}
          empty={
            filtered ? (
              <>
                No one matches these filters.{' '}
                <button type="button" onClick={clearFilters} className="font-semibold text-emerald-700 hover:underline">
                  Clear filters
                </button>
              </>
            ) : (
              'There are no accounts yet.'
            )
          }
        >
          {(data) => (
            <>
              <p className="mb-2 text-sm text-neutral-600" aria-live="polite">
                {data.pagination?.total ?? data.data.length} {(data.pagination?.total ?? data.data.length) === 1 ? 'person' : 'people'}
                {filtered ? ' match' : ''}
              </p>

              {/* Tables on wide screens, cards on phones */}
              <div className="hidden overflow-hidden rounded-xl border border-neutral-200 bg-white md:block">
                <table className="w-full text-sm">
                  <caption className="sr-only">People</caption>
                  <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-600">
                    <tr>
                      <th scope="col" className="px-4 py-3">Person</th>
                      <th scope="col" className="px-3 py-3">Role</th>
                      <th scope="col" className="px-3 py-3">Team</th>
                      <th scope="col" className="hidden px-3 py-3 xl:table-cell">Last sign-in</th>
                      <th scope="col" className="px-3 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {data.data.map((user) => (
                      <tr key={user._id} className="align-top hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={user.name} image={user.profileImage} />
                            <div className="min-w-0">
                              <Link to={`/admin/users/${user._id}`} className="font-medium text-neutral-900 hover:underline">
                                {user.name}
                              </Link>
                              {user._id === me?._id && <span className="ml-1 text-xs text-neutral-500">(you)</span>}
                              <p className="truncate text-xs text-neutral-500">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <PersonBadges user={user} />
                        </td>
                        <td className="px-3 py-3 text-neutral-700">{teamName(user)}</td>
                        <td className="hidden px-3 py-3 text-neutral-600 xl:table-cell">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}</td>
                        <td className="px-3 py-3">
                          <PersonActionButtons user={user} actions={actions} selfId={me?._id} open />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="space-y-3 md:hidden">
                {data.data.map((user) => (
                  <li key={user._id} className="rounded-xl border border-neutral-200 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <Avatar name={user.name} image={user.profileImage} />
                      <div className="min-w-0 flex-1">
                        <Link to={`/admin/users/${user._id}`} className="font-medium text-neutral-900 hover:underline">
                          {user.name}
                        </Link>
                        {user._id === me?._id && <span className="ml-1 text-xs text-neutral-500">(you)</span>}
                        <p className="break-all text-xs text-neutral-500">{user.email}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <PersonBadges user={user} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-neutral-500">Team</dt>
                        <dd className="text-neutral-800">{teamName(user)}</dd>
                      </div>
                      <div>
                        <dt className="text-neutral-500">Last sign-in</dt>
                        <dd className="text-neutral-800">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 border-t border-neutral-100 pt-3">
                      <PersonActionButtons user={user} actions={actions} selfId={me?._id} open />
                    </div>
                  </li>
                ))}
              </ul>

              <Pager
                page={data.pagination?.page ?? page}
                pages={data.pagination?.pages ?? 1}
                total={data.pagination?.total}
                label="People pages"
                onPage={(next) => change({ page: String(next) }, true)}
              />
            </>
          )}
        </Loadable>
      </div>
    </div>
  )
}

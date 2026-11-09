import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Search, UserMinus, UserPlus, X } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useAuth } from '../../context/useAuth'
import { useFeedback } from '../../context/useFeedback'
import { errorText, idOf, listOf, personOf, plural, roleLabel, tone } from './format'
import { useBusy, useResource, useShowMore } from './hooks'
import { Avatar, Badge, BusyButton, EmptyState, ErrorState, LoadingState, SectionCard, ShowMore } from './ui'
import { dangerButton, hintClass, inputClass, labelClass, primaryButton, secondaryButton, smallButton, successButton } from './styles'
import type { Connection, ConnectionState, Person } from './types'

const noConnections: ConnectionState = { pendingSent: [], pendingReceived: [], connected: [] }

type Relation = { kind: 'connected' | 'sent' | 'received'; connection: Connection }

// The other person of a connection
const otherOf = (connection: Connection, myId?: string): Person | null =>
  personOf(idOf(connection.requester) === myId ? connection.recipient : connection.requester)

function PersonLine({ person, extra }: { person: Person; extra?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar person={person} />
      <div className="min-w-0">
        <div className="truncate font-semibold text-slate-900">{person.name}</div>
        <div className="truncate text-sm text-slate-500">
          {[roleLabel(person.role), person.department, person.email].filter(Boolean).join(' · ')}
        </div>
        {extra}
      </div>
    </div>
  )
}

// People: find them and send a request, answer or withdraw requests, and see
// or remove your connections. Each list loads on its own.
export default function NetworkView() {
  const { user } = useAuth()
  const { notify, confirm } = useFeedback()
  const { busy, run } = useBusy()
  const id = useId()
  const [query, setQuery] = useState('')
  // What the results are for: '' shows the people suggested for you
  const [searched, setSearched] = useState('')
  const [searchError, setSearchError] = useState('')
  // Why a request to one person failed (for instance "You can ask again on…")
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const connections = useResource<ConnectionState>(
    async () => {
      const response = await socialV2API.getConnections()
      return { ...noConnections, ...(response?.data ?? {}) }
    },
    'Couldn’t load your connections.',
    noConnections,
  )
  const people = useResource<Person[]>(
    async () => listOf<Person>((await socialV2API.discoverUsers(searched))?.data),
    'Couldn’t search for people.',
    [],
    { key: searched },
  )
  const results = useShowMore(6)
  const incoming = useShowMore(5)
  const sent = useShowMore(5)
  const connected = useShowMore(6)

  const myId = user?._id
  const relations = useMemo(() => {
    const map = new Map<string, Relation>()
    const add = (list: Connection[], kind: Relation['kind'], side: 'requester' | 'recipient' | 'either') => {
      for (const connection of list) {
        const other = side === 'either' ? otherOf(connection, myId) : personOf(connection[side])
        if (other) map.set(other._id, { kind, connection })
      }
    }
    add(connections.data.pendingSent, 'sent', 'recipient')
    add(connections.data.pendingReceived, 'received', 'requester')
    add(connections.data.connected, 'connected', 'either')
    return map
  }, [connections.data, myId])

  const { reload: reloadConnections } = connections
  const setRowError = (personId: string, message: string) => setRowErrors((current) => ({ ...current, [personId]: message }))

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = query.trim()
    if (text.length === 1) return setSearchError('Type at least 2 characters to search.')
    setSearchError('')
    setSearched(text)
  }

  const connect = (person: Person) =>
    run(`connect-${person._id}`, async () => {
      setRowError(person._id, '')
      try {
        const response = await socialV2API.requestConnection(person._id)
        const accepted = /accepted/i.test(String(response?.message ?? ''))
        notify(accepted ? `You’re now connected with ${person.name}.` : `Request sent to ${person.name}.`, 'success')
        await reloadConnections()
      } catch (error) {
        setRowError(person._id, errorText(error, `Couldn’t send the request to ${person.name}.`))
      }
    })

  const respond = async (connection: Connection, action: 'accepted' | 'rejected') => {
    const person = otherOf(connection, myId)
    const name = person?.name ?? 'this person'
    if (action === 'rejected') {
      const sure = await confirm({
        title: 'Decline this request?',
        message: `${name} isn’t told. They can ask again after 14 days.`,
        confirmLabel: 'Decline',
        danger: true,
      })
      if (!sure) return
    }
    await run(`${action}-${connection._id}`, async () => {
      try {
        await socialV2API.respondConnection(connection._id, action)
        notify(action === 'accepted' ? `You’re now connected with ${name}.` : 'Request declined.', 'success')
        await reloadConnections()
      } catch (error) {
        notify(errorText(error, 'Couldn’t answer the request.'), 'error')
      }
    })
  }

  const dropConnection = async (connection: Connection, kind: 'withdraw' | 'remove') => {
    const name = otherOf(connection, myId)?.name ?? 'this person'
    const sure = await confirm(
      kind === 'withdraw'
        ? { title: 'Withdraw this request?', message: `${name} won’t see it any more. You can ask again whenever you like.`, confirmLabel: 'Withdraw request', danger: true }
        : { title: `Remove ${name}?`, message: 'You’re no longer connected. Either of you can send a new request later.', confirmLabel: 'Remove connection', danger: true },
    )
    if (!sure) return
    await run(`${kind}-${connection._id}`, async () => {
      try {
        await socialV2API.deleteConnection(connection._id)
        notify(kind === 'withdraw' ? 'Request withdrawn.' : `${name} removed from your connections.`, 'success')
        await reloadConnections()
      } catch (error) {
        notify(errorText(error, kind === 'withdraw' ? 'Couldn’t withdraw the request.' : 'Couldn’t remove the connection.'), 'error')
      }
    })
  }

  const renderAction = (person: Person) => {
    const relation = relations.get(person._id)
    if (relation?.kind === 'connected') return <Badge className={tone.success}>Connected</Badge>
    if (relation?.kind === 'sent') {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={tone.warning}>Request sent</Badge>
          <BusyButton
            busy={busy[`withdraw-${relation.connection._id}`]}
            onClick={() => void dropConnection(relation.connection, 'withdraw')}
            className={`${secondaryButton} ${smallButton}`}
            aria-label={`Withdraw your request to ${person.name}`}
          >
            Withdraw
          </BusyButton>
        </div>
      )
    }
    if (relation?.kind === 'received') {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={tone.info}>Wants to connect</Badge>
          <BusyButton
            busy={busy[`accepted-${relation.connection._id}`]}
            disabled={busy[`rejected-${relation.connection._id}`]}
            onClick={() => void respond(relation.connection, 'accepted')}
            className={`${successButton} ${smallButton}`}
            aria-label={`Accept ${person.name}`}
          >
            Accept
          </BusyButton>
        </div>
      )
    }
    return (
      <BusyButton
        busy={busy[`connect-${person._id}`]}
        busyLabel="Sending…"
        onClick={() => void connect(person)}
        icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
        className={`${primaryButton} ${smallButton} py-2.5`}
        aria-label={`Connect with ${person.name}`}
      >
        Connect
      </BusyButton>
    )
  }

  const { pendingReceived, pendingSent } = connections.data
  const shownPeople = people.data.slice(0, results.limit)

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <SectionCard
        id="find-people"
        title="Find people"
        description={searched ? `People matching “${searched}”.` : 'People from your team you aren’t connected with yet. Search to find anyone.'}
      >
        <form className="flex flex-wrap items-end gap-2" onSubmit={search} noValidate>
          <div className="min-w-0 flex-1 basis-48">
            <label htmlFor={`${id}-q`} className={labelClass}>Search by name</label>
            <input
              id={`${id}-q`}
              type="search"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
              aria-describedby={`${id}-q-hint`}
              className={inputClass}
            />
          </div>
          <BusyButton type="submit" busy={people.loading && people.loaded} busyLabel="Searching…" icon={<Search className="h-4 w-4" aria-hidden="true" />} className={`${primaryButton} py-3`}>
            Search
          </BusyButton>
          {searched ? (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setSearched('')
                setSearchError('')
              }}
              className={`${secondaryButton} py-3`}
            >
              Clear
            </button>
          ) : null}
        </form>
        <p id={`${id}-q-hint`} className={hintClass}>Type at least 2 characters. Leave it empty to see people from your team.</p>
        {searchError ? <p role="alert" className="mt-2 text-sm text-rose-700">{searchError}</p> : null}

        <div className="mt-4">
          {people.error ? <ErrorState message={people.error} onRetry={() => void people.reload()} retrying={people.loading} /> : null}
          {!people.loaded && people.loading ? <LoadingState label="Looking for people…" /> : null}
          {people.loaded && people.data.length === 0 && !people.error ? (
            <EmptyState>{searched ? 'Nobody matches that search.' : 'No teammates to suggest right now. Search for someone by name.'}</EmptyState>
          ) : null}
          <ul className="space-y-3">
            {shownPeople.map((person) => (
              <li key={person._id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <PersonLine person={person} />
                  {renderAction(person)}
                </div>
                {rowErrors[person._id] ? <p role="alert" className="mt-2 text-sm text-rose-700">{rowErrors[person._id]}</p> : null}
              </li>
            ))}
          </ul>
          <ShowMore limit={results.limit} initial={results.initial} total={people.data.length} onMore={results.more} onLess={results.less} noun="more people" />
        </div>
      </SectionCard>

      <div className="space-y-6">
        <SectionCard
          id="requests"
          title="Requests"
          description="People who asked to connect with you, and the requests you sent."
          action={connections.loaded ? <Badge className={pendingReceived.length > 0 ? tone.warning : tone.neutral}>{pendingReceived.length} waiting for you</Badge> : undefined}
        >
          {connections.error ? <div className="mb-4"><ErrorState message={connections.error} onRetry={() => void connections.reload()} retrying={connections.loading} /></div> : null}
          {!connections.loaded && connections.loading ? <LoadingState label="Loading requests…" /> : null}
          {connections.loaded && pendingReceived.length === 0 && pendingSent.length === 0 ? <EmptyState>No open requests.</EmptyState> : null}

          {pendingReceived.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-bold text-slate-900">Asked to connect with you</h3>
              <ul className="space-y-3">
                {pendingReceived.slice(0, incoming.limit).map((connection) => {
                  const person = otherOf(connection, myId)
                  return (
                    <li key={connection._id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {person ? <PersonLine person={person} /> : <span className="text-sm text-slate-500">Someone</span>}
                        <div className="flex gap-2">
                          <BusyButton
                            busy={busy[`accepted-${connection._id}`]}
                            disabled={busy[`rejected-${connection._id}`]}
                            onClick={() => void respond(connection, 'accepted')}
                            icon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}
                            className={`${successButton} ${smallButton}`}
                            aria-label={`Accept ${person?.name ?? 'request'}`}
                          >
                            Accept
                          </BusyButton>
                          <BusyButton
                            busy={busy[`rejected-${connection._id}`]}
                            disabled={busy[`accepted-${connection._id}`]}
                            onClick={() => void respond(connection, 'rejected')}
                            icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                            className={`${dangerButton} ${smallButton}`}
                            aria-label={`Decline ${person?.name ?? 'request'}`}
                          >
                            Decline
                          </BusyButton>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <ShowMore limit={incoming.limit} initial={incoming.initial} total={pendingReceived.length} onMore={incoming.more} onLess={incoming.less} noun="more requests" />
            </div>
          ) : null}

          {pendingSent.length > 0 ? (
            <div className={pendingReceived.length > 0 ? 'mt-5' : ''}>
              <h3 className="mb-2 text-sm font-bold text-slate-900">Requests you sent</h3>
              <ul className="space-y-3">
                {pendingSent.slice(0, sent.limit).map((connection) => {
                  const person = otherOf(connection, myId)
                  return (
                    <li key={connection._id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {person ? <PersonLine person={person} /> : <span className="text-sm text-slate-500">Someone</span>}
                        <BusyButton
                          busy={busy[`withdraw-${connection._id}`]}
                          busyLabel="Withdrawing…"
                          onClick={() => void dropConnection(connection, 'withdraw')}
                          className={`${secondaryButton} ${smallButton}`}
                          aria-label={`Withdraw your request to ${person?.name ?? 'this person'}`}
                        >
                          Withdraw
                        </BusyButton>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <ShowMore limit={sent.limit} initial={sent.initial} total={pendingSent.length} onMore={sent.more} onLess={sent.less} noun="more requests" />
            </div>
          ) : null}
        </SectionCard>

        <SectionCard
          id="connections"
          title="Your connections"
          description="People you’re connected with can see your posts shared with connections and message you."
          action={connections.loaded ? <Badge className={tone.neutral}>{plural(connections.data.connected.length, 'connection')}</Badge> : undefined}
        >
          {!connections.loaded && connections.loading ? <LoadingState label="Loading your connections…" /> : null}
          {connections.loaded && connections.data.connected.length === 0 ? <EmptyState>You aren’t connected with anyone yet.</EmptyState> : null}
          <ul className="space-y-3">
            {connections.data.connected.slice(0, connected.limit).map((connection) => {
              const person = otherOf(connection, myId)
              return (
                <li key={connection._id} className="rounded-[22px] border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {person ? <PersonLine person={person} /> : <span className="text-sm text-slate-500">Someone</span>}
                    <BusyButton
                      busy={busy[`remove-${connection._id}`]}
                      busyLabel="Removing…"
                      onClick={() => void dropConnection(connection, 'remove')}
                      icon={<UserMinus className="h-3.5 w-3.5" aria-hidden="true" />}
                      className={`${secondaryButton} ${smallButton}`}
                      aria-label={`Remove ${person?.name ?? 'this connection'}`}
                    >
                      Remove
                    </BusyButton>
                  </div>
                </li>
              )
            })}
          </ul>
          <ShowMore limit={connected.limit} initial={connected.initial} total={connections.data.connected.length} onMore={connected.more} onLess={connected.less} noun="more connections" />
        </SectionCard>
      </div>
    </div>
  )
}

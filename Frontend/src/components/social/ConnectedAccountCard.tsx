import { useId, useState } from 'react'
import { ExternalLink, Github, KeyRound, Linkedin, LogOut } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useFeedback } from '../../context/useFeedback'
import { errorText, formatDate, linkLabelFor } from './format'
import { useBusy, useNow } from './hooks'
import { accountName, startConnect } from './linkedin'
import { BusyButton } from './ui'
import { darkButton, hintClass, inputClass, linkButton, primaryButton, secondaryButton, smallButton } from './styles'
import type { Integration, Provider } from './types'

const PROVIDERS = {
  linkedin: {
    label: 'LinkedIn',
    icon: Linkedin,
    accent: 'bg-[#0a66c2]',
    button: `${primaryButton} bg-[#0a66c2] hover:bg-[#004182]`,
    explain:
      'Post to your own LinkedIn profile from Pandav. LinkedIn asks you to allow Pandav to see your name and photo and to post for you; Pandav never posts without you (or your approver) choosing to.',
  },
  github: {
    label: 'GitHub',
    icon: Github,
    accent: 'bg-slate-900',
    button: darkButton,
    explain: 'Open a post as an issue in a GitHub repository, as you.',
  },
} as const

// One linked account (LinkedIn or GitHub): connect it through the provider's
// own sign-in, see who it is and when the sign-in ends, connect again when it
// has expired, or disconnect it. A pasted access token stays available for
// servers without that sign-in set up.
export default function ConnectedAccountCard({
  provider,
  integration,
  onChanged,
}: {
  provider: Provider
  integration: Integration | null
  onChanged: () => void
}) {
  const { notify, confirm } = useFeedback()
  const { busy, run } = useBusy()
  const id = useId()
  const now = useNow(60_000)
  const [token, setToken] = useState('')
  const [tokenError, setTokenError] = useState('')
  const meta = PROVIDERS[provider]
  const Icon = meta.icon
  // Linked, but the sign-in can't be used any more: expired, refused, or unreadable
  const needsAgain = Boolean(integration && (integration.needsRelink || !integration.isConnected))
  const usable = Boolean(integration) && !needsAgain
  const picture = provider === 'linkedin' ? integration?.metadata?.picture : integration?.metadata?.avatarUrl
  const profileUrl = integration?.metadata?.profileUrl
  const endsAt = integration?.tokenExpiresAt
  const ended = Boolean(endsAt && new Date(endsAt).getTime() <= now)

  const connect = () =>
    run('connect', async () => {
      try {
        await startConnect(provider)
      } catch (error) {
        notify(errorText(error, `Couldn’t start connecting ${meta.label}. Try again.`), 'error')
      }
    })

  const disconnect = async () => {
    const sure = await confirm({
      title: `Disconnect ${meta.label}?`,
      message: `Posts waiting to go to ${meta.label} won’t go until you connect it again. Posts already there stay.`,
      confirmLabel: 'Disconnect',
      danger: true,
    })
    if (!sure) return
    await run('disconnect', async () => {
      try {
        await socialV2API.unlinkProvider(provider)
        notify(`${meta.label} disconnected.`, 'success')
        onChanged()
      } catch (error) {
        notify(errorText(error, `Couldn’t disconnect ${meta.label}.`), 'error')
      }
    })
  }

  const linkWithToken = () =>
    run('token', async () => {
      if (!token.trim()) return
      setTokenError('')
      try {
        await socialV2API.linkProvider(provider, { accessToken: token.trim() })
        setToken('')
        notify(`${meta.label} connected.`, 'success')
        onChanged()
      } catch (error) {
        setTokenError(errorText(error, `Couldn’t connect ${meta.label} with that token.`))
      }
    })

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm ${meta.accent}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-slate-900">{meta.label}</h3>
          {integration ? (
            <div className="mt-1 flex items-center gap-2">
              {picture ? <img src={picture} alt="" className="h-6 w-6 rounded-full object-cover" /> : null}
              <p className="min-w-0 truncate text-sm text-slate-700">
                {needsAgain ? 'Was connected as ' : 'Connected as '}
                <span className="font-semibold">{accountName(integration)}</span>
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-600">{meta.explain}</p>
          )}

          {needsAgain ? (
            <p role="alert" className="mt-1 text-xs font-semibold text-amber-800">
              {ended
                ? `The sign-in ended on ${formatDate(endsAt)}.`
                : 'The saved sign-in can’t be used any more.'}{' '}
              Connect again to keep posting.
            </p>
          ) : null}
          {usable ? (
            <p className={hintClass}>
              {linkLabelFor(integration?.accessTokenHint)}
              {integration?.connectedAt ? ` on ${formatDate(integration.connectedAt)}` : ''}.
              {endsAt ? ` Signed in until ${formatDate(endsAt)}; connect again before then to keep posting.` : ''}
            </p>
          ) : null}
          {profileUrl && integration && /^https:\/\//.test(profileUrl) ? (
            <a href={profileUrl} target="_blank" rel="noreferrer" className={`${linkButton} mt-1 inline-flex items-center gap-1 text-xs`}>
              View profile on {meta.label} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!usable ? (
          <BusyButton busy={busy.connect} busyLabel={`Opening ${meta.label}…`} onClick={() => void connect()} icon={<Icon className="h-4 w-4" aria-hidden="true" />} className={meta.button}>
            {needsAgain ? 'Connect again' : `Connect ${meta.label}`}
          </BusyButton>
        ) : (
          <BusyButton busy={busy.connect} busyLabel={`Opening ${meta.label}…`} onClick={() => void connect()} className={`${secondaryButton} ${smallButton}`}>
            Switch account
          </BusyButton>
        )}
        {integration ? (
          <BusyButton busy={busy.disconnect} busyLabel="Disconnecting…" onClick={() => void disconnect()} icon={<LogOut className="h-3.5 w-3.5" aria-hidden="true" />} className={`${secondaryButton} ${smallButton}`}>
            Disconnect
          </BusyButton>
        ) : null}
      </div>

      {!usable ? (
        <details className="mt-3 text-sm text-slate-600">
          <summary className="cursor-pointer select-none rounded font-semibold text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
            Use an access token instead
          </summary>
          <form
            className="mt-2 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void linkWithToken()
            }}
          >
            <label htmlFor={`${id}-token`} className="sr-only">{meta.label} access token</label>
            <input
              id={`${id}-token`}
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={`${meta.label} access token`}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <BusyButton type="submit" busy={busy.token} busyLabel="Connecting…" icon={<KeyRound className="h-4 w-4" aria-hidden="true" />} className={secondaryButton}>
              Connect
            </BusyButton>
            {tokenError ? <p role="alert" className="basis-full text-sm text-rose-700">{tokenError}</p> : null}
          </form>
        </details>
      ) : null}
    </div>
  )
}

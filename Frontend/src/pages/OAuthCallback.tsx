import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { socialV2API } from '../api/socialV2API'
import { useFeedback } from '../context/useFeedback'
import { errorText } from '../components/social/format'
import { accountName, startConnect, takeReturn } from '../components/social/linkedin'
import { primaryButton, secondaryButton } from '../components/social/styles'
import type { Integration, Provider } from '../components/social/types'

const NAMES: Record<Provider, string> = { linkedin: 'LinkedIn', github: 'GitHub' }

// Where LinkedIn (or GitHub) sends the browser back after its consent page:
// /integrations/:provider/callback?code=…&state=… (the server's
// LINKEDIN_REDIRECT_URI / GITHUB_REDIRECT_URI). Finishes linking the
// account, then returns to the page the person started from.
export default function OAuthCallback() {
  const { provider: rawProvider } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { notify } = useFeedback()
  const [problem, setProblem] = useState('')
  const started = useRef(false)

  const provider = rawProvider === 'linkedin' || rawProvider === 'github' ? rawProvider : null
  const name = provider ? NAMES[provider] : 'The provider'
  const code = params.get('code')
  const state = params.get('state')
  const refused = params.get('error')

  // What is wrong with the link itself, before asking the server anything
  let linkProblem = ''
  if (!provider) linkProblem = 'This sign-in link isn’t one Pandav knows.'
  else if (refused) {
    linkProblem = /cancel|denied/i.test(refused)
      ? `You didn’t allow Pandav to use your ${name} account, so nothing changed.`
      : `${name} said: ${params.get('error_description') || refused}`
  } else if (!code || !state) linkProblem = `${name} sent no sign-in code. Start connecting again.`

  useEffect(() => {
    // Once: a code can only be swapped for a token once
    if (linkProblem || !provider || !code || !state || started.current) return
    started.current = true

    void (async () => {
      try {
        const response = await socialV2API.finishProviderOAuth(provider, { code, state })
        const integration = response?.data as Integration | undefined
        notify(`${name} connected${integration ? ` as ${accountName(integration)}` : ''}.`, 'success')
        navigate(takeReturn('/integrations'), { replace: true })
      } catch (error) {
        setProblem(errorText(error, `Couldn’t connect ${name}. Try again.`))
      }
    })()
  }, [code, linkProblem, name, navigate, notify, provider, state])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 text-center shadow-[0_20px_60px_-24px_rgba(15,23,42,0.25)]">
        {!(linkProblem || problem) ? (
          <div role="status" className="flex flex-col items-center gap-3 text-slate-700">
            <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
            <p className="font-semibold">Connecting {name}…</p>
          </div>
        ) : (
          <div role="alert" className="flex flex-col items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden="true" />
            <h1 className="text-lg font-extrabold text-slate-950">{name} isn’t connected</h1>
            <p className="text-sm text-slate-600">{linkProblem || problem}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {provider ? (
                <button
                  type="button"
                  onClick={() => void startConnect(provider).catch((error) => setProblem(errorText(error, 'Couldn’t start again.')))}
                  className={primaryButton}
                >
                  Try again
                </button>
              ) : null}
              <button type="button" onClick={() => navigate(takeReturn('/integrations'), { replace: true })} className={secondaryButton}>
                Back to Pandav
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

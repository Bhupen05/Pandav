import { socialV2API } from '../../api/socialV2API'
import ConnectedAccountCard from './ConnectedAccountCard'
import { listOf } from './format'
import { useResource } from './hooks'
import { ErrorState, LoadingState, SectionCard } from './ui'
import type { Integration } from './types'

// Your LinkedIn and GitHub accounts: connect, connect again when the sign-in
// has ended, or disconnect.
export default function IntegrationsView() {
  const accounts = useResource<Integration[]>(
    async () => listOf<Integration>((await socialV2API.getIntegrations())?.data),
    'Couldn’t load your linked accounts.',
    [],
  )

  return (
    <div className="mx-auto w-full max-w-3xl">
      <SectionCard
        id="integrations"
        title="Linked accounts"
        description="Connect LinkedIn to post there from Pandav, and GitHub to open posts as issues. Only you can use your accounts."
      >
        {accounts.error ? <div className="mb-4"><ErrorState message={accounts.error} onRetry={() => void accounts.reload()} retrying={accounts.loading} /></div> : null}
        {!accounts.loaded && accounts.loading ? <LoadingState label="Loading your linked accounts…" /> : null}
        {accounts.loaded ? (
          <div className="space-y-4">
            {(['linkedin', 'github'] as const).map((provider) => (
              <ConnectedAccountCard
                key={provider}
                provider={provider}
                integration={accounts.data.find((item) => item.provider === provider) ?? null}
                onChanged={() => void accounts.reload()}
              />
            ))}
          </div>
        ) : null}
      </SectionCard>
    </div>
  )
}

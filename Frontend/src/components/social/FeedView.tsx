import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCcw } from 'lucide-react'
import { socialV2API } from '../../api/socialV2API'
import { useAuth } from '../../context/useAuth'
import PendingApprovals from './PendingApprovals'
import PostCard from './PostCard'
import PostComposer from './PostComposer'
import { errorText, listOf, personOf } from './format'
import { useResource } from './hooks'
import type { PatchPost, PostUpdate } from './postState'
import { BusyButton, EmptyState, ErrorState, LoadingState, SectionCard } from './ui'
import { secondaryButton, smallButton } from './styles'
import type { FeedCursor, Integration, SocialPost } from './types'

type FeedPage = { posts: SocialPost[]; hasMore: boolean; next: FeedCursor | null }
type Mode = 'all' | 'mine'

const emptyPage: FeedPage = { posts: [], hasMore: false, next: null }

// The feed: write a post, read everyone's (or only your own, in any state),
// and, for reviewers, decide the posts waiting for approval. Every action
// changes the one post it is about, so the paging stays where it is.
export default function FeedView() {
  const { user, isAdmin, isTeamLeader } = useAuth()
  const [params] = useSearchParams()
  const postParam = params.get('post')
  const [mode, setMode] = useState<Mode>('all')
  const reviewer = isAdmin || isTeamLeader

  const feed = useResource<FeedPage>(
    async () => {
      const response = await socialV2API.getFeed()
      return { posts: listOf<SocialPost>(response?.data), hasMore: Boolean(response?.hasMore), next: response?.next ?? null }
    },
    'Couldn’t load the feed.',
    emptyPage,
  )
  const mine = useResource<SocialPost[]>(
    async () => listOf<SocialPost>((await socialV2API.getMyPosts())?.data),
    'Couldn’t load your posts.',
    [],
    { enabled: mode === 'mine' },
  )
  const pending = useResource<SocialPost[]>(
    async () => listOf<SocialPost>((await socialV2API.getPendingApprovalPosts())?.data),
    'Couldn’t load the posts waiting for approval.',
    [],
    { enabled: reviewer },
  )
  const integrations = useResource<Integration[]>(
    async () => listOf<Integration>((await socialV2API.getIntegrations())?.data),
    'Couldn’t check your LinkedIn connection.',
    [],
  )

  const [moreBusy, setMoreBusy] = useState(false)
  const [moreError, setMoreError] = useState('')
  // The post a notification or link points at, when the feed page doesn't hold it
  const [linked, setLinked] = useState<SocialPost | null>(null)
  const [linkFailure, setLinkFailure] = useState<{ id: string; message: string } | null>(null)

  const { setData: setFeed } = feed
  const { setData: setMine } = mine
  const { setData: setPending } = pending

  // Every list holding the post shows the change
  const patchPost: PatchPost = useCallback(
    (postId: string, update: PostUpdate) => {
      const apply = (post: SocialPost) => (post._id === postId ? update(post) : post)
      setFeed((page) => ({ ...page, posts: page.posts.map(apply) }))
      setMine((posts) => posts.map(apply))
      setPending((posts) => posts.map(apply))
      setLinked((post) => (post && post._id === postId ? update(post) : post))
    },
    [setFeed, setMine, setPending],
  )

  const removePost = useCallback(
    (postId: string) => {
      setFeed((page) => ({ ...page, posts: page.posts.filter((post) => post._id !== postId) }))
      setMine((posts) => posts.filter((post) => post._id !== postId))
      setPending((posts) => posts.filter((post) => post._id !== postId))
      setLinked((post) => (post && post._id === postId ? null : post))
    },
    [setFeed, setMine, setPending],
  )

  function handleCreated(created: SocialPost) {
    const post: SocialPost = {
      ...created,
      author: personOf(created.author) ?? (user ? { _id: user._id, name: user.name, role: user.role, profileImage: user.profileImage } : null),
      comments: created.comments ?? [],
      likes: created.likes ?? [],
    }
    setFeed((page) => ({ ...page, posts: [post, ...page.posts.filter((item) => item._id !== post._id)] }))
    setMine((posts) => (posts.some((item) => item._id === post._id) ? posts : [post, ...posts]))
  }

  async function loadOlder() {
    const cursor = feed.data.next
    if (!cursor || moreBusy) return
    setMoreBusy(true)
    setMoreError('')
    try {
      const response = await socialV2API.getFeed(cursor.before, cursor.beforeId)
      const older = listOf<SocialPost>(response?.data)
      setFeed((page) => ({
        posts: [...page.posts, ...older.filter((post) => !page.posts.some((shown) => shown._id === post._id))],
        hasMore: Boolean(response?.hasMore),
        next: response?.next ?? null,
      }))
    } catch (error) {
      setMoreError(errorText(error, 'Couldn’t load older posts.'))
    } finally {
      setMoreBusy(false)
    }
  }

  // /social?post=<id>: load the post when the feed page doesn't hold it
  const inFeed = Boolean(postParam && feed.data.posts.some((post) => post._id === postParam))
  const feedLoaded = feed.loaded
  useEffect(() => {
    if (!postParam || !feedLoaded || inFeed) return
    let cancelled = false
    socialV2API
      .getPost(postParam)
      .then((response) => {
        if (!cancelled && response?.data) setLinked(response.data as SocialPost)
      })
      .catch((error) => {
        if (!cancelled) setLinkFailure({ id: postParam, message: errorText(error, 'Couldn’t open that post.') })
      })
    return () => {
      cancelled = true
    }
  }, [postParam, feedLoaded, inFeed])

  const showsLinked = Boolean(postParam && linked && linked._id === postParam && !inFeed)
  const present = inFeed || showsLinked
  // Bring the post into view once it is on the page
  useEffect(() => {
    if (!postParam || !present) return
    const element = document.getElementById(`post-${postParam}`)
    element?.scrollIntoView({ block: 'center' })
    element?.focus({ preventScroll: true })
  }, [postParam, present, mode])

  const posts = mode === 'mine' ? mine.data : feed.data.posts
  const list = mode === 'mine' ? mine : feed
  const linkedPost = showsLinked ? linked : null
  const failure = linkFailure && linkFailure.id === postParam ? linkFailure.message : ''

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {reviewer ? (
        <PendingApprovals
          posts={pending.data}
          loaded={pending.loaded}
          loading={pending.loading}
          error={pending.error}
          onRetry={() => void pending.reload()}
          onChange={patchPost}
        />
      ) : null}

      {integrations.error ? <ErrorState message={integrations.error} onRetry={() => void integrations.reload()} retrying={integrations.loading} /> : null}
      <PostComposer
        needsApproval={user?.role === 'user' || user?.role === 'team_member'}
        linkedin={integrations.data.find((item) => item.provider === 'linkedin') ?? null}
        onCreated={handleCreated}
      />

      <SectionCard
        id="feed"
        title={mode === 'mine' ? 'Your posts' : 'Social feed'}
        description={
          mode === 'mine'
            ? 'Everything you wrote, including posts waiting for approval, hidden ones and posts only for LinkedIn or GitHub.'
            : 'The newest posts from people you can see in Pandav.'
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Which posts" className="inline-flex rounded-2xl bg-slate-100 p-1">
              {([
                ['all', 'Everyone'],
                ['mine', 'My posts'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                    mode === value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <BusyButton
              busy={list.loading && list.loaded}
              onClick={() => void list.reload()}
              icon={<RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              className={`${secondaryButton} ${smallButton}`}
            >
              Refresh
            </BusyButton>
          </div>
        }
      >
        {failure ? (
          <p role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {failure}
          </p>
        ) : null}

        {linkedPost ? (
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">The post you opened</p>
            <PostCard post={linkedPost} highlighted onChange={patchPost} onRemoved={removePost} />
          </div>
        ) : null}

        {list.error ? <div className="mb-4"><ErrorState message={list.error} onRetry={() => void list.reload()} retrying={list.loading} /></div> : null}
        {!list.loaded && list.loading ? <LoadingState label={mode === 'mine' ? 'Loading your posts…' : 'Loading the feed…'} /> : null}
        {list.loaded && posts.length === 0 ? (
          <EmptyState>
            {mode === 'mine' ? 'You haven’t posted anything yet.' : 'The feed is empty right now. Your first post will show up here.'}
          </EmptyState>
        ) : null}

        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard key={post._id} post={post} highlighted={post._id === postParam} onChange={patchPost} onRemoved={removePost} />
          ))}
        </div>

        {mode === 'all' && feed.data.hasMore ? (
          <div className="mt-4 flex flex-col items-center gap-2">
            {moreError ? <p role="alert" className="text-sm text-rose-700">{moreError}</p> : null}
            <BusyButton busy={moreBusy} busyLabel="Loading…" onClick={() => void loadOlder()} className={secondaryButton}>
              Load older posts
            </BusyButton>
          </div>
        ) : null}
      </SectionCard>
    </div>
  )
}

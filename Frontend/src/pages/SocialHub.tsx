import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  CheckCheck,
  Github,
  Globe2,
  Linkedin,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Send,
  Shield,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react'
import { socialV2API } from '../api/socialV2API'
import { useAuth } from '../context/AuthContext'

type Role = 'admin' | 'team_leader' | 'team_member' | 'user'
type Visibility = 'public' | 'team' | 'connections'
type ModerationStatus = 'clean' | 'flagged' | 'hidden' | 'removed'
type ApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected'
type PublishStatus = 'none' | 'published' | 'failed'
type PersonalTaskStatus = 'todo' | 'in_progress' | 'completed'

type UserLite = {
  _id: string
  name: string
  email: string
  role: Role
  profileImage?: string
  department?: string
}

type SocialPost = {
  _id: string
  title?: string
  content: string
  tags?: string[]
  visibility: Visibility
  moderationStatus: ModerationStatus
  moderationReason?: string | null
  approvalStatus: ApprovalStatus
  createdAt: string
  likes: string[]
  comments: Array<{
    _id?: string
    text: string
    createdAt?: string
    user: UserLite
  }>
  author: UserLite & { teamId?: string }
  targets: {
    pandav: boolean
    linkedin: boolean
    github: boolean
  }
  publishResults?: {
    pandav?: { status: PublishStatus; message?: string | null }
    linkedin?: { status: PublishStatus; message?: string | null; externalId?: string | null }
    github?: { status: PublishStatus; message?: string | null; externalId?: string | null }
  }
}

type PersonalTask = {
  _id: string
  title: string
  description?: string
  priority: 'low' | 'medium' | 'high'
  status: PersonalTaskStatus
  dueDate?: string | null
  autoGenerateLinkedInPost: boolean
  autoPostStatus?: 'none' | 'pending_approval' | 'published' | 'failed' | 'already_generated'
  autoPostMessage?: string | null
}

type Connection = {
  _id: string
  status: 'pending' | 'accepted' | 'rejected'
  requester?: UserLite
  recipient?: UserLite
}

type ConnectionState = {
  pendingSent: Connection[]
  pendingReceived: Connection[]
  connected: Connection[]
}

type Integration = {
  _id: string
  provider: 'linkedin' | 'github'
  accountHandle: string
  isConnected: boolean
  scopes: string[]
  connectedAt: string
  metadata?: Record<string, unknown>
}

type PublishJob = {
  _id: string
  provider: 'linkedin' | 'github'
  status: 'queued' | 'processing' | 'completed' | 'failed'
  attempts: number
  maxAttempts: number
  nextRetryAt?: string | null
  completedAt?: string | null
  lastError?: string | null
  post?: {
    _id?: string
    title?: string
    content?: string
    approvalStatus?: ApprovalStatus
    targets?: {
      pandav: boolean
      linkedin: boolean
      github: boolean
    }
  }
}

type ProviderPreview = {
  profile?: Record<string, unknown> | null
  posts?: unknown[]
}

const defaultConnections: ConnectionState = {
  pendingSent: [],
  pendingReceived: [],
  connected: [],
}

const initialComposer = {
  title: '',
  content: '',
  visibility: 'public' as Visibility,
  pandav: true,
  linkedin: false,
  github: false,
  tags: '',
}

const initialTaskForm = {
  title: '',
  description: '',
  priority: 'medium' as 'low' | 'medium' | 'high',
  dueDate: '',
  autoGenerateLinkedInPost: true,
}

const initialTokenForm = {
  linkedin: '',
  github: '',
}

const providerMeta = {
  linkedin: {
    label: 'LinkedIn',
    icon: Linkedin,
    accent: 'from-sky-500 to-blue-700',
    border: 'border-sky-200',
    soft: 'bg-sky-50',
  },
  github: {
    label: 'GitHub',
    icon: Github,
    accent: 'from-slate-700 to-slate-900',
    border: 'border-slate-300',
    soft: 'bg-slate-50',
  },
} as const

const formatDate = (value?: string | null) => {
  if (!value) return 'No date'
  return new Date(value).toLocaleDateString()
}

const formatTime = (value?: string | null) => {
  if (!value) return 'Just now'
  return new Date(value).toLocaleString()
}

const initials = (name?: string) =>
  (name || 'User')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

const badgeClassByPriority: Record<PersonalTask['priority'], string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-rose-100 text-rose-700',
}

const approvalTone: Record<ApprovalStatus, string> = {
  none: 'bg-slate-100 text-slate-600',
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
}

function Avatar({ user }: { user: UserLite }) {
  return user.profileImage ? (
    <img src={user.profileImage} alt={user.name} className="h-11 w-11 rounded-2xl object-cover shadow-sm" />
  ) : (
    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold text-white shadow-sm">
      {initials(user.name)}
    </div>
  )
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.25)] backdrop-blur">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function SocialHub() {
  const navigate = useNavigate()
  const { isAuthenticated, user, isAdmin, isTeamLeader } = useAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [feed, setFeed] = useState<SocialPost[]>([])
  const [personalTasks, setPersonalTasks] = useState<PersonalTask[]>([])
  const [connections, setConnections] = useState<ConnectionState>(defaultConnections)
  const [discoverQuery, setDiscoverQuery] = useState('')
  const [discoverResults, setDiscoverResults] = useState<UserLite[]>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [providerPreview, setProviderPreview] = useState<Record<'linkedin' | 'github', ProviderPreview>>({
    linkedin: {},
    github: {},
  })
  const [publishJobs, setPublishJobs] = useState<PublishJob[]>([])
  const [moderationPosts, setModerationPosts] = useState<SocialPost[]>([])
  const [composer, setComposer] = useState(initialComposer)
  const [taskForm, setTaskForm] = useState(initialTaskForm)
  const [tokenForm, setTokenForm] = useState(initialTokenForm)
  const [githubRepoByPost, setGithubRepoByPost] = useState<Record<string, string>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [submittingPost, setSubmittingPost] = useState(false)
  const [submittingTask, setSubmittingTask] = useState(false)
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login')
      return
    }
    void loadDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, navigate])

  const connectedUserIds = useMemo(() => {
    const ids = new Set<string>()
    connections.connected.forEach((connection) => {
      const otherUser =
        connection.requester?._id === user?._id ? connection.recipient?._id : connection.requester?._id
      if (otherUser) ids.add(otherUser)
    })
    return ids
  }, [connections.connected, user?._id])

  const pendingSentIds = useMemo(
    () => new Set(connections.pendingSent.map((item) => item.recipient?._id).filter(Boolean)),
    [connections.pendingSent],
  )
  const pendingReceivedIds = useMemo(
    () => new Set(connections.pendingReceived.map((item) => item.requester?._id).filter(Boolean)),
    [connections.pendingReceived],
  )

  const myPosts = useMemo(() => feed.filter((post) => post.author._id === user?._id), [feed, user?._id])
  const pendingApprovals = useMemo(() => feed.filter((post) => post.approvalStatus === 'pending'), [feed])
  const completedPersonalTasks = useMemo(
    () => personalTasks.filter((task) => task.status === 'completed').length,
    [personalTasks],
  )

  async function loadDashboard(withRefreshState = false) {
    if (withRefreshState) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    setError('')

    try {
      const responses = await Promise.all([
        socialV2API.getFeed(),
        socialV2API.getPersonalTasks(),
        socialV2API.getConnections(),
        socialV2API.discoverUsers(),
        socialV2API.getIntegrations(),
        socialV2API.getPublishJobs(),
        isAdmin ? socialV2API.getModerationPosts() : Promise.resolve(null),
      ])

      setFeed(Array.isArray(responses[0]?.data) ? responses[0].data : [])
      setPersonalTasks(Array.isArray(responses[1]?.data) ? responses[1].data : [])
      setConnections(responses[2]?.data ?? defaultConnections)
      setDiscoverResults(Array.isArray(responses[3]?.data) ? responses[3].data : [])
      setIntegrations(Array.isArray(responses[4]?.data) ? responses[4].data : [])
      setPublishJobs(Array.isArray(responses[5]?.data) ? responses[5].data : [])
      if (isAdmin && responses[6]?.data) {
        setModerationPosts(Array.isArray(responses[6].data) ? responses[6].data : [])
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Unable to load the social workspace'
      setError(message)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  async function refreshDiscover(query = discoverQuery) {
    setDiscoverLoading(true)
    try {
      const response = await socialV2API.discoverUsers(query)
      setDiscoverResults(Array.isArray(response?.data) ? response.data : [])
    } catch (discoverError) {
      const message = discoverError instanceof Error ? discoverError.message : 'Unable to search users'
      setError(message)
    } finally {
      setDiscoverLoading(false)
    }
  }

  function withBusy(key: string, value: boolean) {
    setBusyMap((current) => ({ ...current, [key]: value }))
  }

  async function handleCreatePost(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmittingPost(true)
    setNotice('')

    try {
      const response = await socialV2API.createPost({
        title: composer.title.trim() || undefined,
        content: composer.content.trim(),
        visibility: composer.visibility,
        tags: composer.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        targets: {
          pandav: composer.pandav,
          linkedin: composer.linkedin,
          github: composer.github,
        },
      })

      if (response?.data) {
        setFeed((current) => [response.data as SocialPost, ...current])
      }
      setComposer(initialComposer)
      setNotice('Post published to your Pandav workspace and queued for any selected approvals.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to create post')
    } finally {
      setSubmittingPost(false)
    }
  }

  async function handleToggleLike(postId: string) {
    withBusy(`like-${postId}`, true)
    try {
      const response = await socialV2API.likePost(postId)
      const liked = Boolean(response?.liked)
      setFeed((current) =>
        current.map((post) => {
          if (post._id !== postId || !user?._id) return post
          const existing = new Set(post.likes)
          if (liked) existing.add(user._id)
          else existing.delete(user._id)
          return { ...post, likes: Array.from(existing) }
        }),
      )
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : 'Unable to update like')
    } finally {
      withBusy(`like-${postId}`, false)
    }
  }

  async function handleAddComment(postId: string) {
    const text = commentDrafts[postId]?.trim()
    if (!text) return

    withBusy(`comment-${postId}`, true)
    try {
      const response = await socialV2API.addComment(postId, text)
      if (response?.data) {
        setFeed((current) =>
          current.map((post) =>
            post._id === postId
              ? { ...post, comments: [...post.comments, response.data as SocialPost['comments'][number]] }
              : post,
          ),
        )
      }
      setCommentDrafts((current) => ({ ...current, [postId]: '' }))
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : 'Unable to add comment')
    } finally {
      withBusy(`comment-${postId}`, false)
    }
  }

  async function handleCreateTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmittingTask(true)
    setNotice('')

    try {
      const response = await socialV2API.createPersonalTask({
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        priority: taskForm.priority,
        dueDate: taskForm.dueDate || null,
        autoGenerateLinkedInPost: taskForm.autoGenerateLinkedInPost,
      })
      if (response?.data) {
        setPersonalTasks((current) => [response.data as PersonalTask, ...current])
      }
      setTaskForm(initialTaskForm)
      setNotice('Personal task added to your sprint lane.')
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : 'Unable to create personal task')
    } finally {
      setSubmittingTask(false)
    }
  }

  async function handleToggleTask(taskId: string) {
    withBusy(`task-${taskId}`, true)
    try {
      const response = await socialV2API.togglePersonalTask(taskId)
      if (response?.data) {
        setPersonalTasks((current) =>
          current.map((task) => (task._id === taskId ? (response.data as PersonalTask) : task)),
        )
      }
      if (response?.autoShare?.generated) {
        await loadDashboard(true)
        setNotice('Task completed and a social post was generated from it.')
      }
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update personal task')
    } finally {
      withBusy(`task-${taskId}`, false)
    }
  }

  async function handleDeleteTask(taskId: string) {
    withBusy(`delete-task-${taskId}`, true)
    try {
      await socialV2API.deletePersonalTask(taskId)
      setPersonalTasks((current) => current.filter((task) => task._id !== taskId))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete task')
    } finally {
      withBusy(`delete-task-${taskId}`, false)
    }
  }

  async function handleConnect(userId: string) {
    withBusy(`connect-${userId}`, true)
    try {
      await socialV2API.requestConnection(userId)
      await loadDashboard(true)
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Unable to send connection request')
    } finally {
      withBusy(`connect-${userId}`, false)
    }
  }

  async function handleRespondConnection(connectionId: string, action: 'accepted' | 'rejected') {
    withBusy(`respond-${connectionId}-${action}`, true)
    try {
      await socialV2API.respondConnection(connectionId, action)
      await loadDashboard(true)
    } catch (respondError) {
      setError(respondError instanceof Error ? respondError.message : 'Unable to update connection request')
    } finally {
      withBusy(`respond-${connectionId}-${action}`, false)
    }
  }

  async function handleLinkProvider(provider: 'linkedin' | 'github') {
    const accessToken = tokenForm[provider].trim()
    if (!accessToken) return

    withBusy(`link-${provider}`, true)
    try {
      await socialV2API.linkProvider(provider, { accessToken })
      setTokenForm((current) => ({ ...current, [provider]: '' }))
      await loadDashboard(true)
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : `Unable to link ${provider}`)
    } finally {
      withBusy(`link-${provider}`, false)
    }
  }

  async function handleLoadProviderPreview(provider: 'linkedin' | 'github') {
    withBusy(`preview-${provider}`, true)
    try {
      const [profileResponse, postsResponse] = await Promise.all([
        socialV2API.getProviderProfile(provider),
        socialV2API.getProviderPosts(provider),
      ])
      setProviderPreview((current) => ({
        ...current,
        [provider]: {
          profile: profileResponse?.data ?? null,
          posts: Array.isArray(postsResponse?.data) ? postsResponse.data : [],
        },
      }))
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : `Unable to fetch ${provider} preview`)
    } finally {
      withBusy(`preview-${provider}`, false)
    }
  }

  async function handleApprovePost(postId: string, action: 'approved' | 'rejected') {
    withBusy(`approval-${postId}-${action}`, true)
    try {
      const response = await socialV2API.approvePost(postId, action)
      if (response?.data) {
        setFeed((current) =>
          current.map((post) => (post._id === postId ? (response.data as SocialPost) : post)),
        )
      }
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to update approval')
    } finally {
      withBusy(`approval-${postId}-${action}`, false)
    }
  }

  async function handleCreatePublishJob(post: SocialPost) {
    withBusy(`job-${post._id}`, true)
    try {
      await socialV2API.createPublishJobs(post._id, {
        targets: {
          linkedin: post.targets.linkedin,
          github: post.targets.github,
        },
        githubRepo: githubRepoByPost[post._id]?.trim() || null,
      })
      await loadDashboard(true)
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : 'Unable to queue publish job')
    } finally {
      withBusy(`job-${post._id}`, false)
    }
  }

  async function handleProcessJob(jobId: string) {
    withBusy(`process-job-${jobId}`, true)
    try {
      await socialV2API.processPublishJob(jobId)
      await loadDashboard(true)
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : 'Unable to process job')
    } finally {
      withBusy(`process-job-${jobId}`, false)
    }
  }

  async function handleRetryJob(jobId: string) {
    withBusy(`retry-job-${jobId}`, true)
    try {
      await socialV2API.retryPublishJob(jobId)
      await loadDashboard(true)
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Unable to retry job')
    } finally {
      withBusy(`retry-job-${jobId}`, false)
    }
  }

  async function handleProcessDueJobs() {
    withBusy('process-due-jobs', true)
    try {
      await socialV2API.processDuePublishJobs()
      await loadDashboard(true)
    } catch (dueError) {
      setError(dueError instanceof Error ? dueError.message : 'Unable to process due jobs')
    } finally {
      withBusy('process-due-jobs', false)
    }
  }

  async function handleModerate(postId: string, action: string) {
    withBusy(`moderate-${postId}-${action}`, true)
    try {
      await socialV2API.moderatePost(postId, action)
      await loadDashboard(true)
    } catch (moderateError) {
      setError(moderateError instanceof Error ? moderateError.message : 'Unable to moderate post')
    } finally {
      withBusy(`moderate-${postId}-${action}`, false)
    }
  }

  if (!isAuthenticated || !user) {
    return null
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)]">
        <div className="flex items-center gap-3 rounded-full border border-white/80 bg-white/90 px-5 py-3 text-sm font-semibold text-slate-700 shadow-lg">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Loading your social workspace...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.2),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(251,146,60,0.18),_transparent_25%),linear-gradient(180deg,#f8fafc_0%,#edf4ff_48%,#f8fafc_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 xl:px-8">
        <section className="overflow-hidden rounded-[32px] border border-slate-200/70 bg-slate-950 text-white shadow-[0_30px_120px_-40px_rgba(2,6,23,0.65)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.6fr_1fr] lg:p-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">
                <Sparkles className="h-3.5 w-3.5" />
                Backend aligned V2 workspace
              </div>
              <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-white md:text-5xl">
                Social publishing, personal planning, and team networking in one cleaner flow.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
                This hub is now wired to the backend V2 social routes for feed, personal tasks, connections,
                integrations, publish jobs, and admin moderation.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={() => void loadDashboard(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:-translate-y-0.5"
                >
                  <RefreshCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  Refresh data
                </button>
                <button
                  onClick={() => navigate('/tasks')}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15"
                >
                  Open assigned tasks
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {[
                { label: 'Feed posts', value: feed.length, icon: Globe2 },
                { label: 'My posts', value: myPosts.length, icon: Send },
                { label: 'Personal tasks done', value: completedPersonalTasks, icon: CheckCheck },
                { label: 'Connections', value: connections.connected.length, icon: Users },
              ].map((item) => (
                <div key={item.label} className="rounded-[24px] border border-white/12 bg-white/10 p-4 backdrop-blur">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-300">{item.label}</span>
                    <item.icon className="h-4 w-4 text-sky-200" />
                  </div>
                  <div className="mt-4 text-3xl font-black">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {(error || notice) && (
          <div className="mt-5 grid gap-3">
            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {notice ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}
          </div>
        )}

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="space-y-6">
            <SectionCard title="Compose update" description="Create a Pandav post and optionally target LinkedIn or GitHub using the V2 publishing flow.">
              <form className="space-y-4" onSubmit={handleCreatePost}>
                <div className="grid gap-4 md:grid-cols-2">
                  <input value={composer.title} onChange={(event) => setComposer((current) => ({ ...current, title: event.target.value }))} placeholder="Optional title" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white" />
                  <select value={composer.visibility} onChange={(event) => setComposer((current) => ({ ...current, visibility: event.target.value as Visibility }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white">
                    <option value="public">Public</option>
                    <option value="team">Team only</option>
                    <option value="connections">Connections</option>
                  </select>
                </div>

                <textarea value={composer.content} onChange={(event) => setComposer((current) => ({ ...current, content: event.target.value }))} placeholder="Share progress, celebrate a milestone, or draft an external-ready update..." rows={5} className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white" />
                <input value={composer.tags} onChange={(event) => setComposer((current) => ({ ...current, tags: event.target.value }))} placeholder="Tags, separated by commas" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white" />

                <div className="flex flex-wrap gap-2">
                  {([
                    ['pandav', 'Pandav feed'],
                    ['linkedin', 'LinkedIn'],
                    ['github', 'GitHub'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${composer[key] ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                      <input type="checkbox" checked={composer[key]} onChange={(event) => setComposer((current) => ({ ...current, [key]: event.target.checked }))} className="hidden" />
                      {label}
                    </label>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button type="submit" disabled={submittingPost} className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-70">
                    {submittingPost ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Create post
                  </button>
                </div>
              </form>
            </SectionCard>

            <SectionCard
              title="Social feed"
              description="Live feed from `/api/v2/social/feed` with likes, comments, approvals, and publish-job entry points."
              action={<div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{feed.length} posts</div>}
            >
              <div className="space-y-4">
                {feed.length === 0 ? <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">The feed is empty right now. Your first post will show up here.</div> : null}
                {feed.map((post) => {
                  const liked = post.likes.includes(user._id)
                  const needsGithubRepo = post.targets.github
                  const canApprove = post.approvalStatus === 'pending' && (isAdmin || isTeamLeader)
                  const canQueueJobs = (post.author._id === user._id || isAdmin || isTeamLeader) && (post.targets.linkedin || post.targets.github) && post.approvalStatus !== 'pending' && post.approvalStatus !== 'rejected'

                  return (
                    <article key={post._id} className="rounded-[26px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5">
                      <div className="flex items-start gap-4">
                        <Avatar user={post.author} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-bold text-slate-950">{post.author.name}</h3>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{post.author.role.replace('_', ' ')}</span>
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${approvalTone[post.approvalStatus]}`}>{post.approvalStatus}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{formatTime(post.createdAt)}</p>
                        </div>
                      </div>

                      {post.title ? <h4 className="mt-4 text-lg font-extrabold text-slate-950">{post.title}</h4> : null}
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.content}</p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">{post.visibility}</span>
                        {post.tags?.map((tag) => <span key={`${post._id}-${tag}`} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">#{tag}</span>)}
                        {post.targets.linkedin ? <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">LinkedIn</span> : null}
                        {post.targets.github ? <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">GitHub</span> : null}
                      </div>

                      {post.publishResults ? (
                        <div className="mt-4 grid gap-2 md:grid-cols-3">
                          {(['pandav', 'linkedin', 'github'] as const).map((target) => {
                            const item = post.publishResults?.[target]
                            if (!item) return null
                            return (
                              <div key={`${post._id}-${target}`} className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                <div className="font-bold uppercase tracking-wide text-slate-500">{target}</div>
                                <div className="mt-1">{item.status}</div>
                                {item.message ? <div className="mt-1 line-clamp-2">{item.message}</div> : null}
                              </div>
                            )
                          })}
                        </div>
                      ) : null}

                      {canApprove ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button onClick={() => void handleApprovePost(post._id, 'approved')} disabled={busyMap[`approval-${post._id}-approved`]} className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white">Approve</button>
                          <button onClick={() => void handleApprovePost(post._id, 'rejected')} disabled={busyMap[`approval-${post._id}-rejected`]} className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700">Reject</button>
                        </div>
                      ) : null}

                      {canQueueJobs ? (
                        <div className="mt-4 grid gap-3 rounded-[22px] border border-slate-200 bg-white p-4 md:grid-cols-[1fr_auto]">
                          {needsGithubRepo ? (
                            <input value={githubRepoByPost[post._id] || ''} onChange={(event) => setGithubRepoByPost((current) => ({ ...current, [post._id]: event.target.value }))} placeholder="GitHub repo (owner/repo) if needed" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:bg-white" />
                          ) : (
                            <div className="flex items-center rounded-2xl bg-slate-50 px-4 text-sm text-slate-500">Ready to create publish jobs for external targets.</div>
                          )}
                          <button onClick={() => void handleCreatePublishJob(post)} disabled={busyMap[`job-${post._id}`]} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">Queue publish job</button>
                        </div>
                      ) : null}

                      <div className="mt-5 flex items-center gap-3">
                        <button onClick={() => void handleToggleLike(post._id)} disabled={busyMap[`like-${post._id}`]} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${liked ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>
                          {liked ? 'Liked' : 'Like'} · {post.likes.length}
                        </button>
                        <span className="text-sm text-slate-500">{post.comments.length} comments</span>
                      </div>

                      <div className="mt-4 space-y-3">
                        {post.comments.slice(-3).map((comment, index) => (
                          <div key={`${post._id}-comment-${index}`} className="rounded-2xl bg-slate-50 px-4 py-3">
                            <div className="text-sm font-semibold text-slate-800">{comment.user?.name || 'Unknown user'}</div>
                            <div className="mt-1 text-sm text-slate-600">{comment.text}</div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                        <input value={commentDrafts[post._id] || ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post._id]: event.target.value }))} placeholder="Add a thoughtful comment" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white" />
                        <button onClick={() => void handleAddComment(post._id)} disabled={busyMap[`comment-${post._id}`]} className="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-bold text-white">Comment</button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard
              title="Personal sprint"
              description="Backed by `/api/v2/social/personal-tasks` with auto-share support for completed work."
              action={<div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{personalTasks.length} items</div>}
            >
              <form className="space-y-3" onSubmit={handleCreateTask}>
                <input value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} placeholder="Task title" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white" />
                <textarea value={taskForm.description} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} rows={3} placeholder="Short description" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white" />
                <div className="grid gap-3 md:grid-cols-2">
                  <select value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value as 'low' | 'medium' | 'high' }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white">
                    <option value="low">Low priority</option>
                    <option value="medium">Medium priority</option>
                    <option value="high">High priority</option>
                  </select>
                  <input type="date" value={taskForm.dueDate} onChange={(event) => setTaskForm((current) => ({ ...current, dueDate: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white" />
                </div>
                <label className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input type="checkbox" checked={taskForm.autoGenerateLinkedInPost} onChange={(event) => setTaskForm((current) => ({ ...current, autoGenerateLinkedInPost: event.target.checked }))} />
                  Auto-generate a LinkedIn-target post when completed
                </label>
                <button type="submit" disabled={submittingTask} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">
                  {submittingTask ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add task
                </button>
              </form>

              <div className="mt-5 space-y-3">
                {personalTasks.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No personal tasks yet.</div> : null}
                {personalTasks.map((task) => (
                  <div key={task._id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-slate-900">{task.title}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badgeClassByPriority[task.priority]}`}>{task.priority}</span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{task.status.replace('_', ' ')}</span>
                        </div>
                        {task.description ? <p className="mt-2 text-sm text-slate-600">{task.description}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                          <span>Due: {formatDate(task.dueDate)}</span>
                          <span>Auto-share: {task.autoGenerateLinkedInPost ? 'On' : 'Off'}</span>
                          {task.autoPostStatus && task.autoPostStatus !== 'none' ? <span>Post: {task.autoPostStatus.replace('_', ' ')}</span> : null}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button onClick={() => void handleToggleTask(task._id)} disabled={busyMap[`task-${task._id}`]} className={`rounded-2xl px-3 py-2 text-sm font-bold ${task.status === 'completed' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-600 text-white'}`}>{task.status === 'completed' ? 'Reopen' : 'Complete'}</button>
                        <button onClick={() => void handleDeleteTask(task._id)} disabled={busyMap[`delete-task-${task._id}`]} className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title="Connections"
              description="Search active users, send network requests, and handle incoming approvals."
              action={<div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{connections.connected.length} connected</div>}
            >
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <input value={discoverQuery} onChange={(event) => setDiscoverQuery(event.target.value)} placeholder="Search by name or email" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white" />
                <button onClick={() => void refreshDiscover()} disabled={discoverLoading} className="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-bold text-white">{discoverLoading ? 'Searching...' : 'Search'}</button>
              </div>

              <div className="mt-4 space-y-3">
                {discoverResults.slice(0, 6).map((person) => {
                  const connected = connectedUserIds.has(person._id)
                  const pendingSent = pendingSentIds.has(person._id)
                  const pendingReceived = pendingReceivedIds.has(person._id)
                  return (
                    <div key={person._id} className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-3">
                        <Avatar user={person} />
                        <div>
                          <div className="font-semibold text-slate-900">{person.name}</div>
                          <div className="text-sm text-slate-500">{person.email}</div>
                        </div>
                      </div>
                      {connected ? <span className="rounded-full bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-700">Connected</span> : pendingSent ? <span className="rounded-full bg-amber-100 px-3 py-2 text-xs font-bold text-amber-700">Pending sent</span> : pendingReceived ? <span className="rounded-full bg-sky-100 px-3 py-2 text-xs font-bold text-sky-700">Awaiting response</span> : <button onClick={() => void handleConnect(person._id)} disabled={busyMap[`connect-${person._id}`]} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white"><UserPlus className="h-4 w-4" />Connect</button>}
                    </div>
                  )
                })}
              </div>

              {connections.pendingReceived.length > 0 ? (
                <div className="mt-5">
                  <div className="mb-3 text-sm font-bold text-slate-900">Incoming requests</div>
                  <div className="space-y-3">
                    {connections.pendingReceived.map((connection) => (
                      <div key={connection._id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-slate-900">{connection.requester?.name}</div>
                            <div className="text-sm text-slate-500">{connection.requester?.email}</div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => void handleRespondConnection(connection._id, 'accepted')} disabled={busyMap[`respond-${connection._id}-accepted`]} className="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white">Accept</button>
                            <button onClick={() => void handleRespondConnection(connection._id, 'rejected')} disabled={busyMap[`respond-${connection._id}-rejected`]} className="rounded-2xl border border-rose-200 bg-white px-3 py-2 text-sm font-bold text-rose-700">Decline</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </SectionCard>
            <SectionCard title="Integrations" description="Link LinkedIn or GitHub tokens, then preview profile and recent provider content.">
              <div className="space-y-4">
                {(['linkedin', 'github'] as const).map((provider) => {
                  const meta = providerMeta[provider]
                  const Icon = meta.icon
                  const linked = integrations.find((item) => item.provider === provider)
                  const preview = providerPreview[provider]

                  return (
                    <div key={provider} className={`rounded-[24px] border ${meta.border} ${meta.soft} p-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.accent} text-white shadow-lg`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="font-bold text-slate-900">{meta.label}</h3>
                            <p className="text-sm text-slate-600">{linked ? `Connected as ${linked.accountHandle}` : 'Not connected'}</p>
                          </div>
                        </div>
                        {linked?.isConnected ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Connected</span> : null}
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                        <input value={tokenForm[provider]} onChange={(event) => setTokenForm((current) => ({ ...current, [provider]: event.target.value }))} placeholder={`${meta.label} access token`} className="w-full rounded-2xl border border-white/70 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400" />
                        <button onClick={() => void handleLinkProvider(provider)} disabled={busyMap[`link-${provider}`]} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">Link</button>
                        <button onClick={() => void handleLoadProviderPreview(provider)} disabled={!linked || busyMap[`preview-${provider}`]} className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60">Preview</button>
                      </div>

                      {preview.profile ? (
                        <div className="mt-4 rounded-2xl bg-white/80 p-4 text-sm text-slate-700">
                          <div className="font-bold text-slate-900">Profile snapshot</div>
                          <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(preview.profile, null, 2)}</pre>
                        </div>
                      ) : null}

                      {preview.posts?.length ? (
                        <div className="mt-4 rounded-2xl bg-white/80 p-4">
                          <div className="font-bold text-slate-900">Recent provider items</div>
                          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(preview.posts.slice(0, 3), null, 2)}</pre>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </SectionCard>

            <SectionCard
              title="Publish jobs"
              description="Monitor queued, processing, completed, or failed external publishing jobs."
              action={isAdmin ? <button onClick={() => void handleProcessDueJobs()} disabled={busyMap['process-due-jobs']} className="rounded-2xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">Process due jobs</button> : undefined}
            >
              <div className="space-y-3">
                {publishJobs.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No publish jobs created yet.</div> : null}
                {publishJobs.slice(0, 8).map((job) => (
                  <div key={job._id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900">{providerMeta[job.provider].label}</span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{job.status}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{job.post?.title || 'Untitled post'} · attempts {job.attempts}/{job.maxAttempts}</p>
                        {job.lastError ? <p className="mt-2 text-sm text-rose-600">{job.lastError}</p> : null}
                      </div>
                      <div className="flex gap-2">
                        {job.status !== 'completed' ? <button onClick={() => void handleProcessJob(job._id)} disabled={busyMap[`process-job-${job._id}`]} className="rounded-2xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">Process</button> : null}
                        {job.status === 'failed' ? <button onClick={() => void handleRetryJob(job._id)} disabled={busyMap[`retry-job-${job._id}`]} className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">Retry</button> : null}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Next retry: {formatTime(job.nextRetryAt)} {job.completedAt ? `· Completed ${formatTime(job.completedAt)}` : ''}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {(isAdmin || pendingApprovals.length > 0) && (
              <SectionCard title="Moderation and approvals" description="Pending external approvals plus admin moderation controls for the V2 feed.">
                <div className="space-y-3">
                  {pendingApprovals.slice(0, 4).map((post) => (
                    <div key={post._id} className="rounded-[24px] border border-amber-200 bg-amber-50 p-4">
                      <div className="font-bold text-slate-900">{post.title || post.content.slice(0, 60)}</div>
                      <p className="mt-2 text-sm text-slate-600">{post.author.name} is waiting for approval.</p>
                    </div>
                  ))}

                  {isAdmin && moderationPosts.slice(0, 5).map((post) => (
                    <div key={`mod-${post._id}`} className="rounded-[24px] border border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-900">{post.title || 'Untitled post'}</div>
                          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{post.content}</p>
                          <div className="mt-2 text-xs text-slate-500">{post.author.name} · moderation {post.moderationStatus}</div>
                        </div>
                        <Shield className="h-5 w-5 text-slate-400" />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {(['flag', 'hide', 'remove', 'restore'] as const).map((action) => (
                          <button key={`${post._id}-${action}`} onClick={() => void handleModerate(post._id, action)} disabled={busyMap[`moderate-${post._id}-${action}`]} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">{action}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

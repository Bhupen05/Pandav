# Frontend V2 Quick Reference & Integration Guide

A quick reference guide for integrating V2 backend features into existing frontend pages.

## Quick Navigation

- **Setup & Configuration**: [FRONTEND_V2_COMPREHENSIVE_GUIDE.md](FRONTEND_V2_COMPREHENSIVE_GUIDE.md)
- **Implementation Details**: [FRONTEND_V2_IMPLEMENTATION_GUIDE.md](FRONTEND_V2_IMPLEMENTATION_GUIDE.md)
- **Step-by-Step Guide**: [FRONTEND_V2_STEP_BY_STEP_GUIDE.md](FRONTEND_V2_STEP_BY_STEP_GUIDE.md)

---

## Current Implementation Status

### ✅ Fully Implemented Pages

| Page | API Integration | Features | Status |
|------|---|---|---|
| Login | `authAPI.login` | Email/password auth, role-based redirect | ✅ Complete |
| Register | `authAPI.register` | User registration, profile image | ✅ Complete |
| Tasks | `taskAPI.*` | List, create, update, delete tasks | ✅ Complete |
| Attendance | `attendanceAPI.*` | Check-in/out, history | ✅ Complete |
| Public Pages | - | Landing, About, Service, Pricing, Contact | ✅ Complete |

### ⏳ Partially Implemented Pages

| Page | Missing Features | Next Steps |
|------|---|---|
| UserDashboard | V2 social feed, personal tasks widget | Integrate `socialV2API.getFeed()`, `socialV2API.getPersonalTasks()` |
| TeamDashboard | V2 social features | Add social feed section using `socialV2API` |
| AdminDashboard | Post moderation, publish jobs | Add tabs for `/admin/moderation`, publish jobs monitoring |
| Profile | Social networking info | Show connections, integrations status |
| ChatPage | Team chat, social messages | Use `chatAPI.getTeamChats()`, `chatAPI.getSocialMessages()` |

### 🚀 In Progress Pages

| Page | Purpose | Core Features |
|------|---------|---|
| SocialHub | Multi-purpose V2 hub | Feed, posts, tasks, network, integrations, moderation |

---

## How to Add V2 Features to Existing Pages

### Example 1: Add Social Feed to User Dashboard

**File**: `src/pages/UserDashboard.tsx`

```typescript
// 1. Import V2 API
import { socialV2API } from '../api/socialV2API'

// 2. Add state for feed
const [feed, setFeed] = useState([])
const [feedLoading, setFeedLoading] = useState(false)

// 3. Load feed on mount
useEffect(() => {
  const loadFeed = async () => {
    try {
      setFeedLoading(true)
      const data = await socialV2API.getFeed()
      setFeed(data?.data || [])
    } catch (error) {
      console.error('Failed to load feed:', error)
    } finally {
      setFeedLoading(false)
    }
  }
  
  loadFeed()
}, [])

// 4. Render feed in component
return (
  <div>
    {/* Existing dashboard content */}
    
    {/* Add social feed section */}
    <section className="mt-6">
      <h2>Recent Updates</h2>
      {feedLoading && <div>Loading feed...</div>}
      {feed.map(post => (
        <div key={post._id} className="post-card">
          <p>{post.author.name}</p>
          <p>{post.content}</p>
          <span>{post.likes.length} likes</span>
        </div>
      ))}
    </section>
  </div>
)
```

### Example 2: Add Personal Tasks Widget to Dashboard

```typescript
// 1. Import
import { socialV2API } from '../api/socialV2API'

// 2. Add state
const [personalTasks, setPersonalTasks] = useState([])
const [tasksLoading, setTasksLoading] = useState(false)

// 3. Load tasks
useEffect(() => {
  const loadTasks = async () => {
    try {
      setTasksLoading(true)
      const data = await socialV2API.getPersonalTasks()
      setPersonalTasks(data?.data || [])
    } catch (error) {
      console.error('Failed to load tasks:', error)
    } finally {
      setTasksLoading(false)
    }
  }
  
  loadTasks()
}, [])

// 4. Add toggle complete handler
const handleToggleTask = async (taskId: string) => {
  try {
    await socialV2API.togglePersonalTask(taskId)
    setPersonalTasks(prev => prev.map(t => 
      t._id === taskId ? { ...t, status: t.status === 'completed' ? 'todo' : 'completed' } : t
    ))
  } catch (error) {
    console.error('Failed to toggle task:', error)
  }
}

// 5. Render widget
<div className="personal-tasks">
  <h3>My Todo Tasks</h3>
  {tasksLoading && <div>Loading...</div>}
  {personalTasks.map(task => (
    <div key={task._id} onClick={() => handleToggleTask(task._id)}>
      <input type="checkbox" checked={task.status === 'completed'} readOnly />
      <span>{task.title}</span>
      <span className="priority">{task.priority}</span>
    </div>
  ))}
</div>
```

### Example 3: Add Admin Post Moderation

```typescript
// src/pages/AdminDashboard.tsx - Add new tab

// 1. Add state
const [moderationPosts, setModerationPosts] = useState([])
const [modLoading, setModLoading] = useState(false)

// 2. Add function to load posts
const loadModerationPosts = async () => {
  try {
    setModLoading(true)
    const data = await socialV2API.getModerationPosts('all')
    setModerationPosts(data?.data || [])
  } catch (error) {
    console.error('Failed to load posts for moderation:', error)
  } finally {
    setModLoading(false)
  }
}

// 3. Load on mount
useEffect(() => {
  if (activeTab === 'moderation') {
    loadModerationPosts()
  }
}, [activeTab])

// 4. Handle moderation action
const handleModeratePost = async (postId: string, action: string, reason?: string) => {
  try {
    await socialV2API.moderatePost(postId, action, reason)
    setModerationPosts(prev => prev.filter(p => p._id !== postId))
  } catch (error) {
    console.error('Failed to moderate post:', error)
  }
}

// 5. Add to navigation tabs
<button onClick={() => setActiveTab('moderation')}>
  Moderation ({moderationPosts.length})
</button>

// 6. Add tab content
{activeTab === 'moderation' && (
  <div>
    <h3>Posts Needing Review</h3>
    {modLoading && <div>Loading...</div>}
    {moderationPosts.map(post => (
      <div key={post._id} className="post-review">
        <p>{post.author.name}: {post.content}</p>
        <div className="buttons">
          <button onClick={() => handleModeratePost(post._id, 'hide')}>Hide</button>
          <button onClick={() => handleModeratePost(post._id, 'flag')}>Flag</button>
          <button onClick={() => handleModeratePost(post._id, 'remove')}>Remove</button>
        </div>
      </div>
    ))}
  </div>
)}
```

---

## API Modules & Functions Quick Reference

### Authentication (`authAPI`)

```typescript
authAPI.login({ email, password })          // POST /auth/login
authAPI.register({ name, email, password }) // POST /auth/register
authAPI.getMe()                              // GET /auth/me
authAPI.updatePassword({ ...})               // PUT /auth/updatepassword
```

### Social/V2 (`socialV2API`)

**Posts:**
```typescript
socialV2API.getFeed()                        // GET /social/feed
socialV2API.getMyPosts()                     // GET /social/posts/me
socialV2API.createPost({ content, ... })    // POST /social/posts
socialV2API.likePost(postId)                 // POST /social/posts/:id/like
socialV2API.addComment(postId, text)         // POST /social/posts/:id/comments
```

**Personal Tasks:**
```typescript
socialV2API.getPersonalTasks()               // GET /social/personal-tasks
socialV2API.createPersonalTask({ ... })     // POST /social/personal-tasks
socialV2API.updatePersonalTask(id, data)    // PATCH /social/personal-tasks/:id
socialV2API.togglePersonalTask(id)           // PATCH /social/personal-tasks/:id/toggle-complete
socialV2API.deletePersonalTask(id)           // DELETE /social/personal-tasks/:id
```

**Connections:**
```typescript
socialV2API.discoverUsers(query)             // GET /social/users/discover?q=
socialV2API.getConnections()                 // GET /social/connections
socialV2API.requestConnection(userId)        // POST /social/connections/request
socialV2API.respondConnection(id, action)    // PATCH /social/connections/:id/respond
```

**Integrations:**
```typescript
socialV2API.getIntegrations()                // GET /social/integrations
socialV2API.linkProvider(provider, token)    // POST /social/integrations/:provider/link
socialV2API.getProviderProfile(provider)     // GET /social/integrations/:provider/profile
```

**Moderation:**
```typescript
socialV2API.getModerationPosts(status)       // GET /social/moderation/posts
socialV2API.moderatePost(id, action, reason) // PATCH /social/moderation/posts/:id
```

### Tasks (`taskAPI`)

```typescript
taskAPI.getTasks()                           // GET /tasks
taskAPI.createTask(data)                     // POST /tasks
taskAPI.getTask(id)                          // GET /tasks/:id
taskAPI.updateTask(id, data)                 // PUT /tasks/:id
taskAPI.deleteTask(id)                       // DELETE /tasks/:id
taskAPI.getPendingApprovalTasks()            // GET /tasks/pending-approval
taskAPI.approveCompletion(id)                // PATCH /tasks/:id/approve
taskAPI.rejectCompletion(id, reason)         // PATCH /tasks/:id/reject
```

### Chat (`chatAPI`)

```typescript
chatAPI.sendMessage({ receiverId, message })     // POST /chat/send
chatAPI.getMessages(userId)                      // GET /chat/messages/:userId
chatAPI.getChats()                               // GET /chat/chats
chatAPI.sendTeamMessage(teamId, message)         // POST /chat/teams/:teamId/send
chatAPI.getTeamMessages(teamId)                  // GET /chat/teams/:teamId/messages
```

### Teams (`teamAPI`)

```typescript
teamAPI.getTeams()                           // GET /teams
teamAPI.createTeam(data)                     // POST /teams
teamAPI.getTeam(id)                          // GET /teams/:id
teamAPI.updateTeam(id, data)                 // PUT /teams/:id
teamAPI.inviteMember(teamId, userId)         // POST /teams/:teamId/invite
teamAPI.acceptInvite(inviteId)               // PUT /teams/invites/:id/accept
teamAPI.declineInvite(inviteId)              // PUT /teams/invites/:id/decline
```

### Users (`userAPI`)

```typescript
userAPI.getUsers(filters)                    // GET /users
userAPI.getUser(id)                          // GET /users/:id
userAPI.updateUser(id, data)                 // PUT /users/:id
userAPI.deleteUser(id)                       // DELETE /users/:id
userAPI.toggleUserActive(id)                 // PUT /users/:id/toggle-active
userAPI.searchUsers(query)                   // GET /users/search?q=
```

### Attendance (`attendanceAPI`)

```typescript
attendanceAPI.getAttendance()                // GET /attendance
attendanceAPI.checkIn()                      // POST /attendance/checkin
attendanceAPI.checkOut()                     // POST /attendance/checkout
attendanceAPI.updateAttendance(id, data)     // PUT /attendance/:id
attendanceAPI.deleteAttendance(id)           // DELETE /attendance/:id
```

---

## Common Patterns & Code Snippets

### Pattern: Load Data on Mount

```typescript
useEffect(() => {
  const load = async () => {
    try {
      setLoading(true)
      const data = await API.getData()
      setData(data)
    } catch (error) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }
  load()
}, [])
```

### Pattern: Handle Form Submission

```typescript
const handleSubmit = async (e) => {
  e.preventDefault()
  try {
    setSubmitting(true)
    await API.create(formData)
    setFormData({}) // Reset
    setSuccess('Created successfully!')
  } catch (error) {
    setError(error.message)
  } finally {
    setSubmitting(false)
  }
}
```

### Pattern: Real-Time Update

```typescript
useEffect(() => {
  if (!socket) return
  
  socket.on('event_name', (data) => {
    setItems(prev => [data, ...prev])
  })
  
  return () => socket.off('event_name')
}, [socket])
```

### Pattern: Role-Based Rendering

```typescript
const { isAdmin, isTeamLeader } = useAuth()

return (
  <>
    {isAdmin && <AdminPanel />}
    {isTeamLeader && <LeaderTools />}
    {!isAdmin && !isTeamLeader && <UserView />}
  </>
)
```

---

## Debugging Tips

### Check if API is Called

```typescript
// Add console.log right before API call
console.log('Calling API with params:', params)
const result = await API.getData(params)
console.log('API result:', result)
```

### Check Authentication State

```typescript
const { user, isAuthenticated } = useAuth()
console.log('User:', user)
console.log('Is Authenticated:', isAuthenticated)
```

### Check Network Requests

1. Open DevTools → Network tab
2. Make the API call
3. Look for the request in Network tab
4. Check Status (200 = success, 401 = auth error, 404 = not found)
5. Click request → Response tab to see data

### Check Socket Connection

```typescript
const { socket } = useChat()
console.log('Socket connected:', socket?.connected)
console.log('Socket ID:', socket?.id)
```

---

## File Structure for Reference

```
Frontend/
├── src/
│   ├── api/
│   │   ├── axios.ts              # HTTP client config
│   │   ├── authAPI.ts            # Auth endpoints
│   │   ├── socialV2API.ts        # Social/V2 endpoints
│   │   ├── taskAPI.ts            # Task endpoints
│   │   ├── teamAPI.ts            # Team endpoints
│   │   ├── chatAPI.ts            # Chat endpoints
│   │   ├── userAPI.ts            # User endpoints
│   │   ├── attendanceAPI.ts      # Attendance endpoints
│   │   ├── contactAPI.ts         # Contact endpoints
│   │   └── teamAPI.ts            # Team management
│   ├── context/
│   │   ├── AuthContext.tsx       # Auth state
│   │   └── ChatContext.tsx       # Chat state
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   ├── Dashboard.tsx / DashboardRedirect.tsx
│   │   ├── UserDashboard.tsx
│   │   ├── AdminDashboard.tsx
│   │   ├── TeamDashboard.tsx
│   │   ├── Profile.tsx
│   │   ├── Tasks.tsx
│   │   ├── Attendance.tsx
│   │   ├── ChatPage.tsx
│   │   ├── SocialHub.tsx
│   │   └── [Public pages]
│   ├── components/
│   │   ├── Navbar.tsx
│   │   ├── Footer.tsx
│   │   ├── Chat.tsx
│   │   ├── Attendance.tsx
│   │   └── [More components]
│   ├── App.tsx                   # Main routing
│   └── main.tsx                  # Entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

---

## Environment Variables

Create `.env` in `Frontend/` directory:

```env
# Required: Backend API base URL
VITE_API_URL=http://localhost:5000/api/v2

# Optional: Socket.IO server URL (defaults to backend)
VITE_SOCKET_URL=http://localhost:5000

# Optional: Feature flags
VITE_ENABLE_SOCIAL=true
VITE_ENABLE_INTEGRATIONS=true
```

---

## Quick Start Checklist

- [ ] Installed dependencies (`npm install`)
- [ ] Created `.env` file with `VITE_API_URL`
- [ ] Backend is running on correct port
- [ ] Started dev server (`npm run dev`)
- [ ] Can log in with test account
- [ ] Can see dashboard after login
- [ ] Network requests are working (open DevTools → Network tab)

---

## Need Help?

1. **Check the guides:**
   - [FRONTEND_V2_COMPREHENSIVE_GUIDE.md](FRONTEND_V2_COMPREHENSIVE_GUIDE.md) - Detailed architecture
   - [FRONTEND_V2_IMPLEMENTATION_GUIDE.md](FRONTEND_V2_IMPLEMENTATION_GUIDE.md) - How to implement features
   - [FRONTEND_V2_STEP_BY_STEP_GUIDE.md](FRONTEND_V2_STEP_BY_STEP_GUIDE.md) - Page-by-page walkthrough

2. **Check if backend API exists:**
   - Look at [Backend/FRONTEND_V2_PAGES_API.md](Backend/FRONTEND_V2_PAGES_API.md)
   - Test with Postman/Bruno
   - Verify endpoint returns correct data

3. **Debug common issues:**
   - Verify authentication token is stored
   - Check DevTools Network tab for API errors
   - Ensure `VITE_API_URL` is set correctly
   - Verify backend CORS allows frontend URL

4. **Ask for help:**
   - Check error messages in console
   - Look at similar existing implementations
   - Check backend logs for API errors

---

**Last Updated**: March 2024
**Version**: Frontend V2
**Backend API**: `/api/v2`

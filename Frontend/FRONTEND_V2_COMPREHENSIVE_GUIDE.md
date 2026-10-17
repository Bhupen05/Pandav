# Pandav Frontend V2 - Comprehensive Step-by-Step Guide

A complete guide to understanding, developing, and maintaining the Pandav Frontend with V2 Backend Integration.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Setup & Environment](#setup--environment)
5. [Core Concepts](#core-concepts)
6. [Page-by-Page Implementation Guide](#page-by-page-implementation-guide)
7. [API Integration Patterns](#api-integration-patterns)
8. [Authentication Flow](#authentication-flow)
9. [State Management](#state-management)
10. [Development Workflow](#development-workflow)
11. [Common Tasks & How-To](#common-tasks--how-to)
12. [Troubleshooting](#troubleshooting)

---

## Introduction

### What is Pandav?

Pandav is a comprehensive employee management platform featuring:
- **Core Features**: Authentication, Task Management, Attendance Tracking, Team Operations
- **Social Layer**: Internal Social Feed, Professional Networking, Direct Messaging
- **Integration Layer**: LinkedIn & GitHub Integration for publishing work updates
- **Admin Layer**: User Management, Moderation, Audit Logs

### Frontend Role

The frontend (React + TypeScript + Vite) provides the user interface and communicates with the backend through REST APIs at `/api/v2`.

**Key Technologies:**
- React 18+ (with TypeScript)
- Vite (build tool)
- TanStack Router or React Router (routing)
- Context API (state management)
- Axios (HTTP client)
- Socket.IO (real-time updates)

---

## Architecture Overview

### High-Level System Flow

```
User Browser (Frontend)
    ↓
Router (App.tsx)
    ↓
Pages/Components (React)
    ↓
API Layer (socialV2API, userAPI, etc.)
    ↓
Axios HTTP Client
    ↓
Backend REST APIs (/api/v2/*)
    ↓
Express Server + MongoDB
```

### Key Layers

1. **Presentation Layer** (`src/pages/`, `src/components/`)
   - User interface and interactions
   - Form handling and user input

2. **API Layer** (`src/api/`)
   - Centralized API client functions
   - Typed request/response contracts
   - Error handling at HTTP level

3. **State Layer** (`src/context/`)
   - Authentication state (AuthContext)
   - Chat/real-time state (ChatContext)
   - Global app state management

4. **HTTP Client** (`src/api/axios.ts`)
   - Configured Axios instance
   - Request/response interceptors
   - Base URL and headers management

---

## Project Structure

```
Frontend/
├── public/                    # Static assets
│   ├── manifest.json         # PWA manifest
│   └── _redirects            # Vercel routing rules
├── src/
│   ├── api/                  # API client functions
│   │   ├── axios.ts          # Axios configuration
│   │   ├── socialV2API.ts    # Social & V2 endpoints
│   │   ├── authAPI.ts        # Authentication
│   │   ├── taskAPI.ts        # Task management
│   │   ├── attendanceAPI.ts  # Attendance tracking
│   │   ├── teamAPI.ts        # Team operations
│   │   ├── userAPI.ts        # User management
│   │   ├── contactAPI.ts     # Contact/feedback
│   │   └── chatAPI.ts        # Chat messaging
│   ├── components/           # Reusable components
│   │   ├── Navbar.tsx        # Navigation bar
│   │   ├── Footer.tsx        # Footer component
│   │   ├── Attendance.tsx    # Attendance component
│   │   ├── Chat.tsx          # Chat component
│   │   ├── Contactus.tsx     # Contact form
│   │   ├── Taskscard.tsx     # Task card component
│   │   └── Tasksadd.tsx      # Add task component
│   ├── context/              # React Context providers
│   │   ├── AuthContext.tsx   # Authentication state
│   │   └── ChatContext.tsx   # Real-time chat state
│   ├── pages/                # Page components
│   │   ├── Login.tsx         # Login page
│   │   ├── Register.tsx      # Registration page
│   │   ├── DashboardRedirect.tsx  # Dashboard router
│   │   ├── UserDashboard.tsx      # User dashboard
│   │   ├── TeamDashboard.tsx      # Team leader dashboard
│   │   ├── TeamMemberDashboard.tsx # Team member dashboard
│   │   ├── AdminDashboard.tsx     # Admin dashboard
│   │   ├── Profile.tsx            # User profile
│   │   ├── Tasks.tsx              # Task management
│   │   ├── Attendance.tsx         # Attendance tracking
│   │   ├── SocialHub.tsx          # V2 social features
│   │   ├── ChatPage.tsx           # Chat page
│   │   ├── TeamManagement.tsx     # Team management
│   │   ├── Landing.tsx            # Landing page
│   │   ├── About.tsx              # About page
│   │   ├── Service.tsx            # Services page
│   │   └── Pricing.tsx            # Pricing page
│   ├── utils/                # Utility functions
│   ├── App.tsx              # Main app component & routing
│   ├── App.css              # Global styles
│   ├── index.css            # Global styles
│   └── main.tsx             # React DOM mount point
├── index.html               # HTML entry point
├── package.json            # Dependencies & scripts
├── tsconfig.json           # TypeScript config
├── vite.config.ts          # Vite configuration
└── vercel.json             # Vercel deployment config
```

---

## Setup & Environment

### Prerequisites

- Node.js 16+ 
- npm or yarn
- Git

### Installation

```bash
# 1. Navigate to Frontend directory
cd Frontend

# 2. Install dependencies
npm install

# 3. Create .env file
cp .env.example .env

# 4. Configure environment variables
# VITE_API_URL=http://localhost:5000/api/v2  # Backend API
```

### Environment Variables

Create `.env` in the `Frontend/` directory:

```env
# Backend API base URL (defaults to /api/v2 if not set)
VITE_API_URL=http://localhost:5000/api/v2

# Optional: Socket.IO configuration
VITE_SOCKET_URL=http://localhost:5000

# Optional: Feature flags
VITE_ENABLE_V2_SOCIAL=true
```

### Running the Frontend

```bash
# Development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint code
npm run lint
```

The app will be available at `http://localhost:5173` (or another port if 5173 is busy).

---

## Core Concepts

### 1. Authentication Flow

**User Authentication Context** (`AuthContext.tsx`)
- Stores user data and authentication token
- Provides login, register, logout functions
- Exposes role-based helpers (`isAdmin`, `isTeamLeader`, etc.)

**Key Methods:**
```typescript
const { 
  user,                    // Current user object
  isAuthenticated,         // Boolean
  isAdmin,                 // Check if admin role
  isTeamLeader,           // Check if team leader
  isTeamMember,           // Check if team member
  login,                  // Login function
  register,               // Register function
  logout                  // Logout function
} = useAuth();
```

### 2. API Client Pattern

All API calls go through typed wrapper functions in `src/api/*.ts`:

```typescript
// Example from socialV2API.ts
export const socialV2API = {
  getFeed: async () => (await api.get('/social/feed')).data,
  createPost: async (payload: PostPayload) => 
    (await api.post('/social/posts', payload)).data,
  // ... more methods
}
```

**Usage in Components:**
```typescript
import { socialV2API } from '../api/socialV2API'

const MyComponent = () => {
  const [posts, setPosts] = useState([])
  
  useEffect(() => {
    socialV2API.getFeed()
      .then(setPosts)
      .catch(console.error)
  }, [])
  
  return <div>{/* render posts */}</div>
}
```

### 3. Role-Based Access Control

**Available Roles:**
- `admin` - System administrator
- `team_leader` - Team leadership
- `team_member` - Team member
- `user` - Regular user

**Usage:**
```typescript
const { isAdmin, isTeamLeader } = useAuth()

return (
  <>
    {isTeamLeader && <TeamControls />}
    {isAdmin && <AdminPanel />}
  </>
)
```

### 4. Error Handling

Axios interceptor returns 401 responses to login page. Component-level error handling:

```typescript
try {
  const result = await socialV2API.createPost({ content: '...' })
} catch (error) {
  // Handle API error
  console.error('Failed to create post:', error)
}
```

---

## Page-by-Page Implementation Guide

### 1. Login Page (`src/pages/Login.tsx`)

**Purpose:** Authenticate user and redirect to appropriate dashboard.

**Backend API:**
- `POST /api/v2/auth/login`

**Implementation Steps:**

1. Create login form with email and password fields
2. Call `authAPI.login(email, password)`
3. On success:
   - Store token in localStorage/sessionStorage
   - Store user data in context
   - Redirect to dashboard based on role
4. Handle and display errors

**Role-Based Redirect Logic:**
```typescript
const getDashboardRouteForRole = (role: string) => {
  switch(role) {
    case 'admin': return '/admin'
    case 'team_leader': return '/team'
    case 'team_member': return '/team-member'
    default: return '/user'
  }
}
```

**Current Status:** ✅ Implemented - `/src/pages/Login.tsx`

---

### 2. Register Page (`src/pages/Register.tsx`)

**Purpose:** Create new user account.

**Backend API:**
- `POST /api/v2/auth/register`

**Key Points:**
- Self-registration sets role to `user`
- Optional profile image (base64 encoded)
- Email validation
- Password requirements

**Current Status:** ✅ Implemented - `/src/pages/Register.tsx`

---

### 3. Dashboard (Role-Based Redirect) - `/dashboard`

**Purpose:** Single entry point that routes to role-specific dashboard.

**File:** `src/pages/DashboardRedirect.tsx`

**Logic:**
1. Check authentication status
2. Redirect to `/login` if not authenticated
3. Get user role from context
4. Redirect to appropriate dashboard:
   - Admin → `/admin`
   - Team Leader → `/team`
   - Team Member → `/team-member`
   - User → `/user`

**Current Status:** ✅ Implemented

---

### 4. User Dashboard (`src/pages/UserDashboard.tsx`)

**Purpose:** Display user's personal tasks, assigned tasks, and attendance summary.

**Backend APIs:**
- `GET /api/v2/tasks` - Assigned tasks
- `GET /api/v2/attendance` - Attendance records
- `GET /api/v2/social/personal-tasks` - Personal todos

**Features to Implement:**
- ✅ Task list with status
- ✅ Attendance summary (check-in/check-out)
- ⏳ Personal tasks widget
- ⏳ Recent activity feed
- ⏳ Quick action buttons

**Current Status:** ⏳ Partial - Needs V2 social integration

---

### 5. Team Dashboard (`src/pages/TeamDashboard.tsx`)

**Purpose:** Team leader overview of team operations.

**Backend APIs:**
- `GET /api/v2/teams/:teamId` - Team info
- `GET /api/v2/tasks` - Team tasks
- `GET /api/v2/attendance` - Team attendance
- `POST /api/v2/teams/:teamId/invite` - Invite members

**Features:**
- Team member list
- Pending approvals (tasks, attendance)
- Team tasks view
- Team attendance overview

**Current Status:** ⏳ Partial - Needs V2 integration

---

### 6. Team Member Dashboard (`src/pages/TeamMemberDashboard.tsx`)

**Purpose:** Team member view of assigned work.

**Similar to User Dashboard with team context.**

**Current Status:** ⏳ Partial

---

### 7. Admin Dashboard (`src/pages/AdminDashboard.tsx`)

**Purpose:** System-wide administration and monitoring.

**Backend APIs:**
- `GET /api/v2/users` - All users
- `GET /api/v2/teams` - All teams
- `GET /api/v2/tasks` - All tasks
- `GET /api/v2/social/moderation/posts` - Flagged posts
- `GET /api/v2/social/publish-jobs` - Publishing jobs

**Features:**
- User management (list, deactivate)
- System statistics (users, teams, tasks)
- Pending approvals
- Post moderation queue
- Publish job monitoring

**Current Status:** ⏳ Partial - Needs V2 social integration

---

### 8. Profile Page (`src/pages/Profile.tsx`)

**Purpose:** Edit user profile and account settings.

**Backend APIs:**
- `GET /api/v2/auth/me` - Get current user
- `PUT /api/v2/users/:id` - Update profile
- `PUT /api/v2/auth/updatepassword` - Change password

**Features:**
- Display user info
- Edit profile fields
- Change password
- Update profile picture

**Current Status:** ⏳ Partial

---

### 9. Tasks Page (`src/pages/Tasks.tsx`)

**Purpose:** View and manage assigned tasks.

**Backend APIs:**
- `GET /api/v2/tasks` - List tasks
- `POST /api/v2/tasks` - Create task (admin/leader)
- `PUT /api/v2/tasks/:id` - Update task
- `DELETE /api/v2/tasks/:id` - Delete task (admin)
- `POST /api/v2/tasks/:id/request-approval` - Request completion approval

**Features:**
- Task list with filters
- Task status updates
- Priority and due date
- Completion requests
- Task details view

**Current Status:** ✅ Implemented

---

### 10. Attendance Page (`src/pages/Attendance.tsx` / `src/components/Attendance.tsx`)

**Purpose:** Check-in/check-out and attendance records.

**Backend APIs:**
- `POST /api/v2/attendance/checkin` - Check-in
- `POST /api/v2/attendance/checkout` - Check-out
- `GET /api/v2/attendance` - Attendance history

**Features:**
- Check-in/check-out buttons
- Current status display
- Attendance history
- Work hours calculation

**Current Status:** ✅ Implemented

---

### 11. Team Management Page (`src/pages/TeamManagement.tsx`)

**Purpose:** Create and manage teams (admin/leader).

**Backend APIs:**
- `GET /api/v2/teams` - List teams
- `POST /api/v2/teams` - Create team
- `PUT /api/v2/teams/:id` - Update team
- `POST /api/v2/teams/:teamId/invite` - Invite member
- `POST /api/v2/teams/invites/:inviteId/accept` - Accept invite
- `POST /api/v2/teams/invites/:inviteId/decline` - Decline invite

**Features:**
- Team list
- Create new team
- Invite members
- Manage invitations
- Team settings

**Current Status:** ⏳ Partial - Needs V2 endpoints

---

### 12. Chat Page (`src/pages/ChatPage.tsx`)

**Purpose:** Real-time messaging (direct & team chat).

**Backend APIs:**
- `GET /api/v2/chat/chats` - Get chat list
- `POST /api/v2/chat/send` - Send direct message
- `GET /api/v2/chat/messages/:userId` - Get messages with user
- `POST /api/v2/chat/teams/:teamId/send` - Send team message
- `GET /api/v2/chat/teams/:teamId/messages` - Get team messages

**Real-time Events (Socket.IO):**
- `receive_message` - New direct message
- `receive_team_message` - New team message
- `active_users` - List of online users

**Features:**
- Chat list
- Message history
- Real-time messaging
- User online status
- Team chat

**Current Status:** ⏳ Partial

---

### 13. Social Hub (`src/pages/SocialHub.tsx`)

**Purpose:** V2 social features (posts, feed, networking, integrations).

**This is a multipurpose page that handles:**
- `/social` - Social feed
- `/todo` - Personal tasks  
- `/network` - Connections
- `/integrations` - LinkedIn/GitHub
- `/publish-jobs` - Publishing jobs
- `/admin/moderation` - Post moderation

**Backend APIs:**
- Social Feed: `GET /api/v2/social/feed`, `POST /api/v2/social/posts`
- Personal Tasks: `GET /api/v2/social/personal-tasks`, `PATCH /api/v2/social/personal-tasks/:id`
- Connections: `GET /api/v2/social/connections`, `POST /api/v2/social/connections/request`
- Integrations: `GET /api/v2/social/integrations`, `POST /api/v2/social/integrations/:provider/link`
- Publishing: `GET /api/v2/social/publish-jobs`, `POST /api/v2/social/publish-jobs/:jobId/process`
- Moderation: `GET /api/v2/social/moderation/posts`, `PATCH /api/v2/social/moderation/posts/:id`

**Features:**
- Social feed view
- Create/edit posts
- Like and comment on posts
- Personal task management
- Connection requests
- User discovery
- Integration management
- Publish job monitoring
- Post moderation

**Current Status:** ⏳ In Progress - Core structure exists, needs feature completion

---

### 14. Public Pages

- **Landing (`/`)** - Homepage
- **About (`/about`)** - Company info
- **Service (`/service`)** - Services overview
- **Pricing (`/pricing`)** - Pricing information
- **Contact (`/contact`)** - Contact form

**Current Status:** ✅ Implemented

---

## API Integration Patterns

### Pattern 1: Fetch on Component Mount

```typescript
import { useEffect, useState } from 'react'
import { userAPI } from '../api/userAPI'

export const UserList = () => {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoading(true)
        const data = await userAPI.getUsers()
        setUsers(data)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchUsers()
  }, [])

  if (loading) return <div>Loading...</div>
  if (error) return <div>Error: {error}</div>
  
  return <div>{users.map(u => <div key={u.id}>{u.name}</div>)}</div>
}
```

### Pattern 2: Form Submission

```typescript
import { useState } from 'react'
import { socialV2API } from '../api/socialV2API'

export const CreatePostForm = () => {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      setLoading(true)
      await socialV2API.createPost({ content })
      setContent('')
      // Refresh posts or show success message
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea 
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Share an update..."
      />
      {error && <div className="error">{error}</div>}
      <button type="submit" disabled={loading}>
        {loading ? 'Posting...' : 'Post'}
      </button>
    </form>
  )
}
```

### Pattern 3: Real-Time Updates with Socket.IO

```typescript
import { useEffect } from 'react'
import { useChat } from '../context/ChatContext'

export const ChatMessages = ({ userId }) => {
  const { socket, messages } = useChat()

  useEffect(() => {
    if (!socket) return

    const handleNewMessage = (message) => {
      // Update messages in context
      console.log('New message:', message)
    }

    socket.on('receive_message', handleNewMessage)

    return () => {
      socket.off('receive_message', handleNewMessage)
    }
  }, [socket])

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>{msg.text}</div>
      ))}
    </div>
  )
}
```

---

## Authentication Flow

### Login Sequence

```
1. User enters email/password on Login page
   ↓
2. Login component calls: authAPI.login(email, password)
   ↓
3. Axios sends: POST /api/v2/auth/login
   ↓
4. Backend returns: { token, user }
   ↓
5. Login component stores: 
   - token in localStorage
   - user in AuthContext
   ↓
6. Axios interceptor adds token to all future requests:
   - Authorization: Bearer <token>
   ↓
7. Navigation redirects based on user.role:
   - admin → /admin
   - team_leader → /team
   - team_member → /team-member
   - user → /user
   ↓
8. Navbar updates to show authenticated state
```

### Token Management

**Storage:**
```typescript
// In AuthContext.tsx
localStorage.setItem('token', token)
localStorage.setItem('user', JSON.stringify(user))
```

**Retrieval on App Load:**
```typescript
useEffect(() => {
  const token = localStorage.getItem('token')
  const user = localStorage.getItem('user')
  
  if (token && user) {
    // Restore authentication state
    setToken(token)
    setUser(JSON.parse(user))
  }
}, [])
```

**Axios Interceptor:**
```typescript
// In axios.ts
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
```

**Logout:**
```typescript
const logout = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  setToken(null)
  setUser(null)
  navigate('/login')
}
```

---

## State Management

### 1. Authentication Context (`src/context/AuthContext.tsx`)

Manages:
- Current user data
- Authentication token
- Role information
- Login/logout/register functions

**Usage:**
```typescript
const { user, isAuthenticated, login, logout } = useAuth()
```

### 2. Chat Context (`src/context/ChatContext.tsx`)

Manages:
- WebSocket connection (Socket.IO)
- Chat messages
- Online users list
- Real-time events

**Usage:**
```typescript
const { socket, messages, onlineUsers } = useChat()
```

### 3. Local Component State

For component-specific data:
```typescript
const [posts, setPosts] = useState([])
const [selectedPost, setSelectedPost] = useState(null)
```

---

## Development Workflow

### Adding a New Page

1. **Create page component:**
   ```bash
   # Create src/pages/NewPage.tsx
   ```

2. **Implement page logic:**
   - Import necessary hooks and APIs
   - Get authentication context if needed
   - Fetch data on mount
   - Handle user interactions

3. **Add route in App.tsx:**
   ```typescript
   <Route path="/newpage" element={<NewPage />} />
   ```

4. **Add navigation link:**
   - Update Navbar.tsx or relevant menu

5. **Test:**
   - Run `npm run dev`
   - Test with different user roles
   - Test error scenarios

### Adding a New API Endpoint

1. **Create/update API file:**
   ```typescript
   // src/api/newmodulesAPI.ts
   import api from './axios'
   
   export const newAPI = {
     getData: async () => (await api.get('/endpoint')).data,
     postData: async (payload) => (await api.post('/endpoint', payload)).data,
   }
   ```

2. **Use in component:**
   ```typescript
   import { newAPI } from '../api/newmodulesAPI'
   
   const result = await newAPI.getData()
   ```

3. **Handle errors:**
   ```typescript
   try {
     const data = await newAPI.getData()
   } catch (error) {
     console.error('API error:', error)
   }
   ```

### Testing API Integration

Use tools like Postman or Bruno to test backend endpoints before integrating into frontend.

---

## Common Tasks & How-To

### Task 1: Display a List of Items

```typescript
const [items, setItems] = useState([])
const [loading, setLoading] = useState(true)

useEffect(() => {
  const loadItems = async () => {
    try {
      const data = await API.getItems()
      setItems(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }
  loadItems()
}, [])

return (
  <div>
    {loading && <p>Loading...</p>}
    {items.length === 0 && !loading && <p>No items found</p>}
    {items.map(item => (
      <div key={item.id}>{item.name}</div>
    ))}
  </div>
)
```

### Task 2: Handle Form Submission

```typescript
const [formData, setFormData] = useState({ title: '', content: '' })
const [error, setError] = useState(null)
const [saving, setSaving] = useState(false)

const handleSubmit = async (e) => {
  e.preventDefault()
  setSaving(true)
  setError(null)
  
  try {
    await API.create(formData)
    setFormData({ title: '', content: '' })
    // Redirect or refresh list
  } catch (err) {
    setError(err.message)
  } finally {
    setSaving(false)
  }
}

return (
  <form onSubmit={handleSubmit}>
    <input 
      value={formData.title}
      onChange={(e) => setFormData({...formData, title: e.target.value})}
    />
    {error && <div className="error">{error}</div>}
    <button disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
  </form>
)
```

### Task 3: Protect Routes Based on Role

```typescript
// In a page component
const { isAdmin, isTeamLeader } = useAuth()

if (!isAdmin) {
  return <div>Access denied. Admin only.</div>
}

return <AdminPanel />
```

Or create a ProtectedRoute component:

```typescript
const ProtectedRoute = ({ element, requiredRole }) => {
  const { user } = useAuth()
  
  if (!user || user.role !== requiredRole) {
    return <Navigate to="/login" />
  }
  
  return element
}

// Usage in App.tsx
<Route 
  path="/admin" 
  element={<ProtectedRoute element={<AdminDashboard />} requiredRole="admin" />}
/>
```

### Task 4: Add Real-Time Updates

```typescript
import { useEffect } from 'react'
import { useChat } from '../context/ChatContext'

const RealtimeComponent = () => {
  const { socket } = useChat()

  useEffect(() => {
    if (!socket) return

    socket.on('event_name', (data) => {
      console.log('Event received:', data)
      // Update state
    })

    return () => {
      socket.off('event_name')
    }
  }, [socket])

  return <div>Real-time updates enabled</div>
}
```

---

## Troubleshooting

### Issue 1: "Cannot GET /api/v2/endpoint" 

**Cause:** Backend not running or endpoint doesn't exist.

**Solution:**
1. Check backend is running on correct port
2. Verify `VITE_API_URL` is set correctly
3. Check endpoint exists in backend documentation

### Issue 2: 401 Authorization Error

**Cause:** Token missing or expired.

**Solution:**
1. Check localStorage has token: Open DevTools → Application → Local Storage
2. Log in again to get fresh token
3. Verify token format in axios interceptor

### Issue 3: CORS Error

**Cause:** Backend CORS not configured for frontend URL.

**Solution:**
1. Verify backend has `CORS()` enabled
2. Add frontend URL to CORS whitelist in backend
3. In dev, ensure `http://localhost:3000` is whitelisted

### Issue 4: Form Data Not Sending

**Cause:** Content-Type header or payload format issue.

**Solution:**
1. Check axios is sending `Content-Type: application/json`
2. Verify payload matches backend schema
3. Test with Postman first

### Issue 5: Real-Time Messages Not Arriving

**Cause:** Socket.IO connection issue.

**Solution:**
1. Check socket is connected: `console.log(socket.connected)`
2. Verify Socket.IO URL matches backend
3. Check event names match (case-sensitive)
4. Look for errors in browser console

---

## API Reference Summary

### Authentication Module
```
POST   /api/v2/auth/register     - Create account
POST   /api/v2/auth/login        - Login
GET    /api/v2/auth/me           - Get current user
PUT    /api/v2/auth/updatepassword - Change password
```

### User Management
```
GET    /api/v2/users             - List all users (admin)
GET    /api/v2/users/:id         - Get user
PUT    /api/v2/users/:id         - Update user
DELETE /api/v2/users/:id         - Delete user (admin)
PUT    /api/v2/users/:id/toggle-active - Activate/deactivate
```

### Tasks
```
GET    /api/v2/tasks             - List tasks
POST   /api/v2/tasks             - Create task (admin/leader)
GET    /api/v2/tasks/:id         - Get task
PUT    /api/v2/tasks/:id         - Update task
DELETE /api/v2/tasks/:id         - Delete task (admin)
```

### Attendance
```
GET    /api/v2/attendance        - List records
POST   /api/v2/attendance        - Create record
POST   /api/v2/attendance/checkin - Check-in
POST   /api/v2/attendance/checkout - Check-out
PUT    /api/v2/attendance/:id    - Update record
```

### Teams
```
GET    /api/v2/teams             - List teams
POST   /api/v2/teams             - Create team
GET    /api/v2/teams/:id         - Get team
PUT    /api/v2/teams/:id         - Update team
POST   /api/v2/teams/:teamId/invite - Invite member
POST   /api/v2/teams/invites/:inviteId/accept - Accept invite
POST   /api/v2/teams/invites/:inviteId/decline - Decline invite
```

### Chat
```
GET    /api/v2/chat/chats        - Get conversations
GET    /api/v2/chat/messages/:userId - Get messages with user
POST   /api/v2/chat/send         - Send message
GET    /api/v2/chat/teams/:teamId/messages - Get team messages
POST   /api/v2/chat/teams/:teamId/send - Send to team
```

### Social (V2)
```
GET    /api/v2/social/feed       - Get feed
GET    /api/v2/social/posts/me   - My posts
POST   /api/v2/social/posts      - Create post
POST   /api/v2/social/posts/:postId/like - Like post
POST   /api/v2/social/posts/:postId/comments - Comment
POST   /api/v2/social/posts/:postId/publish - Publish to external
PATCH  /api/v2/social/posts/:postId/approve - Admin approve

GET    /api/v2/social/personal-tasks - Get todos
POST   /api/v2/social/personal-tasks - Create todo
PATCH  /api/v2/social/personal-tasks/:taskId - Update todo
PATCH  /api/v2/social/personal-tasks/:taskId/toggle-complete - Complete
DELETE /api/v2/social/personal-tasks/:taskId - Delete todo

GET    /api/v2/social/users/discover - Find users
GET    /api/v2/social/connections - Get connections
POST   /api/v2/social/connections/request - Request connection
PATCH  /api/v2/social/connections/:connectionId/respond - Respond

GET    /api/v2/social/integrations - List integrations
POST   /api/v2/social/integrations/:provider/link - Link account
GET    /api/v2/social/integrations/:provider/profile - Get profile
GET    /api/v2/social/integrations/:provider/posts - Get posts

GET    /api/v2/social/publish-jobs - Get jobs
POST   /api/v2/social/publish-jobs/:jobId/process - Process job
POST   /api/v2/social/publish-jobs/:jobId/retry - Retry job

GET    /api/v2/social/moderation/posts - Get posts (moderation)
PATCH  /api/v2/social/moderation/posts/:postId - Moderate post
```

---

## Best Practices

1. **Always check authentication before protected endpoints**
   ```typescript
   const { isAuthenticated } = useAuth()
   if (!isAuthenticated) return <Navigate to="/login" />
   ```

2. **Handle errors gracefully**
   ```typescript
   try { ... } catch (error) {
     setError(error.message || 'An error occurred')
   }
   ```

3. **Show loading states**
   ```typescript
   {loading && <Spinner />}
   {!loading && data && <Content data={data} />}
   {!loading && !data && error && <ErrorMessage error={error} />}
   ```

4. **Cleanup subscriptions**
   ```typescript
   useEffect(() => {
     const unsubscribe = socket.on('event', handler)
     return () => unsubscribe()
   }, [])
   ```

5. **Use TypeScript for API responses**
   ```typescript
   interface Post {
     id: string
     title: string
     content: string
   }
   
   const posts: Post[] = await socialV2API.getFeed()
   ```

---

## Next Steps for Development

1. **Complete Social Features**
   - Full feed implementation
   - Post creation/editing UI
   - Networking/connections UI

2. **Enhance Dashboards**
   - Add V2 social widgets
   - Real-time notifications
   - Advanced filtering

3. **Improve Real-Time**
   - Typing indicators
   - Online status persistence
   - Message read receipts

4. **Integration Features**
   - OAuth flow implementation
   - Account linking UI
   - Publishing workflow UI

5. **Admin Features**
   - Post moderation interface
   - User management dashboard
   - Audit log viewer

6. **Performance**
   - Implement pagination
   - Add caching strategy
   - Optimize re-renders

---

**Last Updated:** March 2024
**Frontend Version:** V2
**Backend API:** `/api/v2`

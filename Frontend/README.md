# Pandav Frontend - V2

Frontend application for the Pandav workforce platform. This app provides role-based dashboards, task workflows, attendance management, team collaboration, social networking, chat, and public marketing pages.

**API Base**: `/api/v2` (configurable via `VITE_API_URL` environment variable)

## 📚 Documentation

> **Start here**: Read one of these guides depending on your needs:

1. **[FRONTEND_V2_COMPREHENSIVE_GUIDE.md](FRONTEND_V2_COMPREHENSIVE_GUIDE.md)** ⭐
   - Complete architecture overview
   - Project structure explanation
   - Setup & environment configuration
   - Authentication flow
   - State management patterns
   - Page-by-page implementation guide
   - Best practices and troubleshooting

2. **[FRONTEND_V2_QUICK_REFERENCE.md](FRONTEND_V2_QUICK_REFERENCE.md)** ⚡ 
   - Quick overview of current implementation status
   - API modules quick reference
   - Code snippets for common patterns
   - Debugging tips
   - File structure reference

3. **[FRONTEND_V2_IMPLEMENTATION_GUIDE.md](FRONTEND_V2_IMPLEMENTATION_GUIDE.md)** 🛠️
   - Step-by-step feature development
   - How to add new API endpoints
   - How to add new pages
   - Common features implementation (lists, forms, filters, real-time)
   - Error handling patterns
   - Testing checklist

4. **[FRONTEND_V2_STEP_BY_STEP_GUIDE.md](FRONTEND_V2_STEP_BY_STEP_GUIDE.md)** 📖
   - Detailed page-by-page walkthrough
   - Backend API integration for each page
   - Current implementation status per page

## Tech Stack

- **React 19** + TypeScript
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **React Router** - Client-side routing
- **Axios** - HTTP client
- **Socket.IO** - Real-time updates

## Quick Start

### Prerequisites
- Node.js 16+
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Configure environment variables:
```env
VITE_API_URL=http://localhost:5000/api/v2
VITE_SOCKET_URL=http://localhost:5000
```

### Running the Application

```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Lint code
npm run lint
```

The application will be available at `http://localhost:5173`

## Project Structure

```
Frontend/
├── public/                    # Static files
├── src/
│   ├── api/                  # API client functions (organized by module)
│   │   ├── axios.ts          # Axios configuration & interceptors
│   │   ├── authAPI.ts        # Authentication endpoints
│   │   ├── socialV2API.ts    # Social/V2 endpoints (posts, tasks, connections, etc)
│   │   ├── taskAPI.ts        # Task management
│   │   ├── teamAPI.ts        # Team operations
│   │   ├── chatAPI.ts        # Chat & messaging
│   │   ├── userAPI.ts        # User management
│   │   ├── attendanceAPI.ts  # Attendance tracking
│   │   └── contactAPI.ts     # Contact form
│   ├── components/           # Reusable components
│   │   ├── Navbar.tsx        # Navigation bar
│   │   ├── Footer.tsx        # Footer
│   │   ├── Chat.tsx          # Chat component
│   │   ├── Attendance.tsx    # Attendance check-in/out
│   │   └── ...
│   ├── context/              # Global state providers
│   │   ├── AuthContext.tsx   # Authentication state & user info
│   │   └── ChatContext.tsx   # Chat & real-time state
│   ├── pages/                # Page components (route destinations)
│   │   ├── Login.tsx         # Login page
│   │   ├── Register.tsx      # Registration
│   │   ├── UserDashboard.tsx # User dashboard
│   │   ├── AdminDashboard.tsx # Admin dashboard
│   │   ├── SocialHub.tsx     # V2 social features hub
│   │   └── ...
│   ├── App.tsx               # Main router and navigation
│   ├── App.css               # Global styles
│   └── main.tsx              # React DOM entry point
├── index.html                # HTML entry point
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
└── vite.config.ts            # Vite config
```

## Route And Page Map

All routes are defined in src/App.tsx.

### Public Pages

- / -> Landing page
  - File: src/pages/Landing.tsx
  - Work: Product showcase with hero, feature sections, personas, CTA, and shared footer.

- /about -> About page
  - File: src/pages/About.tsx
  - Work: Company overview, mission/vision, values, and offering summary.

- /service -> Services page
  - File: src/pages/Service.tsx
  - Work: Service catalog for tasking, attendance, user management, and admin support.

- /pricing -> Pricing page
  - File: src/pages/Pricing.tsx
  - Work: Plan comparison, FAQ, and conversion CTAs.

- /login -> Login page
  - File: src/pages/Login.tsx
  - Work: User authentication, remember-me flow, and role-based redirect after sign-in.

- /register -> Registration page
  - File: src/pages/Register.tsx
  - Work: New account creation with validations and optional profile image upload.

- /contact -> Contact page
  - File: src/components/Contactus.tsx
  - Work: Public contact form submission to backend contact endpoint.

### Authenticated User Experience

- /user -> User dashboard
  - File: src/pages/UserDashboard.tsx
  - Work: Personal task/attendance summary, productivity stats, and quick actions.

- /tasks -> Tasks workspace
  - File: src/pages/Tasks.tsx
  - Work: Task listing, filtering, status updates, completion request flow, and admin approvals.

- /attendance -> Attendance workspace
  - File: src/components/Attendance.tsx
  - Work: Check-in/check-out, attendance submission, filters, and history view.

- /profile -> Profile page
  - File: src/pages/Profile.tsx
  - Work: Profile editing, activity heatmap, task stats, and attendance insights.

- /chat -> Chat page
  - File: src/pages/ChatPage.tsx
  - Work: Conversation list, unread indicators, and real-time one-to-one messaging UI.

- /social -> Social Hub
  - File: src/pages/SocialHub.tsx
  - Work: V2 social feed, personal todo, connections, integrations, publish jobs, approvals, and admin moderation.

### Team And Admin Pages

- /team -> Team leader dashboard
  - File: src/pages/TeamDashboard.tsx
  - Work: Team overview, team tasks, approvals, attendance review, invites, and team actions.

- /team-member -> Team member dashboard
  - File: src/pages/TeamMemberDashboard.tsx
  - Work: Invite management (accept/decline), team membership status, and team info.

- /admin -> Admin dashboard
  - File: src/pages/AdminDashboard.tsx
  - Work: Global operations overview with task approvals, attendance requests, and user data.

- /admin/attendance -> Admin attendance management
  - File: src/pages/Attendance-Admin.tsx
  - Work: Attendance moderation with approve/reject and record edits.

- /admin/userview -> User activity deep view
  - File: src/pages/Userview.tsx
  - Work: Per-user task and attendance analytics for admins.

- /admin/teams -> Team management
  - File: src/pages/TeamManagement.tsx
  - Work: Create/delete teams, invite members, assign leaders, and manage membership.

## Shared Components

- src/components/Navbar.tsx: Global navigation and authenticated app shell behavior
- src/components/Footer.tsx: Shared public footer
- src/components/Taskscard.tsx: Task card UI
- src/components/Tasksadd.tsx: Task creation form/modal
- src/components/Chat.tsx: Reusable chat panel
- src/components/Attendance.tsx: Attendance feature module (used as route view)
- src/components/Contactus.tsx: Contact form module (used as route view)

## State Management

- src/context/AuthContext.tsx
  - Stores user/session state and role flags
  - Handles login, register, logout, and profile updates

- src/context/ChatContext.tsx
  - Tracks unread counts and chat-side reactive state

## API Layer

API wrappers in src/api:

- authAPI.ts
- userAPI.ts
- taskAPI.ts
- attendanceAPI.ts
- teamAPI.ts
- contactAPI.ts
- socialV2API.ts
- axios.ts (shared HTTP client config)

## Notes

- Route protection and role redirects are handled in page-level logic and auth context checks.
- Public pages and authenticated pages share common layout elements through reusable components.

import './App.css'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import RequireAuth from './components/RequireAuth'
import { ChatProvider } from './context/ChatContext'
import { useAuth } from './context/useAuth'

// Each page is downloaded the first time it is opened, so visitors to the
// landing page don't load the dashboards, chat and Social Hub
const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Profile = lazy(() => import('./pages/Profile'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const Tasks = lazy(() => import('./pages/Tasks'))
const Attendance = lazy(() => import('./components/Attendance'))
const AttendanceAdmin = lazy(() => import('./pages/Attendance-Admin'))
const Userview = lazy(() => import('./pages/Userview'))
const Contactus = lazy(() => import('./components/Contactus'))
const About = lazy(() => import('./pages/About'))
const Service = lazy(() => import('./pages/Service'))
const Pricing = lazy(() => import('./pages/Pricing'))
const UserDashboard = lazy(() => import('./pages/UserDashboard'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const ContactMessages = lazy(() => import('./pages/ContactMessages'))
const NotFound = lazy(() => import('./pages/NotFound'))
const TeamDashboard = lazy(() => import('./pages/TeamDashboard'))
const TeamManagement = lazy(() => import('./pages/TeamManagement'))
const TeamMemberDashboard = lazy(() => import('./pages/TeamMemberDashboard'))
const SocialHub = lazy(() => import('./pages/SocialHub'))
const DashboardRedirect = lazy(() => import('./pages/DashboardRedirect'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Approvals = lazy(() => import('./pages/Approvals'))
const AdminPeople = lazy(() => import('./pages/AdminPeople'))
const AdminPerson = lazy(() => import('./pages/AdminPerson'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const AdminReports = lazy(() => import('./pages/AdminReports'))

const PageLoading = () => (
  <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading page">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
  </div>
)

function AppRoutes() {
  const location = useLocation()
  const { isAuthenticated } = useAuth()

  const publicPaths = ['/', '/about', '/service', '/pricing', '/login', '/register', '/contact', '/forgot-password', '/reset-password', '/verify-email']
  const isPublicRoute = publicPaths.includes(location.pathname)
  const showAppShell = isAuthenticated && !isPublicRoute

  return (
    <div className={showAppShell ? 'app-shell' : 'public-shell'}>
      <Navbar />
      <main className={showAppShell ? 'app-content' : 'public-content'}>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/about" element={<About />} />
            <Route path="/service" element={<Service />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/contact" element={<Contactus />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />

            <Route element={<RequireAuth />}>
              <Route path="/dashboard" element={<DashboardRedirect />} />
              <Route path="/user" element={<UserDashboard />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/attendance" element={<Attendance />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/team" element={<TeamDashboard />} />
              <Route path="/teams" element={<TeamDashboard />} />
              <Route path="/team-member" element={<TeamMemberDashboard />} />
              <Route path="/social" element={<SocialHub />} />
              <Route path="/todo" element={<SocialHub />} />
              <Route path="/network" element={<SocialHub />} />
              <Route path="/integrations" element={<SocialHub />} />
              <Route path="/publish-jobs" element={<SocialHub />} />
              <Route path="/notifications" element={<Notifications />} />
              {/* Team leaders and admins: tasks, attendance, leave and posts waiting for review */}
              <Route path="/approvals" element={<Approvals />} />
            </Route>

            <Route element={<RequireAuth admin />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/attendance" element={<AttendanceAdmin />} />
              <Route path="/admin/userview" element={<Userview />} />
              <Route path="/admin/users" element={<AdminPeople />} />
              <Route path="/admin/users/:id" element={<AdminPerson />} />
              <Route path="/admin/audit" element={<AuditLog />} />
              <Route path="/admin/reports" element={<AdminReports />} />
              <Route path="/admin/messages" element={<ContactMessages />} />
              <Route path="/admin/teams" element={<TeamManagement />} />
              <Route path="/admin/moderation" element={<SocialHub />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}

function App() {
  return (
    <ChatProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ChatProvider>
  )
}

export default App

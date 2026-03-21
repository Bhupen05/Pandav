import './App.css'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import Profile from './pages/Profile'
import AdminDashboard from './pages/AdminDashboard'
import Tasks from './pages/Tasks'
import Attendance from './components/Attendance'
import AttendanceAdmin from './pages/Attendance-Admin'
import Userview from './pages/Userview'
import Contactus from './components/Contactus'
import About from './pages/About'
import Service from './pages/Service'
import Pricing from './pages/Pricing'
import UserDashboard from './pages/UserDashboard'
import { ChatProvider } from './context/ChatContext'
import ChatPage from './pages/ChatPage'
import TeamDashboard from './pages/TeamDashboard'
import TeamManagement from './pages/TeamManagement'
import TeamMemberDashboard from './pages/TeamMemberDashboard'
import { useAuth } from './context/AuthContext'

function AppRoutes() {
  const location = useLocation()
  const { isAuthenticated } = useAuth()

  const publicPaths = ['/', '/about', '/service', '/pricing', '/login', '/register', '/contact']
  const isPublicRoute = publicPaths.includes(location.pathname)
  const showAppShell = isAuthenticated && !isPublicRoute

  return (
    <div className={showAppShell ? 'app-shell' : 'public-shell'}>
      <Navbar />
      <main className={showAppShell ? 'app-content' : 'public-content'}>
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/" element={<Landing />} />
          <Route path="/about" element={<About/>} />
          <Route path="/service" element={<Service />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/attendance" element={<AttendanceAdmin />} />
          <Route path="/admin/userview" element={<Userview />} />
          <Route path="/admin/teams" element={<TeamManagement />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/contact" element={<Contactus />} />
          <Route path="/user" element={<UserDashboard />} />
          <Route path="/team" element={<TeamDashboard />} />
          <Route path="/team-member" element={<TeamMemberDashboard />} />
        </Routes>
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
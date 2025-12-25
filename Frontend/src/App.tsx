import './App.css'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import Profile from './pages/Profile'
import AdminDashboard from './pages/AdminDashboard'
import Tasks from './pages/Tasks'
import Tasksadd from './components/Tasksadd'
import Attendance from './components/Attendance'
import Contactus from './components/Contactus'
import About from './pages/About'
import Service from './pages/Service'
import UserDashboard from './pages/UserDashboard'
import { AuthProvider } from './context/AuthContext'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/about" element={<About/>} />
          <Route path="/service" element={<Service />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/add" element={<Tasksadd onCreate={(task) => console.log('Task created:', task)} />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/contact" element={<Contactus />} />
          <Route path="/user" element = {<UserDashboard />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
import './App.css'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Profile from './pages/Profile'
import AdminDashboard from './pages/AdminDashboard'
import Tasks from './pages/Tasks'
import Tasksadd from './components/Tasksadd'
import Attendance from './components/Attendance'
import Contactus from './components/Contactus'
import About from './pages/About'
import Service from './pages/Service'

function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/about" element={<About/>} />
        <Route path="/service" element={<Service />} />
        <Route path="/login" element={<Login />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/add" element={<Tasksadd onCreate={(task) => console.log('Task created:', task)} />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/contact" element={<Contactus />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
import { Navigate } from 'react-router-dom'

// The old read-only user viewer is now the People page and a page per person
export default function Userview() {
  return <Navigate to="/admin/users" replace />
}

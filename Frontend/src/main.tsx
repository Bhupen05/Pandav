import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'
import { FeedbackProvider } from './context/FeedbackContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </AuthProvider>
  </StrictMode>,
)

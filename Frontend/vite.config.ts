import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const backendUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_BACKEND_URL || 'http://localhost:5000'

  return {
    plugins: [react(), tailwindcss()],
    // The app calls /api on its own origin, as it does behind Vercel's proxy in
    // production, so the session cookie works the same way in development
    server: {
      proxy: { '/api': backendUrl },
    },
  }
})

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
    // Pages are lazy-loaded, so Vite would find some packages only when a page
    // first opens and re-bundle mid-session: an on-demand import fails, or a
    // page gets a second copy of React ("Invalid hook call"). Scan every source
    // file at start-up instead, and name the two late finds outright.
    // Kept next to the project, not in node_modules: git worktrees link
    // node_modules to one shared folder, and parallel dev servers would
    // overwrite each other's bundles there
    cacheDir: '.vite',
    optimizeDeps: {
      entries: ['index.html', 'src/**/*.{ts,tsx}'],
      include: ['qrcode', 'motion/react'],
    },
  }
})

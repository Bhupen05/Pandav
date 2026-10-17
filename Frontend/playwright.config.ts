import { defineConfig, devices } from '@playwright/test'
import { BACKEND_PORT, CONTROL_URL, FRONTEND_PORT } from './e2e/support/servers'

// Browser tests against the real backend (Backend/test/e2e-server.js, on a
// fresh database seeded with the two test accounts) and the Vite dev server,
// whose /api proxy works like Vercel's in production. Needs MongoDB, as the
// backend tests do (TEST_MONGODB_URL, default mongodb://127.0.0.1:27017).
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`

export default defineConfig({
  testDir: './e2e',
  // The tests share one database and one backend
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: FRONTEND_URL,
    // The server decides which day attendance belongs to in APP_TIMEZONE
    // (Asia/Kolkata in tests); the page compares it with the browser's day
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../Backend/test/e2e-server.js',
      url: `http://127.0.0.1:${BACKEND_PORT}/api/v2/health`,
      env: {
        E2E_BACKEND_PORT: String(BACKEND_PORT),
        E2E_CONTROL_PORT: new URL(CONTROL_URL).port,
        CLIENT_URL: FRONTEND_URL,
      },
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
      url: FRONTEND_URL,
      env: { VITE_BACKEND_URL: `http://localhost:${BACKEND_PORT}` },
      timeout: 60_000,
    },
  ],
})

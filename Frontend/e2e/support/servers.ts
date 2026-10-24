// Where the browser tests run the app (see playwright.config.ts). Override the
// ports (and TEST_DB_PREFIX for the database) to run two checkouts at once.
const port = (name: string, fallback: number) => Number(process.env[name]) || fallback

export const FRONTEND_PORT = port('E2E_FRONTEND_PORT', 5180)
export const BACKEND_PORT = port('E2E_BACKEND_PORT', 5055)
// Backend/test/e2e-server.js: POST /restart restarts the API
export const CONTROL_URL = `http://127.0.0.1:${port('E2E_CONTROL_PORT', 5056)}`

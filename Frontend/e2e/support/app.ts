import { createHmac } from 'node:crypto'
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { CONTROL_URL } from './servers'

// Seeded by Backend/test/e2e-server.js (same as the backend tests)
export const ADMIN = { name: 'Admin User', email: 'admin@example.com', password: 'AdminPass123!' }
export const USER = { name: 'Demo User', email: 'user@example.com', password: 'UserPass123!' }
export type Account = typeof ADMIN

export const SESSION_COOKIE = 'pandav_session'

export async function signIn(page: Page, account: Account, { remember = false } = {}) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  if (remember) await page.getByLabel('Remember me').check()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

export async function signOut(page: Page, account: Account) {
  // The avatar button by its full name: other buttons can contain the name too
  // ("Delete comment by Admin User")
  await page.getByRole('button', { name: `${account.name}, account menu`, exact: true }).click()
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page).toHaveURL(/\/$/)
}

export const sessionCookie = async (context: BrowserContext) =>
  (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE)

// Everything the page's scripts can see in browser storage
export const browserStorage = (page: Page) =>
  page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }))

// Restarts the API (the database is kept); resolves once it is back up
export async function restartBackend() {
  const response = await fetch(`${CONTROL_URL}/restart`, { method: 'POST' })
  if (!response.ok) throw new Error(`Backend restart failed: ${await response.text()}`)
}

// A fresh account made through the API (sign-ups are limited to 10 an hour, so
// tests make only the ones they need)
export async function registerAccount(request: APIRequestContext, label: string): Promise<Account & { id: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const account: Account = {
    name: `${label} ${stamp.slice(-6)}`,
    email: `${label.toLowerCase().replace(/\W+/g, '')}-${stamp}@e2e.test`,
    password: 'TestPass123!',
  }
  const response = await request.post('/api/v2/auth/register', { data: account })
  expect(response.status(), 'register').toBe(201)
  return { ...account, id: (await response.json()).data._id }
}

// Signs an API request context in as the seeded admin, for setting things up that the UI of this spec isn't about
export async function adminApi(request: APIRequestContext) {
  const login = await request.post('/api/v2/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } })
  expect(login.status(), 'admin login').toBe(200)
  return request
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// The code an authenticator app shows for `secret` (RFC 6238: SHA-1, 6 digits,
// 30-second steps). `at` moves the clock, to ask for another step's code.
export function totp(secret: string, at = Date.now()) {
  const bits = [...secret.replace(/=+$/, '').toUpperCase()].map((char) => BASE32.indexOf(char).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[digest.length - 1] & 0xf
  const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]
  return String(value % 1_000_000).padStart(6, '0')
}

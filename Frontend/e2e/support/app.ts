import { expect, type BrowserContext, type Page } from '@playwright/test'
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
  await page.getByRole('button', { name: account.name }).click()
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

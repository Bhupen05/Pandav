import { expect, test, type Browser, type BrowserContext } from '@playwright/test'
import { ADMIN, USER, browserStorage, sessionCookie, signIn, signOut, SESSION_COOKIE } from './support/app'

test('sign in, reload and sign out; the session never reaches page scripts', async ({ page, context }) => {
  await signIn(page, ADMIN)
  await expect(page).toHaveURL(/\/admin$/)

  const cookie = await sessionCookie(context)
  expect(cookie, 'session cookie').toBeDefined()
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.path).toBe('/api')
  expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE)
  const storage = await browserStorage(page)
  expect(JSON.stringify(storage)).not.toContain(cookie!.value)
  expect(Object.keys(storage.local).concat(Object.keys(storage.session))).not.toContain('token')

  await page.reload()
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByRole('button', { name: ADMIN.name })).toBeVisible()

  await signOut(page, ADMIN)
  expect(await sessionCookie(context)).toBeUndefined()
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login$/)
})

// A browser restart keeps cookies with an expiry date and drops session cookies
const restartBrowser = async (browser: Browser, context: BrowserContext) => {
  const kept = (await context.cookies()).filter((cookie) => cookie.expires > 0)
  await context.close()
  const restarted = await browser.newContext()
  await restarted.addCookies(kept)
  return restarted
}

test('"Remember me" survives a browser restart; a plain session does not', async ({ browser }) => {
  const remembered = await browser.newContext()
  await signIn(await remembered.newPage(), USER, { remember: true })
  expect((await sessionCookie(remembered))?.expires).toBeGreaterThan(Date.now() / 1000)
  const afterRestart = await restartBrowser(browser, remembered)
  const page = await afterRestart.newPage()
  await page.goto('/user')
  await expect(page).toHaveURL(/\/user$/)
  await expect(page.getByRole('button', { name: USER.name })).toBeVisible()
  await afterRestart.close()

  const plain = await browser.newContext()
  await signIn(await plain.newPage(), USER)
  expect((await sessionCookie(plain))?.expires).toBe(-1)
  const plainRestart = await restartBrowser(browser, plain)
  const plainPage = await plainRestart.newPage()
  await plainPage.goto('/user')
  await expect(plainPage).toHaveURL(/\/login$/)
  await plainRestart.close()
})

test('protected and admin-only pages redirect', async ({ page }) => {
  await page.goto('/tasks')
  await expect(page).toHaveURL(/\/login$/)

  // Signing in returns to the page asked for
  await signIn(page, USER)
  await expect(page).toHaveURL(/\/tasks$/)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/user$/)
})

test('an expired session lands on the login page without looping', async ({ page, context }) => {
  await context.addCookies([{
    name: SESSION_COOKIE,
    value: 'expired.or.revoked',
    url: test.info().project.use.baseURL + '/api',
    httpOnly: true,
  }])
  // A loop would load the page again and again
  let pageLoads = 0
  page.on('load', () => { pageLoads += 1 })

  await page.goto('/tasks')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page).toHaveURL(/\/login$/)
  expect(pageLoads, 'page loads after opening /tasks').toBe(1)
})

import { expect, test, type Browser, type Page } from '@playwright/test'
import { ADMIN, USER, registerAccount, sessionCookie, signIn } from './support/app'

// A browser of its own, so each sign-in is a separate session
const newPage = async (browser: Browser) => (await browser.newContext()).newPage()

// True when the page can't be scrolled sideways
const fitsWidth = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('public pages: a menu on phones, and signed-in visitors get a dashboard button instead of the app shell', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/')
  expect(await fitsWidth(page)).toBe(true)
  const toggle = page.getByRole('button', { name: /^(Open|Close) menu$/ })
  const menu = page.locator('#public-menu')
  await expect(menu).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(menu.getByRole('link', { name: 'Pricing' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(toggle).toBeFocused()

  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, USER)
  await page.goto('/pricing')
  await expect(page.getByRole('link', { name: 'Go to dashboard' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Go to dashboard' }).click()
  await expect(page).toHaveURL(/\/user$/)

  // Someone who is signed in has no use for the sign-in pages
  await page.goto('/login')
  await expect(page).toHaveURL(/\/user$/)
  await page.goto('/register')
  await expect(page).toHaveURL(/\/user$/)
})

test('404: the public header for visitors, the role\'s home for signed-in users', async ({ page, browser }) => {
  await page.goto('/no-such-page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to home' }).click()
  await expect(page).toHaveURL(/\/$/)

  await signIn(page, USER)
  await page.goto('/no-such-page')
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to dashboard' }).click()
  await expect(page).toHaveURL(/\/user$/)

  const admin = await newPage(browser)
  await signIn(admin, ADMIN)
  await admin.goto('/no-such-page')
  await admin.getByRole('link', { name: 'Back to dashboard' }).click()
  await expect(admin).toHaveURL(/\/admin$/)
  await admin.context().close()
})

test('navigation: the current section is marked, the account menu and the phone drawer work with the keyboard', async ({ page }) => {
  await signIn(page, USER)
  const rail = page.getByRole('navigation', { name: 'Primary' })
  await expect(rail.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  await rail.getByRole('link', { name: 'Tasks' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(rail.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  await expect(rail.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page')
  // The top bar lost its Refresh and Profile buttons (pages may have their own Refresh)
  const topBar = page.getByRole('banner')
  await expect(topBar.getByRole('button', { name: 'Refresh' })).toHaveCount(0)
  await expect(topBar.getByRole('button', { name: 'Profile', exact: true })).toHaveCount(0)

  // Account menu: opens, Escape closes it and puts focus back, "Profile" leads to the profile
  const avatar = page.getByRole('button', { name: `${USER.name}, account menu` })
  await avatar.click()
  await expect(avatar).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(avatar).toHaveAttribute('aria-expanded', 'false')
  await expect(avatar).toBeFocused()
  await avatar.click()
  await page.getByRole('region', { name: 'Account' }).getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/profile$/)

  // Phone drawer
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/user')
  const drawer = page.locator('aside[aria-label="Menu"]')
  const hamburger = page.getByRole('button', { name: /^(Open|Close) menu$/ })
  await expect(drawer).toHaveJSProperty('inert', true)
  // Tab from the menu button never lands in the closed drawer
  await hamburger.focus()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('aside[aria-label="Menu"]') !== null)).toBe(false)

  await hamburger.click()
  await expect(drawer).toHaveJSProperty('inert', false)
  await expect(drawer.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await expect(drawer.getByRole('link', { name: 'Tasks' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveJSProperty('inert', true)
  await expect(hamburger).toBeFocused()
  expect(await fitsWidth(page)).toBe(true)
})

test('a session that ended says so on the login page', async ({ page }) => {
  await signIn(page, USER)
  await page.context().clearCookies()
  // The next request the page makes is refused. A request still on its way from
  // signing in may get there first, and then there is no link left to click.
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Tasks' }).click({ timeout: 3000 }).catch(() => undefined)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Your session ended. Please sign in again.')).toBeVisible()
})

test('sign-in page: field hints, the forgot-password help, and the pages behind emailed links', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'username')
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
  expect(await fitsWidth(page)).toBe(true)

  // Email isn't set up on the test server: the help names the admin, not a link
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await expect(page.getByText('Ask your admin to reset it.')).toBeVisible()
  await page.goto('/forgot-password')
  await expect(page.getByText('is not set up here')).toBeVisible()

  // A reset link that is incomplete, or wrong, says so
  await page.goto('/reset-password')
  await expect(page.getByRole('alert')).toContainText('incomplete')
  await page.goto('/reset-password?token=nope')
  await page.getByLabel('New password', { exact: true }).fill('SomePass123')
  await page.getByLabel('Confirm new password').fill('SomePass123')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('alert')).toContainText('expired or was already used')

  await page.goto('/verify-email')
  await expect(page.getByRole('alert')).toContainText('incomplete')
  await page.goto('/verify-email?token=nope')
  await expect(page.getByRole('alert')).toContainText('expired or was already used')
})

test('profile: edit details, change the email with the password, photo, tabs in the address, email switch, delete account', async ({ browser, request }) => {
  const account = await registerAccount(request, 'Profile')
  const page = await newPage(browser)
  await signIn(page, account)
  await page.goto('/profile')
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveText(account.name)
  await expect(page.getByText('Awaiting review (0)')).toBeVisible()
  await expect(page.getByText('Less', { exact: true })).toBeVisible()

  // Name, phone and department
  await page.getByRole('button', { name: 'Edit Profile' }).click()
  await page.getByLabel('Full Name').fill(`${account.name} Jr`)
  await page.getByLabel('Phone').fill('555-0100')
  await page.getByLabel('Department').fill('Operations')
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible()
  await expect(heading).toHaveText(`${account.name} Jr`)
  await expect(page.getByText('Operations')).toBeVisible()

  // A new email asks for the current password
  const newEmail = `changed-${Date.now()}@e2e.test`
  await page.getByRole('button', { name: 'Edit Profile' }).click()
  await page.getByLabel('Email').fill(newEmail)
  await page.getByLabel('Current password').fill('not-the-password')
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Current password is incorrect' })).toBeVisible()
  await page.getByLabel('Current password').fill(account.password)
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible()
  await expect(page.getByText(newEmail)).toBeVisible()

  // Photo: preview, save, choose the same file again, remove
  const picture = {
    name: 'me.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  }
  const photoDialog = page.getByRole('dialog', { name: 'Update Profile Picture' })
  await page.locator('input[type=file]').setInputFiles(picture)
  await photoDialog.getByRole('button', { name: 'Confirm Change' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Profile photo updated.' })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles(picture)
  await expect(photoDialog).toBeVisible()
  await photoDialog.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Remove photo' }).click()
  await page.getByRole('dialog', { name: 'Remove your photo?' }).getByRole('button', { name: 'Remove photo' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Profile photo removed.' })).toBeVisible()

  // Tabs live in the address, and arrow keys move between them
  await page.getByRole('tab', { name: 'Security' }).click()
  await expect(page).toHaveURL(/\/profile\?tab=security$/)
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Security' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Security' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/\/profile\?tab=notifications$/)
  const emailSwitch = page.getByRole('switch', { name: 'Email me about important notifications' })
  await expect(emailSwitch).toHaveAttribute('aria-checked', 'true')
  await emailSwitch.click()
  await expect(emailSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('status').filter({ hasText: 'Email notifications are off.' })).toBeVisible()

  // The page fits a phone
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/profile')
  expect(await fitsWidth(page)).toBe(true)
  await page.goto('/profile?tab=security')
  expect(await fitsWidth(page)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 800 })

  // Deleting the account: a wrong password is refused inside the dialog, the right one ends the account
  await page.getByRole('button', { name: 'Delete my account' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
  await dialog.getByLabel('Your password').fill('not-the-password')
  await dialog.getByRole('button', { name: 'Delete my account' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Password is incorrect')
  await dialog.getByLabel('Your password').fill(account.password)
  await dialog.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await sessionCookie(page.context())).toBeUndefined()

  await page.goto('/login')
  await page.getByLabel('Email').fill(newEmail)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Error:')).toBeVisible()
  await page.context().close()
})

test('a toast that arrives while a dialog is open shows inside it, can be dismissed there, and moves out when the dialog closes', async ({ browser, request }) => {
  const invitee = await registerAccount(request, 'Toastee')
  const crews = [await registerAccount(request, 'Toasterone'), await registerAccount(request, 'Toastertwo')]

  const page = await newPage(browser)
  await signIn(page, invitee)
  // Live delivery needs the socket to be open before the invite is sent
  const socketOpened = page.waitForEvent('websocket')
  await page.goto('/chat')
  await socketOpened
  await page.getByRole('tab', { name: /^Team Chat/ }).click()
  await page.getByRole('button', { name: 'Create your team' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create your team' })
  const nameField = dialog.getByLabel('Team name')
  await nameField.focus()

  // Another person invites the invitee: the notification arrives as a toast
  const inviteFrom = async (founder: (typeof crews)[number], team: string) => {
    expect((await request.post('/api/v2/auth/login', { data: { email: founder.email, password: founder.password } })).status()).toBe(200)
    const created = await request.post('/api/v2/teams', { data: { name: `${team} ${Date.now()}` } })
    expect(created.status()).toBe(201)
    const teamId = (await created.json()).data._id
    expect((await request.post(`/api/v2/teams/${teamId}/invite`, { data: { email: invitee.email } })).status()).toBe(201)
  }
  // Where a toast sits: inside which dialog, and inside which live region
  const where = (toast: ReturnType<Page['getByRole']>) =>
    toast.evaluate((element) => ({
      dialog: element.closest('dialog')?.getAttribute('aria-labelledby') ?? null,
      live: element.closest('[aria-live]')?.getAttribute('aria-live') ?? null,
    }))

  await inviteFrom(crews[0], 'Toast crew')
  const first = page.getByRole('status').filter({ hasText: 'invited you to join' })
  await expect(first).toBeVisible()
  expect(await where(first)).toEqual({ dialog: 'manage-team-title', live: 'polite' })
  // It didn't take the cursor from the dialog's field
  await expect(nameField).toBeFocused()

  // The × works although the page behind the dialog is inert, and the dialog stays
  await first.getByRole('button', { name: 'Dismiss' }).click()
  await expect(first).toHaveCount(0)
  await expect(dialog).toBeVisible()

  // A toast that is still showing when the dialog closes goes back to the page
  await inviteFrom(crews[1], 'Toast crew')
  const second = page.getByRole('status').filter({ hasText: 'invited you to join' })
  await expect(second).toBeVisible()
  expect(await where(second)).toEqual({ dialog: 'manage-team-title', live: 'polite' })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(second).toBeVisible()
  expect(await where(second)).toEqual({ dialog: null, live: 'polite' })
  await second.getByRole('button', { name: 'Dismiss' }).click()
  await expect(second).toHaveCount(0)

  await page.context().close()
})

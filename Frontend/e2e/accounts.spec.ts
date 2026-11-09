import { expect, test, type Browser } from '@playwright/test'
import { adminApi, registerAccount, sessionCookie, signIn, totp } from './support/app'

// A browser of its own, so each sign-in is a separate session
const newPage = async (browser: Browser) => (await browser.newContext()).newPage()

test('two-step sign-in: set up, sign in with a code and a backup code, turn off', async ({ browser, request }) => {
  const account = await registerAccount(request, 'Twostep')
  const page = await newPage(browser)
  await signIn(page, account)

  // Set up: password, then the QR code and the key, then the first code
  await page.goto('/profile?tab=security')
  await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click()
  await page.getByLabel('Your password').fill(account.password)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible()
  const secret = (await page.getByText(/^[A-Z2-7]{16,}$/).innerText()).trim()

  // A wrong code is refused with the server's message
  await page.getByLabel('6-digit code').fill('000000')
  await page.getByRole('button', { name: 'Turn on', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not right')

  // The previous step's code is accepted (and used up), which leaves this step's for signing in
  await page.getByLabel('6-digit code').fill(totp(secret, Date.now() - 30_000))
  await page.getByRole('button', { name: 'Turn on', exact: true }).click()
  const codeItems = page.getByRole('list', { name: 'Backup codes' }).getByRole('listitem')
  await expect(codeItems).toHaveCount(8)
  const backupCodes = await codeItems.allInnerTexts()
  await page.getByRole('button', { name: 'I have saved these codes' }).click()
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible()

  // Signing in now asks for a code after the password
  const second = await newPage(browser)
  await second.goto('/login')
  await second.getByLabel('Email').fill(account.email)
  await second.getByLabel('Password', { exact: true }).fill(account.password)
  await second.getByRole('button', { name: 'Sign in' }).click()
  await expect(second.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible()
  await second.getByLabel('6-digit code').fill('000000')
  await second.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(second.getByRole('alert')).toContainText('not right')
  await second.getByLabel('6-digit code').fill(totp(secret))
  await second.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(second).toHaveURL(/\/user$/)

  // A backup code works instead of the app's code
  const third = await newPage(browser)
  await third.goto('/login')
  await third.getByLabel('Email').fill(account.email)
  await third.getByLabel('Password', { exact: true }).fill(account.password)
  await third.getByRole('button', { name: 'Sign in' }).click()
  await third.getByRole('button', { name: 'Use a backup code' }).click()
  await third.getByLabel('Backup code').fill(backupCodes[0])
  await third.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(third).toHaveURL(/\/user$/)

  // Turn it off with the password and another backup code
  await page.getByRole('button', { name: 'Turn off' }).click()
  const dialog = page.getByRole('dialog', { name: 'Turn off two-step sign-in?' })
  await dialog.getByLabel('Your password').fill(account.password)
  await dialog.getByLabel('Code from your authenticator app, or a backup code').fill(backupCodes[1])
  await dialog.getByRole('button', { name: 'Turn off' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Two-step sign-in is off.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Turn on two-step sign-in' })).toBeVisible()

  for (const open of [page, second, third]) await open.context().close()
})

test('a password set by an admin has to be replaced before anything else; then sign out everywhere', async ({ browser, request }) => {
  const account = await registerAccount(request, 'Forced')
  const admin = await adminApi(request)
  const reset = await admin.put(`/api/v2/users/${account.id}/reset-password`, { data: { newPassword: 'AdminSet123' } })
  expect(reset.status()).toBe(200)

  // Signing in with it goes straight to the change-password screen
  const page = await newPage(browser)
  await signIn(page, { ...account, password: 'AdminSet123' })
  await expect(page).toHaveURL(/\/profile\?tab=security$/)
  await expect(page.getByText('Choose a new password to continue.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveCount(0)

  // And keeps the user there
  await page.goto('/tasks')
  await expect(page).toHaveURL(/\/profile\?tab=security$/)

  // The admin's password can't be kept
  await page.getByLabel('Password from your admin').fill('AdminSet123')
  await page.getByLabel('New password', { exact: true }).fill('AdminSet123')
  await page.getByLabel('Confirm new password').fill('AdminSet123')
  await page.getByRole('button', { name: 'Change password', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'not the one the admin gave you' })).toBeVisible()

  const chosen = 'ChosenPass456!'
  await page.getByLabel('New password', { exact: true }).fill(chosen)
  await page.getByLabel('Confirm new password').fill(chosen)
  await page.getByRole('button', { name: 'Change password', exact: true }).click()
  await expect(page).toHaveURL(/\/user$/)
  await page.goto('/tasks')
  await expect(page).toHaveURL(/\/tasks$/)

  // A second browser, then "sign out everywhere" from the first ends both
  const other = await newPage(browser)
  await signIn(other, { ...account, password: chosen })
  await page.goto('/profile?tab=security')
  await page.getByRole('button', { name: 'Sign out everywhere' }).click()
  await page.getByRole('dialog', { name: 'Sign out everywhere?' }).getByRole('button', { name: 'Sign out everywhere' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await sessionCookie(page.context())).toBeUndefined()

  await other.goto('/user')
  await expect(other).toHaveURL(/\/login$/)

  await page.context().close()
  await other.context().close()
})

test('the bell shows a team invite as it arrives, and opening it goes to the Team page', async ({ browser, request }) => {
  const founder = await registerAccount(request, 'Founder')
  const invitee = await registerAccount(request, 'Invitee')

  const page = await newPage(browser)
  // Live delivery needs the socket to be open before the invite is sent
  const socketOpened = page.waitForEvent('websocket')
  await signIn(page, invitee)
  await socketOpened
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()

  const login = await request.post('/api/v2/auth/login', { data: { email: founder.email, password: founder.password } })
  expect(login.status()).toBe(200)
  const team = await request.post('/api/v2/teams', { data: { name: `Crew ${Date.now()}` } })
  expect(team.status()).toBe(201)
  const teamId = (await team.json()).data._id
  const invite = await request.post(`/api/v2/teams/${teamId}/invite`, { data: { email: invitee.email } })
  expect(invite.status()).toBe(201)

  // A toast, the badge on the bell, and the badge on the Team link
  await expect(page.getByRole('status').filter({ hasText: 'invited you to join' })).toBeVisible()
  const bell = page.getByRole('button', { name: 'Notifications, 1 unread' })
  await expect(bell).toBeVisible()
  await expect(page.getByRole('link', { name: /^Team/ }).first()).toContainText('1 pending')

  // The menu lists it as unread; clicking it opens the Team page and marks it read
  await bell.click()
  const menu = page.getByRole('region', { name: 'Notifications' })
  const item = menu.getByRole('button', { name: /invited you to join/ })
  await expect(item).toContainText('Unread')
  await item.click()
  await expect(page).toHaveURL(/\/teams$/)
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()

  // "See all" lists it as read
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page.getByRole('link', { name: 'See all' }).click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible()
  await expect(page.getByRole('link', { name: /invited you to join/ })).toBeVisible()
  await expect(page.getByText('Nothing unread.')).toBeVisible()

  // The unread filter has nothing left; deleting removes the row
  await page.getByRole('button', { name: 'Unread', exact: true }).click()
  await expect(page.getByText('No unread notifications')).toBeVisible()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByRole('button', { name: /^Delete notification/ }).click()
  await expect(page.getByText('No notifications yet')).toBeVisible()

  await page.context().close()
})

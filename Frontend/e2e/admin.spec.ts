import { expect, test, type Browser } from '@playwright/test'
import { ADMIN, USER, signIn, type Account } from './support/app'

const signedInPage = async (browser: Browser, account: Account) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, account)
  return page
}

// YYYY-MM-DD, `days` from today
const dateInput = (days = 0) => {
  const date = new Date(Date.now() + days * 24 * 3600 * 1000)
  return date.toISOString().slice(0, 10)
}

test('admin creates, edits and deletes a task', async ({ browser }) => {
  const page = await signedInPage(browser, ADMIN)
  const title = `E2E task ${Date.now()}`
  const renamed = `${title} (edited)`

  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toBeVisible()
  await page.getByRole('button', { name: 'New Task' }).click()
  await expect(page.getByRole('heading', { name: 'Create New Task' })).toBeVisible()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Description').fill('Created by the browser tests')
  await page.getByLabel('Start Date').fill(dateInput())
  await page.getByLabel('Due Date').fill(dateInput(7))
  await page.getByRole('button', { name: 'high', exact: true }).click()
  await page.getByRole('button', { name: 'Select users to assign' }).click()
  await page.getByRole('checkbox', { name: new RegExp(USER.name) }).check()
  await page.getByRole('button', { name: '1 user selected' }).click()
  await page.getByRole('button', { name: 'Create Task', exact: true }).click()

  const card = (name: string) => page.getByRole('article').filter({ has: page.getByRole('heading', { name }) })
  await expect(card(title)).toBeVisible()

  await card(title).getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Edit Task' })).toBeVisible()
  await page.getByLabel('Title').fill(renamed)
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await expect(card(renamed)).toBeVisible()

  await card(renamed).getByRole('button', { name: 'Delete', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete this task?' })
  const deleted = page.waitForResponse((response) => response.request().method() === 'DELETE' && /\/api\/v2\/tasks\//.test(response.url()))
  await confirm.getByRole('button', { name: 'Delete' }).click()
  expect((await deleted).status()).toBe(200)
  await expect(card(renamed)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toBeVisible()
  await expect(card(renamed)).toHaveCount(0)

  await page.context().close()
})

test('a user checks in and the admin approves it', async ({ browser }) => {
  const user = await signedInPage(browser, USER)
  // The button reflects today's record, so wait for the records first
  const loaded = user.waitForResponse((response) => /\/api\/v2\/attendance\?/.test(response.url()))
  await user.goto('/attendance')
  await loaded
  await user.getByRole('button', { name: 'Check In', exact: true }).click()
  await expect(user.getByText('Checked in successfully. Your attendance is pending approval.')).toBeVisible()
  await expect(user.getByRole('button', { name: '✓ Checked In' })).toBeDisabled()
  // A day can be reviewed once it is over: the check-out comes first
  await user.getByRole('button', { name: 'Check Out', exact: true }).click()
  await expect(user.getByRole('button', { name: '✓ Checked Out' })).toBeDisabled()

  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/admin/attendance')
  await expect(admin.getByRole('heading', { name: 'Attendance Management' })).toBeVisible()
  const row = admin.getByRole('row').filter({ hasText: USER.email })
  await row.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(row.getByText(/^approved$/i)).toBeVisible()
  await expect(row.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()

  await user.reload()
  await expect(user.getByText('Awaiting approval')).toHaveCount(0)

  await user.context().close()
  await admin.context().close()
})

test('admin resets a password; the new one signs in', async ({ browser, request }) => {
  // Its own account, so the seeded user's password stays as the other tests expect
  const target = { name: 'Riley Reset', email: `riley${Date.now()}@e2e.test`, password: 'OldPass123' }
  expect((await request.post('/api/v2/auth/register', { data: target })).status()).toBe(201)

  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/admin')
  await admin.getByRole('button', { name: 'Manage Users' }).click()
  await expect(admin.getByRole('heading', { name: 'User Management' })).toBeVisible()
  await admin.getByRole('row').filter({ hasText: target.email }).getByRole('button', { name: 'Reset password' }).click()

  const prompt = admin.getByRole('dialog', { name: `Reset password for ${target.name}` })
  await prompt.getByLabel('New password (at least 6 characters)').fill('NewPass456')
  await prompt.getByRole('button', { name: 'Reset password' }).click()
  await expect(admin.getByRole('status').filter({ hasText: `Share the new password with ${target.name}` })).toBeVisible()
  await admin.context().close()

  const page = await (await browser.newContext()).newPage()
  await signIn(page, { ...target, password: 'NewPass456' })
  await expect(page).toHaveURL(/\/user$/)

  await page.goto('/login')
  await page.getByLabel('Email').fill(target.email)
  await page.getByLabel('Password', { exact: true }).fill(target.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Error:')).toBeVisible()
  await page.context().close()
})

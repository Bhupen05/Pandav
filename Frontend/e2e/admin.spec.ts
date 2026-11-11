import { expect, test, type APIRequestContext, type Browser } from '@playwright/test'
import { ADMIN, USER, registerAccount, signIn, type Account } from './support/app'

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
  await admin.getByRole('region', { name: 'Quick actions' }).getByRole('link', { name: 'People' }).click()
  await expect(admin.getByRole('heading', { name: 'People', exact: true })).toBeVisible()
  await admin.getByLabel('Search people').fill(target.email)
  await admin.getByRole('row').filter({ hasText: target.email }).getByRole('button', { name: 'Reset password' }).click()

  const prompt = admin.getByRole('dialog', { name: `Reset password for ${target.name}` })
  await prompt.getByLabel('New password (at least 6 characters)').fill('NewPass456')
  await prompt.getByRole('button', { name: 'Reset password' }).click()
  await expect(admin.getByRole('status').filter({ hasText: `Share the new password with ${target.name}` })).toBeVisible()
  await admin.context().close()

  const page = await (await browser.newContext()).newPage()
  await signIn(page, { ...target, password: 'NewPass456' })
  // A password set by an admin has to be replaced first (accounts.spec.ts covers that flow)
  await expect(page).toHaveURL(/\/profile\?tab=security$/)

  const other = await (await browser.newContext()).newPage()
  await other.goto('/login')
  await other.getByLabel('Email').fill(target.email)
  await other.getByLabel('Password', { exact: true }).fill(target.password)
  await other.getByRole('button', { name: 'Sign in' }).click()
  await expect(other.getByText('Error:')).toBeVisible()
  await other.context().close()
  await page.context().close()
})

// A person to work on, made through the API so the seeded accounts stay as the other tests expect
const newPerson = async (request: APIRequestContext, label: string) => {
  const person = { name: `${label} ${Date.now()}`, email: `${label.toLowerCase()}${Date.now()}@e2e.test`, password: 'Passw0rd123' }
  expect((await request.post('/api/v2/auth/register', { data: person })).status()).toBe(201)
  return person
}

test('admin finds a person, disables and enables them, and the audit log lists it', async ({ browser, request }) => {
  const person = await newPerson(request, 'Dana')
  const admin = await signedInPage(browser, ADMIN)

  await admin.goto('/admin/users')
  await admin.getByLabel('Search people').fill(person.email)
  const row = admin.getByRole('row').filter({ hasText: person.email })
  await expect(row).toBeVisible()
  await expect(admin.getByRole('row')).toHaveCount(2) // the header and the match

  await row.getByRole('button', { name: `Disable ${person.name}` }).click()
  const confirm = admin.getByRole('dialog', { name: `Disable ${person.name}?` })
  await expect(confirm.getByText('signed out everywhere')).toBeVisible()
  await confirm.getByRole('button', { name: 'Disable' }).click()
  await expect(row.getByText('Inactive')).toBeVisible()

  await row.getByRole('button', { name: `Enable ${person.name}` }).click()
  await expect(row.getByText('Active', { exact: true })).toBeVisible()

  await admin.goto('/admin/audit')
  await admin.getByLabel('Action', { exact: true }).selectOption('admin_user_deactivated')
  await admin.getByRole('button', { name: 'Search' }).click()
  const event = admin.getByRole('listitem').filter({ hasText: 'Admin user deactivated' }).first()
  await expect(event).toBeVisible()
  await expect(event).toContainText('Admin User')
  await event.getByRole('button', { name: 'Details' }).click()
  await expect(event.getByText('Event', { exact: true })).toBeVisible()
  await admin.context().close()
})

test('the approvals inbox approves a task its assignee asked to have reviewed', async ({ browser }) => {
  const admin = await signedInPage(browser, ADMIN)
  const user = await signedInPage(browser, USER)
  const title = `E2E review ${Date.now()}`

  const me = await (await user.request.get('/api/v2/auth/me')).json()
  const created = await admin.request.post('/api/v2/tasks', {
    data: { title, description: 'Waiting in the approvals inbox', assignedTo: [me.data._id], startDate: dateInput(), dueDate: dateInput(7) },
  })
  expect(created.status()).toBe(201)
  const taskId = (await created.json()).data._id
  expect((await user.request.post(`/api/v2/tasks/${taskId}/request-completion`, { data: {} })).status()).toBe(200)

  await admin.goto('/approvals')
  await expect(admin.getByRole('heading', { name: 'Approvals' })).toBeVisible()
  await expect(admin.getByRole('tab', { name: /^Tasks/ })).toHaveAttribute('aria-selected', 'true')
  const item = admin.getByRole('listitem').filter({ hasText: title })
  await expect(item).toBeVisible()
  await item.getByRole('button', { name: `Approve ${title}` }).click()
  await expect(admin.getByRole('status').filter({ hasText: `Approved "${title}"` })).toBeVisible()
  await expect(item).toHaveCount(0)

  const task = await (await admin.request.get(`/api/v2/tasks/${taskId}`)).json()
  expect(task.data.status).toBe('completed')

  await user.context().close()
  await admin.context().close()
})

// More than two pages of pending attendance (50 a page): the tab counts the whole queue, "Load more"
// brings the rest, and select-all with a bulk approve works on everything loaded, though one bulk
// request takes at most 100 records
test('the approvals inbox pages the attendance queue with Load more, and bulk-approves what is loaded', async ({ browser, request }) => {
  test.setTimeout(120_000)
  // Signing up may start a session of its own, so the admin signs in after it
  const subject = await registerAccount(request, 'Queue')
  expect((await request.post('/api/v2/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } })).status()).toBe(200)
  // 120 days of waiting attendance for one person
  for (let ago = 60; ago < 180; ago++) {
    const created = await request.post('/api/v2/attendance', {
      data: { user: subject.id, date: dateInput(-ago), status: 'present', approvalStatus: 'pending', remarks: 'Waiting in the queue' },
    })
    expect(created.status(), `record ${ago}`).toBe(201)
  }
  // What the inbox should count: the queue's total, without the days that belong to a leave request
  const queue = await (await request.get('/api/v2/attendance?approvalStatus=pending&reviewable=true&page=1&limit=200')).json()
  const waiting = (queue.data as Array<{ leaveRequestId?: string | null }>).filter((row) => !row.leaveRequestId).length
  expect(waiting).toBeGreaterThanOrEqual(120)
  expect(queue.pagination.total).toBeLessThanOrEqual(200)

  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/approvals?tab=attendance')
  await expect(admin.getByRole('tab', { name: /^Attendance/ })).toContainText(String(waiting))
  const items = admin.getByRole('tabpanel').getByRole('listitem')
  await expect(items).toHaveCount(50)
  await expect(admin.getByText(`Showing 50 of ${waiting} records`)).toBeVisible()
  // Select all means the ones loaded, while more are waiting to load
  await expect(admin.getByLabel('Select all 50 loaded records')).toBeVisible()

  await admin.getByRole('button', { name: 'Load more' }).click()
  await expect(items).toHaveCount(100)
  await expect(admin.getByText(`Showing 100 of ${waiting} records`)).toBeVisible()
  await admin.getByRole('button', { name: 'Load more' }).click()
  await expect(items).toHaveCount(waiting)
  await expect(admin.getByRole('button', { name: 'Load more' })).toHaveCount(0)

  await admin.getByLabel(`Select all ${waiting} records`).check()
  await admin.getByRole('button', { name: 'Approve selected' }).click()
  await admin.getByRole('dialog', { name: `Approve ${waiting} records?` }).getByRole('button', { name: 'Approve' }).click()
  await expect(admin.getByRole('status').filter({ hasText: /approved/ })).toBeVisible()

  // Everything of this person's is approved now, though no single request took them all
  await expect(admin.getByRole('listitem').filter({ hasText: subject.name })).toHaveCount(0)
  const after = await (await request.get(`/api/v2/attendance?user=${subject.id}&approvalStatus=pending&page=1&limit=1`)).json()
  expect(after.pagination.total).toBe(0)
  await admin.context().close()
})

test('someone who reviews nothing is sent home from the approvals inbox', async ({ browser }) => {
  const user = await signedInPage(browser, USER)
  await user.goto('/approvals')
  await expect(user).toHaveURL(/\/user$/)
  await user.context().close()
})

test('the contact reply box explains that email is not set up', async ({ browser, request }) => {
  const subject = `E2E question ${Date.now()}`
  const sent = await request.post('/api/v2/contact', {
    data: { name: 'Casey Visitor', email: `casey${Date.now()}@e2e.test`, subject, message: 'Do you have a plan for small teams?' },
  })
  expect(sent.status()).toBe(201)

  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/admin/messages')
  await admin.getByLabel('Search messages').fill(subject)
  const card = admin.getByRole('article', { name: subject })
  await expect(card).toBeVisible()

  await card.getByLabel('Status').selectOption('resolved')
  await expect(admin.getByRole('status').filter({ hasText: 'Marked as resolved' })).toBeVisible()

  await card.getByRole('button', { name: 'Reply' }).click()
  await expect(card.getByText("Email isn't set up on this server")).toBeVisible()
  await expect(card.getByRole('link', { name: 'Reply from my mail app' })).toHaveAttribute('href', /^mailto:casey/)
  await expect(card.getByRole('textbox')).toHaveCount(0)
  await admin.context().close()
})

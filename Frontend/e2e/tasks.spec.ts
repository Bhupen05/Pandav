import { expect, test, type Browser } from '@playwright/test'
import { ADMIN, USER, signIn, type Account } from './support/app'

const signedInPage = async (browser: Browser, account: Account) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, account)
  return page
}

// YYYY-MM-DD, `days` from today
const dateInput = (days = 0) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10)

test('a task goes from creation to approval: checklist, comment, file, request, approve', async ({ browser }) => {
  const title = `Tasks e2e ${Date.now()}`

  // The admin creates a task with a checklist for the user
  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/tasks')
  await admin.getByRole('button', { name: 'New Task' }).click()
  const form = admin.getByRole('dialog', { name: 'Create New Task' })
  // Empty required fields are named one by one, and nothing is sent
  await form.getByRole('button', { name: 'Create Task', exact: true }).click()
  await expect(form.getByText('Enter a title.')).toBeVisible()
  await expect(form.getByText('Choose at least one person for this task.')).toBeVisible()

  await form.getByLabel('Title').fill(title)
  await form.getByLabel('Description').fill('Created by the tasks browser test')
  await form.getByLabel('Start Date').fill(dateInput())
  await form.getByLabel('Due Date').fill(dateInput(2))
  // Both ends count: today to two days on is three days
  await expect(form.getByLabel('Estimated days')).toHaveValue('3')
  await form.getByRole('button', { name: 'Select users to assign' }).click()
  await form.getByLabel('Search people').fill(USER.email)
  await form.getByRole('checkbox', { name: new RegExp(USER.name) }).check()
  await form.getByRole('button', { name: '1 user selected' }).click()
  for (const step of ['Draft the outline', 'Review with the team']) {
    await form.getByLabel('New checklist item').fill(step)
    await form.getByLabel('New checklist item').press('Enter')
  }
  await form.getByRole('button', { name: 'Create Task', exact: true }).click()
  await expect(admin.getByRole('status').filter({ hasText: 'Task created.' })).toBeVisible()

  // Opening it from the list puts its id in the address
  await admin.getByRole('button', { name: title, exact: true }).click()
  await expect(admin.getByRole('dialog', { name: title })).toBeVisible()
  const taskId = new URL(admin.url()).searchParams.get('task')
  expect(taskId).toBeTruthy()

  // The user opens the link from their notification
  const user = await signedInPage(browser, USER)
  await user.goto(`/tasks?task=${taskId}`)
  const panel = user.getByRole('dialog', { name: title })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Created by the tasks browser test')).toBeVisible()

  // Ticks an item
  await panel.getByRole('checkbox', { name: 'Draft the outline' }).check()
  await expect(panel.getByText('1 of 2 done')).toBeVisible()
  await expect(panel.getByText(`Ticked by ${USER.name}`)).toBeVisible()

  // Comments
  await panel.getByLabel('Add a comment').fill('The outline is ready')
  await panel.getByRole('button', { name: 'Post comment' }).click()
  await expect(panel.getByText('The outline is ready')).toBeVisible()

  // Attaches a small text file
  await panel.getByLabel('Attach a file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Meeting notes') })
  await expect(panel.getByRole('button', { name: 'Download notes.txt' })).toBeVisible()

  // Asks for completion with a note
  await panel.getByRole('button', { name: 'Request completion' }).click()
  const request = user.getByRole('dialog', { name: 'Request completion' })
  await request.getByLabel('Note for the reviewer (optional)').fill('Everything is in the shared folder')
  await request.getByRole('button', { name: 'Send request' }).click()
  await expect(panel.getByText('Waiting for review', { exact: true })).toBeVisible()
  await expect(panel.getByText('“Everything is in the shared folder”')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Request completion' })).toHaveCount(0)

  // The admin sees it waiting, with the user's note, and approves it from the panel
  await admin.reload()
  const adminPanel = admin.getByRole('dialog', { name: title })
  await expect(adminPanel.getByText('“Everything is in the shared folder”')).toBeVisible()
  await expect(adminPanel.getByText('The outline is ready')).toBeVisible()
  await adminPanel.getByRole('button', { name: 'Approve' }).click()
  await expect(adminPanel.getByText(/approved by Admin User/)).toBeVisible()
  await expect(adminPanel.getByRole('button', { name: 'Approve' })).toHaveCount(0)

  // Closing the panel returns to the list, where the task now reads Completed
  await adminPanel.getByRole('button', { name: 'Close task details' }).click()
  await expect(adminPanel).toHaveCount(0)
  await expect(admin).not.toHaveURL(/task=/)

  // Search and the status pills narrow the list
  await admin.getByRole('searchbox', { name: 'Search tasks' }).fill(title)
  await expect(admin.getByRole('article')).toHaveCount(1)
  await expect(admin).toHaveURL(/[?&]q=Tasks/)
  await admin.getByRole('button', { name: /^Pending/ }).click()
  await expect(admin.getByRole('heading', { name: 'No tasks match' })).toBeVisible()
  await admin.getByRole('button', { name: /^Completed/ }).click()
  await expect(admin.getByRole('article')).toHaveCount(1)
  await expect(admin).toHaveURL(/status=completed/)
  await admin.getByRole('button', { name: 'Clear filters', exact: false }).first().click()
  await expect(admin).not.toHaveURL(/status=/)

  await admin.context().close()
  await user.context().close()
})

test('the task list is paged by the server, and the page lives in the address', async ({ browser, request }) => {
  const prefix = `Paged ${Date.now()}`

  // Twelve tasks through the API, so one page of ten isn't enough
  expect((await request.post('/api/v2/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } })).status()).toBe(200)
  const people = await (await request.get(`/api/v2/users?q=${encodeURIComponent(USER.email)}&isActive=true`)).json()
  const userId: string = people.data[0]._id
  for (let index = 1; index <= 12; index++) {
    const created = await request.post('/api/v2/tasks', {
      data: { title: `${prefix} ${index}`, description: 'Paging test', startDate: dateInput(), dueDate: dateInput(5), assignedTo: [userId] },
    })
    expect(created.status()).toBe(201)
  }

  const admin = await signedInPage(browser, ADMIN)
  await admin.goto(`/tasks?q=${encodeURIComponent(prefix)}`)
  const paging = admin.getByRole('navigation', { name: 'Pagination' })
  await expect(paging).toContainText('Showing 1–10 of 12')
  await expect(admin.getByRole('article')).toHaveCount(10)
  await expect(paging.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')

  await paging.getByRole('button', { name: 'Next page' }).click()
  await expect(admin).toHaveURL(/page=2/)
  await expect(paging).toContainText('Showing 11–12 of 12')
  await expect(admin.getByRole('article')).toHaveCount(2)
  await expect(paging.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')

  // A bigger page puts everything on one page, and the control stays in place
  await paging.getByLabel('Per page').selectOption('25')
  await expect(admin).not.toHaveURL(/page=/)
  await expect(admin.getByRole('article')).toHaveCount(12)
  await expect(paging).toContainText('Showing 1–12 of 12')

  // The same address brings the same page back
  await admin.goto(`/tasks?q=${encodeURIComponent(prefix)}&page=2`)
  await expect(admin.getByRole('article')).toHaveCount(2)

  await admin.context().close()
})

import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser } from '@playwright/test'
import { ADMIN, USER, adminApi, registerAccount, signIn, type Account } from './support/app'
import { FRONTEND_PORT } from './support/servers'

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

test('the assignee filter opened from a link names the person, not "Selected person"', async ({ browser, request }) => {
  await adminApi(request)
  const people = await (await request.get(`/api/v2/users?q=${encodeURIComponent(USER.email)}&isActive=true`)).json()
  const userId: string = people.data[0]._id

  const admin = await signedInPage(browser, ADMIN)
  await admin.goto(`/tasks?assignedTo=${userId}`)
  // The filter panel is open, and the picker's button reads the label and the person's name
  await expect(admin.getByRole('button', { name: `Assigned to ${USER.name}` })).toBeVisible()
  await expect(admin.getByText('Selected person')).toHaveCount(0)
  await admin.context().close()
})

// A leader and a member in a team an admin made, then the team is frozen. The accounts, the
// team and the second task are set up through the API (sign-ups and teams are not what this is
// about); everything the people do on /tasks is done in the browser.
test.describe.serial('a team leader and a member on /tasks, and a frozen team', () => {
  const stamp = Date.now()
  const title = `Leader task ${stamp}`
  const frozenTitle = `Frozen task ${stamp}`
  let leader: Account & { id: string }
  let member: Account & { id: string }
  let teamId = ''
  let adminSession: APIRequestContext

  const baseURL = `http://localhost:${FRONTEND_PORT}`
  const apiAs = async (account: Account) => {
    const api = await playwrightRequest.newContext({ baseURL })
    expect((await api.post('/api/v2/auth/login', { data: { email: account.email, password: account.password } })).status(), `login ${account.email}`).toBe(200)
    return api
  }

  test.beforeAll(async () => {
    const api = await playwrightRequest.newContext({ baseURL })
    leader = await registerAccount(api, 'Leader')
    member = await registerAccount(api, 'Member')
    await api.dispose()

    adminSession = await apiAs(ADMIN)
    const team = await adminSession.post('/api/v2/teams', { data: { name: `Crew ${stamp}`, leaderId: leader.id } })
    expect(team.status(), 'create team').toBe(201)
    teamId = (await team.json()).data._id
    const invite = await adminSession.post(`/api/v2/teams/${teamId}/invite`, { data: { userId: member.id } })
    expect(invite.status(), 'invite').toBe(201)

    const memberApi = await apiAs(member)
    expect((await memberApi.put(`/api/v2/teams/invites/${(await invite.json()).data._id}/accept`)).status(), 'accept').toBe(200)
    await memberApi.dispose()
  })

  test.afterAll(async () => {
    await adminSession?.dispose()
  })

  test('the leader sees "Team tasks" and gives the member a task', async ({ browser }) => {
    const page = await signedInPage(browser, leader)
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: 'Team tasks' })).toBeVisible()

    await page.getByRole('button', { name: 'New Task' }).click()
    const form = page.getByRole('dialog', { name: 'Create New Task' })
    await form.getByLabel('Title').fill(title)
    await form.getByLabel('Description').fill('Given by the team leader')
    await form.getByLabel('Start Date').fill(dateInput())
    await form.getByLabel('Due Date').fill(dateInput(3))
    // A leader picks from the people in their team
    await form.getByRole('button', { name: 'Select users to assign' }).click()
    await form.getByLabel('Search people').fill(member.name)
    await form.getByRole('checkbox', { name: new RegExp(member.name) }).check()
    await form.getByRole('button', { name: '1 user selected' }).click()
    await form.getByRole('button', { name: 'Create Task', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Task created.' })).toBeVisible()

    const card = page.getByRole('article').filter({ hasText: title })
    await expect(card).toBeVisible()
    // The leader manages it, but it isn't theirs to approve until the member asks
    await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0)

    // The filter opened from a link names the member, from the leader's own team
    await page.goto(`/tasks?assignedTo=${member.id}`)
    await expect(page.getByRole('button', { name: `Assigned to ${member.name}` })).toBeVisible()
    await expect(page.getByText('Selected person')).toHaveCount(0)
    await page.context().close()
  })

  test('the member asks for completion, and the leader approves it from /tasks', async ({ browser }) => {
    const memberPage = await signedInPage(browser, member)
    await memberPage.goto('/tasks')
    await expect(memberPage.getByRole('heading', { name: 'My Tasks' })).toBeVisible()
    const mine = memberPage.getByRole('article').filter({ hasText: title })
    await mine.getByRole('button', { name: 'Request completion' }).click()
    await memberPage.getByRole('dialog', { name: 'Request completion' }).getByRole('button', { name: 'Send request' }).click()
    await expect(mine.getByText('Waiting for review')).toBeVisible()
    await expect(mine.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await memberPage.context().close()

    const leaderPage = await signedInPage(browser, leader)
    await leaderPage.goto('/tasks')
    const card = leaderPage.getByRole('article').filter({ hasText: title })
    await card.getByRole('button', { name: 'Approve' }).click()
    await expect(leaderPage.getByRole('status').filter({ hasText: 'Task completion approved' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    await expect(card.getByText('Completed', { exact: true }).first()).toBeVisible()
    await leaderPage.context().close()
  })

  test('once an admin freezes the team the leader cannot edit or approve, and the member can only work', async ({ browser }) => {
    // A second task, with a checklist, that the member has asked to have reviewed
    const leaderApi = await apiAs(leader)
    const created = await leaderApi.post('/api/v2/tasks', {
      data: {
        title: frozenTitle,
        description: 'Waiting for review when the team is frozen',
        startDate: dateInput(),
        dueDate: dateInput(3),
        assignedTo: [member.id],
        checklist: [{ text: 'First step' }, { text: 'Second step' }],
      },
    })
    expect(created.status(), 'create task').toBe(201)
    const taskId: string = (await created.json()).data._id
    await leaderApi.dispose()
    const memberApi = await apiAs(member)
    expect((await memberApi.post(`/api/v2/tasks/${taskId}/request-completion`, { data: {} })).status(), 'request completion').toBe(200)
    await memberApi.dispose()

    // Before the freeze the leader has Edit, Approve and a comment box
    const leaderPage = await signedInPage(browser, leader)
    await leaderPage.goto(`/tasks?task=${taskId}`)
    const before = leaderPage.getByRole('dialog', { name: frozenTitle })
    await expect(before.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect(before.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(before.getByLabel('Attach a file')).toBeVisible()
    await expect(before.getByLabel('Add a comment')).toBeVisible()

    // The admin freezes the team
    expect((await adminSession.put(`/api/v2/teams/${teamId}`, { data: { isActive: false } })).status(), 'freeze').toBe(200)

    // The leader's panel says so and offers nothing the server would refuse
    await leaderPage.reload()
    const frozen = leaderPage.getByRole('dialog', { name: frozenTitle })
    await expect(frozen.getByText('This team is frozen. Only an admin can change it.')).toBeVisible()
    for (const name of ['Edit', 'Approve', 'Reject', 'Delete', 'Cancel task']) {
      await expect(frozen.getByRole('button', { name, exact: true })).toHaveCount(0)
    }
    await expect(frozen.getByLabel('Attach a file')).toHaveCount(0)
    await expect(frozen.getByLabel('Add a comment')).toHaveCount(0)
    // The list agrees: no Edit or Approve on the card either
    await frozen.getByRole('button', { name: 'Close task details' }).click()
    const card = leaderPage.getByRole('article').filter({ hasText: frozenTitle })
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    // Nor can the leader give a frozen team new tasks
    await expect(leaderPage.getByRole('button', { name: 'New Task' })).toHaveCount(0)
    await leaderPage.context().close()

    // The member can't attach or comment either, but can still tick the checklist
    const memberPage = await signedInPage(browser, member)
    await memberPage.goto(`/tasks?task=${taskId}`)
    const panel = memberPage.getByRole('dialog', { name: frozenTitle })
    await expect(panel.getByText('This team is frozen. Only an admin can change it.')).toBeVisible()
    await expect(panel.getByLabel('Attach a file')).toHaveCount(0)
    await expect(panel.getByLabel('Add a comment')).toHaveCount(0)
    await panel.getByRole('checkbox', { name: 'First step' }).check()
    await expect(panel.getByText('1 of 2 done')).toBeVisible()
    await expect(panel.getByText(`Ticked by ${member.name}`)).toBeVisible()
    await memberPage.context().close()

    // An admin is not held back by the freeze
    const admin = await signedInPage(browser, ADMIN)
    await admin.goto(`/tasks?task=${taskId}`)
    const adminPanel = admin.getByRole('dialog', { name: frozenTitle })
    await expect(adminPanel.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect(adminPanel.getByLabel('Add a comment')).toBeVisible()
    await expect(adminPanel.getByText('This team is frozen. Only an admin can change it.')).toHaveCount(0)
    await admin.context().close()
  })
})

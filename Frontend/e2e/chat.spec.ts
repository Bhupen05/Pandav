import { expect, test, type Browser, type Page } from '@playwright/test'
import { ADMIN, USER, registerAccount, restartBackend, signIn, type Account } from './support/app'

// Signs in a separate browser and opens the conversation with `other`
const openConversation = async (browser: Browser, account: Account, other: Account) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, account)
  await page.goto('/chat')
  await page.getByRole('button', { name: other.name }).click()
  return page
}

const contact = (page: Page, account: Account) => page.getByRole('button', { name: account.name })

const send = async (page: Page, to: Account, text: string) => {
  await page.getByPlaceholder(`Message ${to.name}...`).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

// The messages on screen, and one of them by its text. (The text also appears
// in the conversation list as a preview, and in a hidden announcement.)
const thread = (page: Page) => page.getByRole('list', { name: 'Messages' })
const bubble = (page: Page, text: string) => thread(page).getByRole('listitem').filter({ hasText: text })

// Feedback's confirm dialogs are found by their title
const confirmDialog = (page: Page, title: string) => page.getByRole('dialog', { name: title })

test('chat messages arrive live, also after the backend restarts', async ({ browser }) => {
  // The user isn't in a team or connected with anyone, so the admin (who may
  // message anyone) writes first; after that the user can answer
  const admin = await openConversation(browser, ADMIN, USER)
  const welcome = `Welcome from the e2e test ${Date.now()}`
  await send(admin, USER, welcome)
  const user = await openConversation(browser, USER, ADMIN)
  await expect(bubble(user, welcome)).toBeVisible()
  // Each sees the other online once both sockets are connected
  await expect(contact(admin, USER)).toContainText('online')
  await expect(contact(user, ADMIN)).toContainText('online')

  const first = `Hello from the e2e test ${Date.now()}`
  await send(user, ADMIN, first)
  await expect(bubble(admin, first)).toBeVisible()

  // The sockets drop with the server (which clears who is online) and
  // reconnect with fresh tickets once it is back
  await restartBackend()
  await expect(contact(admin, USER)).toContainText('online', { timeout: 20_000 })
  await expect(contact(user, ADMIN)).toContainText('online', { timeout: 20_000 })

  const second = `Still here after a restart ${Date.now()}`
  await send(user, ADMIN, second)
  await expect(bubble(admin, second)).toBeVisible()
  const reply = `Got it ${Date.now()}`
  await send(admin, USER, reply)
  await expect(bubble(user, reply)).toBeVisible()

  await admin.context().close()
  await user.context().close()
})

test('a message that is edited and then deleted shows that on the other side', async ({ browser }) => {
  const admin = await openConversation(browser, ADMIN, USER)
  const user = await openConversation(browser, USER, ADMIN)
  const original = `Meet at nine ${Date.now()}`
  await send(admin, USER, original)
  await expect(bubble(user, original)).toBeVisible()
  await expect(bubble(user, original)).not.toContainText('(edited)')

  // Edit it: the other side sees the new text, marked as edited
  const edited = `Meet at ten ${Date.now()}`
  await bubble(admin, original).getByRole('button', { name: 'Message options' }).click()
  await admin.getByRole('menuitem', { name: 'Edit' }).click()
  await admin.getByRole('textbox', { name: 'Edit message' }).fill(edited)
  await admin.getByRole('button', { name: 'Save' }).click()
  await expect(bubble(admin, edited)).toContainText('(edited)')
  await expect(bubble(user, edited)).toContainText('(edited)')
  await expect(bubble(user, original)).toBeHidden()

  // Delete it: both sides show a placeholder instead of the text
  await bubble(admin, edited).getByRole('button', { name: 'Message options' }).click()
  await admin.getByRole('menuitem', { name: 'Delete' }).click()
  await confirmDialog(admin, 'Delete this message?').getByRole('button', { name: 'Delete' }).click()
  await expect(thread(admin).getByText('Message deleted')).toBeVisible()
  await expect(thread(user).getByText('Message deleted')).toBeVisible()
  await expect(bubble(user, edited)).toBeHidden()

  await admin.context().close()
  await user.context().close()
})

test('blocking someone stops them from messaging, until they are unblocked', async ({ browser }) => {
  // Nobody can block an admin, but an admin can block anyone
  const admin = await openConversation(browser, ADMIN, USER)
  const user = await openConversation(browser, USER, ADMIN)

  try {
    await admin.getByRole('button', { name: 'Block this person' }).click()
    await confirmDialog(admin, `Block ${USER.name}?`).getByRole('button', { name: 'Block', exact: true }).click()
    await expect(admin.getByText(/can't message each other until you unblock/)).toBeVisible()
    await expect(admin.getByPlaceholder(`Message ${USER.name}...`)).toBeHidden()

    // The server refuses the blocked person's message, and the page says so
    const refused = `This should not arrive ${Date.now()}`
    await send(user, ADMIN, refused)
    await expect(user.getByRole('alert').filter({ hasText: "can't message this person" })).toBeVisible()
    await expect(bubble(admin, refused)).toBeHidden()

    // Unblocking brings the message box back, and messages flow again
    await admin.getByRole('button', { name: 'Unblock this person' }).click()
    await confirmDialog(admin, `Unblock ${USER.name}?`).getByRole('button', { name: 'Unblock', exact: true }).click()
    await expect(admin.getByPlaceholder(`Message ${USER.name}...`)).toBeVisible()
    const allowed = `Back in touch ${Date.now()}`
    await send(user, ADMIN, allowed)
    await expect(bubble(admin, allowed)).toBeVisible()
  } finally {
    // A failed run must not leave the user blocked for the tests after it
    const contacts = await (await admin.request.get('/api/v2/users/chat-list')).json()
    const person = contacts.data.find((entry: { email: string }) => entry.email === USER.email)
    if (person) await admin.request.delete(`/api/v2/chat/blocks/${person._id}`)
    await admin.context().close()
    await user.context().close()
  }
})

test('the conversation list shows the last message, and keeps up with new ones', async ({ browser }) => {
  const admin = await openConversation(browser, ADMIN, USER)
  const first = `Preview text ${Date.now()}`
  await send(admin, USER, first)
  await expect(bubble(admin, first)).toBeVisible()

  // The person who wrote sees "You: ..."; the other person sees it unread
  const adminList = await (await browser.newContext()).newPage()
  await signIn(adminList, ADMIN)
  await adminList.goto('/chat')
  await expect(contact(adminList, USER)).toContainText(`You: ${first}`)

  const userList = await (await browser.newContext()).newPage()
  await signIn(userList, USER)
  await userList.goto('/chat')
  await expect(contact(userList, ADMIN)).toContainText(first)
  await expect(contact(userList, ADMIN)).toContainText('unread')

  // A later message replaces the preview without reloading the page
  const second = `Newer preview ${Date.now()}`
  await send(admin, USER, second)
  await expect(contact(userList, ADMIN)).toContainText(second)

  // Opening the conversation reads it
  await contact(userList, ADMIN).click()
  await expect(bubble(userList, second)).toBeVisible()
  await expect(contact(userList, ADMIN)).not.toContainText('unread')

  for (const page of [admin, adminList, userList]) await page.context().close()
})

test('everyone starts in Direct, and a link opens its conversation', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, ADMIN)
  await page.goto('/chat')
  await expect(page.getByRole('tab', { name: /^Direct/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: /^Team Chat/ })).toHaveAttribute('aria-selected', 'false')

  // /chat?user=<id> opens that person, as links from notifications do
  const contacts = await (await page.request.get('/api/v2/users/chat-list')).json()
  const person = contacts.data.find((entry: { email: string }) => entry.email === USER.email)
  await page.goto(`/chat?user=${person._id}`)
  await expect(page.getByRole('heading', { name: USER.name })).toBeVisible()
  await expect(page.getByPlaceholder(`Message ${USER.name}...`)).toBeVisible()
  await context.close()
})

test('/chat?user= for someone who is not a contact: no conversation means a plain refusal, an older one still opens', async ({ browser, request }) => {
  const stranger = await registerAccount(request, 'Stranger')
  const user = await (await browser.newContext()).newPage()
  await signIn(user, USER)
  const me = (await (await user.request.get('/api/v2/auth/me')).json()).data._id as string

  // Nobody the user can message, and no conversation with them: the page says so and leads back
  await user.goto(`/chat?user=${stranger.id}`)
  await expect(user.getByRole('heading', { name: "You can't message this person" })).toBeVisible()
  await expect(user.getByRole('heading', { name: "We couldn't find that person" })).toHaveCount(0)
  await user.getByRole('button', { name: 'Back to messages' }).click()
  await expect(user).toHaveURL(/\/chat$/)
  // A link that isn't an id at all reads the same
  await user.goto('/chat?user=not-an-id')
  await expect(user.getByRole('heading', { name: "You can't message this person" })).toBeVisible()

  // The user wrote to the stranger while they were connected; the stranger then blocked them. The
  // person has left the contacts (the rule makes anyone who wrote to you a contact, so only
  // someone you wrote to can drop out) but the conversation is still the user's to read.
  const other = await (await browser.newContext()).newPage()
  expect((await other.request.post('/api/v2/auth/login', { data: { email: stranger.email, password: stranger.password } })).status()).toBe(200)
  expect((await other.request.post('/api/v2/social/connections/request', { data: { userId: me } })).status()).toBeLessThan(300)
  expect((await user.request.post('/api/v2/social/connections/request', { data: { userId: stranger.id } })).status()).toBeLessThan(300)
  const text = `Are you there? ${Date.now()}`
  expect((await user.request.post('/api/v2/chat/send', { data: { receiverId: stranger.id, message: text } })).status()).toBe(201)
  expect((await other.request.post('/api/v2/chat/blocks', { data: { userId: me } })).status()).toBeLessThan(300)
  const contacts = await (await user.request.get('/api/v2/users/chat-list')).json()
  expect(contacts.data.some((entry: { _id: string }) => entry._id === stranger.id)).toBe(false)

  // The newest page of the list holds other people and says there are older ones, as for someone
  // with more than 50 conversations; the page after it is the server's own
  await user.route('**/api/v2/chat/conversations*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('before')) return route.continue()
    const newest = new Date(Date.now() + 60_000).toISOString()
    return route.fulfill({
      json: {
        success: true,
        count: 1,
        hasMore: true,
        data: [{
          user: { _id: 'a'.repeat(24), name: 'Newest Neighbour', role: 'user', department: null, profileImage: null, isActive: true, deleted: false },
          lastMessage: { _id: 'b'.repeat(24), text: 'Hi', at: newest, fromMe: false, isRead: true, deleted: false },
          unreadCount: 0,
          canMessage: true,
        }],
      },
    })
  })
  await user.goto(`/chat?user=${stranger.id}`)
  await expect(user.getByRole('heading', { name: stranger.name })).toBeVisible()
  await expect(thread(user).getByText(text)).toBeVisible()
  // They are in the list now, and the message box says nobody can write
  await expect(contact(user, stranger)).toBeVisible()
  await expect(user.getByPlaceholder(`Message ${stranger.name}...`)).toBeHidden()

  await user.context().close()
  await other.context().close()
})

test('on a phone the list and the conversation take turns', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } })
  const page = await context.newPage()
  await signIn(page, ADMIN)
  await page.goto('/chat')

  // The list alone, with no conversation squeezed beside it
  await expect(contact(page, USER)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to conversations' })).toBeHidden()
  await contact(page, USER).click()

  // The conversation alone, with a way back
  await expect(page.getByPlaceholder(`Message ${USER.name}...`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to conversations' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.getByRole('button', { name: 'Back to conversations' }).click()
  await expect(contact(page, USER)).toBeVisible()
  await expect(page.getByPlaceholder(`Message ${USER.name}...`)).toBeHidden()
  await context.close()
})

test('a team has its own chat room that an admin can join', async ({ browser, request }) => {
  const stamp = Date.now()
  const founder: Account = { name: `Chat Founder ${stamp}`, email: `chat-founder-${stamp}@e2e.test`, password: 'FounderPass123!' }
  expect((await request.post('/api/v2/auth/register', { data: founder })).status()).toBe(201)

  // The founder starts a team from the chat page and leads it
  const leader = await (await browser.newContext()).newPage()
  await signIn(leader, founder)
  await leader.goto('/chat')
  await leader.getByRole('tab', { name: /^Team Chat/ }).click()
  await leader.getByRole('button', { name: 'Create your team' }).click()
  const teamName = `Chat Crew ${stamp}`
  await leader.getByLabel('Team name').fill(teamName)
  await leader.getByRole('button', { name: 'Create team' }).click()
  await expect(leader.getByRole('heading', { name: teamName })).toBeVisible()
  const teamId = new URL(leader.url()).searchParams.get('team')
  expect(teamId).toBeTruthy()

  // An admin can open any team's room, and the leader sees what they write
  const admin = await (await browser.newContext()).newPage()
  await signIn(admin, ADMIN)
  await admin.goto('/chat')
  await admin.getByRole('tab', { name: /^Team Chat/ }).click()
  await admin.getByRole('button', { name: teamName }).click()
  const hello = `Hello team ${stamp}`
  await admin.getByPlaceholder(`Message ${teamName}...`).fill(hello)
  await admin.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(bubble(admin, hello)).toBeVisible()
  await expect(bubble(leader, hello)).toBeVisible()

  // The leader can remove other people's messages from the room
  await bubble(leader, hello).getByRole('button', { name: 'Message options' }).click()
  await leader.getByRole('menuitem', { name: 'Delete' }).click()
  await confirmDialog(leader, 'Delete this message?').getByRole('button', { name: 'Delete' }).click()
  await expect(thread(leader).getByText('Message deleted')).toBeVisible()
  await expect(bubble(leader, hello)).toBeHidden()

  await leader.context().close()
  await admin.context().close()
})

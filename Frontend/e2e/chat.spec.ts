import { expect, test, type Browser, type Page } from '@playwright/test'
import { ADMIN, USER, restartBackend, signIn, type Account } from './support/app'

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

test('chat messages arrive live, also after the backend restarts', async ({ browser }) => {
  // The user isn't in a team or connected with anyone, so the admin (who may
  // message anyone) writes first; after that the user can answer
  const admin = await openConversation(browser, ADMIN, USER)
  const welcome = `Welcome from the e2e test ${Date.now()}`
  await send(admin, USER, welcome)
  const user = await openConversation(browser, USER, ADMIN)
  await expect(user.getByText(welcome)).toBeVisible()
  // Each sees the other online once both sockets are connected
  await expect(contact(admin, USER)).toContainText('online')
  await expect(contact(user, ADMIN)).toContainText('online')

  const first = `Hello from the e2e test ${Date.now()}`
  await send(user, ADMIN, first)
  await expect(admin.getByText(first)).toBeVisible()

  // The sockets drop with the server (which clears who is online) and
  // reconnect with fresh tickets once it is back
  await restartBackend()
  await expect(contact(admin, USER)).toContainText('online', { timeout: 20_000 })
  await expect(contact(user, ADMIN)).toContainText('online', { timeout: 20_000 })

  const second = `Still here after a restart ${Date.now()}`
  await send(user, ADMIN, second)
  await expect(admin.getByText(second)).toBeVisible()
  const reply = `Got it ${Date.now()}`
  await send(admin, USER, reply)
  await expect(user.getByText(reply)).toBeVisible()

  await admin.context().close()
  await user.context().close()
})

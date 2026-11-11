import { expect, test, type Browser } from '@playwright/test'
import { ADMIN, linkIn, restartBackend, signIn, waitForMail, type Account } from './support/app'

// The emails of Pandav: the backend sends through a fake SMTP server (see
// Backend/test/e2e-server.js), so the links in them can be opened. Mail is
// switched on for this file only; the other specs run without it.
//
// One sign-up carries the account tests, in order: it signs up, can't sign in
// before it confirms its address, confirms it, and then forgets its password.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await restartBackend({ mail: true })
})

test.afterAll(async () => {
  await restartBackend()
})

const stamp = Date.now()
const person: Account = { name: 'Mia Mail', email: `mia-mail-${stamp}@e2e.test`, password: 'FirstPass123!' }
const VERIFY_SUBJECT = 'Confirm your email address'
const RESET_SUBJECT = 'Reset your Pandav password'
// The first confirmation link, replaced once a new one is asked for
let firstLink = ''
let newestLink = ''

const signedInPage = async (browser: Browser, account: Account) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, account)
  return page
}

test("an admin's reply to a contact message is emailed to the sender", async ({ browser, request }) => {
  const sender = `casey-mail-${stamp}@e2e.test`
  const subject = `E2E mail question ${stamp}`
  const question = 'Do you have a plan for small teams?'
  const answer = `Yes, the free plan covers up to ten people. (${stamp})`
  const sent = await request.post('/api/v2/contact', { data: { name: 'Casey Visitor', email: sender, subject, message: question } })
  expect(sent.status()).toBe(201)

  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/admin/messages')
  await admin.getByLabel('Search messages').fill(subject)
  const card = admin.getByRole('article', { name: subject })
  await expect(card).toBeVisible()

  await card.getByRole('button', { name: 'Reply' }).click()
  await expect(card.getByText("Email isn't set up on this server")).toHaveCount(0)
  await card.getByLabel('Your reply to Casey Visitor').fill(answer)
  await card.getByRole('button', { name: 'Send reply' }).click()
  await expect(admin.getByRole('status').filter({ hasText: `Reply sent to ${sender}` })).toBeVisible()

  const [mail] = await waitForMail(sender, `Re: ${subject}`)
  expect(mail.text).toContain(answer)
  // Their own message is quoted below the answer
  expect(mail.text).toContain(question)
  await admin.context().close()
})

test('signing up says to check your email, and the email has the link', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Full Name').fill(person.name)
  await page.getByLabel('Email').fill(person.email)
  // The labels carry a "*" for required fields
  await page.getByLabel(/^Password/).fill(person.password)
  await page.getByLabel(/^Confirm Password/).fill(person.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('status').filter({ hasText: 'Check your email' })).toBeVisible()

  const [mail] = await waitForMail(person.email, VERIFY_SUBJECT)
  expect(mail.text).toContain(person.email)
  firstLink = linkIn(mail, '/verify-email')
  newestLink = firstLink
})

test('when addresses must be confirmed, signing in explains it and can send the link again', async ({ page }) => {
  await restartBackend({ mail: true, verify: true })

  await page.goto('/login')
  await page.getByLabel('Email').fill(person.email)
  await page.getByLabel('Password', { exact: true }).fill(person.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('alert')).toContainText('Please confirm your email address first')
  await expect(page.getByText(`We sent a link to ${person.email}`)).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)

  await page.getByRole('button', { name: 'Send the link again' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'we\'ve emailed it a new link' })).toBeVisible()
  const mails = await waitForMail(person.email, VERIFY_SUBJECT, 2)
  newestLink = linkIn(mails[mails.length - 1], '/verify-email')
  expect(newestLink).not.toBe(firstLink)
})

test('the newest link confirms the address, and the profile then shows it as verified', async ({ page }) => {
  // A new link replaces the one before it
  await page.goto(firstLink)
  await expect(page.getByRole('alert')).toContainText('expired or was already used')

  await page.goto(newestLink)
  await expect(page.getByRole('status').filter({ hasText: `Your email address (${person.email}) is confirmed` })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Continue to sign in' })).toBeVisible()

  // Confirmed addresses may sign in again, although they are still required
  await signIn(page, person)
  await page.goto('/profile')
  await expect(page.getByText('Email verified', { exact: true })).toBeVisible()
  await expect(page.getByText('Email not verified')).toHaveCount(0)

  // A link works once
  await page.goto(newestLink)
  await expect(page.getByRole('alert')).toContainText('expired or was already used')
})

test('forgot password: the emailed link sets a new password that signs in', async ({ page, request }) => {
  const newPassword = 'SecondPass456!'
  await page.goto('/login')
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  // The page loads on demand: the sign-in form stays until it is there
  await expect(page.getByRole('heading', { name: 'Forgot password' })).toBeVisible()
  await page.getByLabel('Email').fill(person.email)
  await page.getByRole('button', { name: 'Send the link' }).click()
  await expect(page.getByRole('status')).toContainText("we've emailed it a link")

  const [mail] = await waitForMail(person.email, RESET_SUBJECT)
  const link = linkIn(mail, '/reset-password')
  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password').fill(newPassword)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('status').filter({ hasText: 'Your password has been changed' })).toBeVisible()

  // The old password is gone, the new one works
  const old = await request.post('/api/v2/auth/login', { data: { email: person.email, password: person.password } })
  expect(old.status()).toBe(401)
  await signIn(page, { ...person, password: newPassword })
  await expect(page).not.toHaveURL(/\/login/)

  // The link was used up: the page finds out when a password is sent with it
  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill('ThirdPass789!')
  await page.getByLabel('Confirm new password').fill('ThirdPass789!')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('alert')).toContainText('expired or was already used')
  await expect(page.getByRole('link', { name: 'Ask for a new link' })).toBeVisible()
})

import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADMIN, USER, signIn, signOut } from './support/app'

// The Social Hub with the two seeded accounts: the user posts and the admin
// comments, the author edits and deletes, a connection is asked for, accepted
// and removed, a post for GitHub waits for approval, and the admin moderates.

const stamp = Date.now()

const composer = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Compose update' }) })
const postCard = (page: Page, text: string) => page.locator('article', { hasText: text })

// The composer's chips hide their checkbox under the label, as people see it: click the label
const choose = async (control: Locator) => {
  await control.locator('xpath=..').click()
  await expect(control).toBeChecked()
}

async function writePost(page: Page, text: string, { github = false } = {}) {
  await page.goto('/social')
  const form = composer(page)
  await form.getByLabel('Post', { exact: true }).fill(text)
  if (github) await choose(form.getByRole('checkbox', { name: 'GitHub' }))
  await form.getByRole('button', { name: 'Create post' }).click()
  await expect(postCard(page, text)).toBeVisible()
}

test('a user posts and another comments, with their name shown', async ({ page }) => {
  const text = `Release notes ${stamp}`
  await signIn(page, USER)
  await writePost(page, text)
  const id = (await postCard(page, text).getAttribute('id'))?.replace('post-', '')
  expect(id).toBeTruthy()
  await signOut(page, USER)

  // A link to the post (as in a notification) opens it, highlighted
  await signIn(page, ADMIN)
  await page.goto(`/social?post=${id}`)
  const card = postCard(page, text)
  await expect(card).toHaveAttribute('data-highlighted', 'true')
  await expect(card.getByText('Demo User').first()).toBeVisible()

  await card.getByLabel(/^Comment on/).fill('Nice work')
  await card.getByRole('button', { name: 'Comment', exact: true }).click()
  const comments = card.getByRole('list', { name: 'Comments' })
  await expect(comments).toContainText('Admin User')
  await expect(comments).toContainText('Nice work')

  // After a reload the server still names the commenter
  await page.reload()
  await expect(postCard(page, text).getByRole('list', { name: 'Comments' })).toContainText('Admin User')
})

test('the author edits a post, then deletes it', async ({ page }) => {
  const text = `Draft ${stamp}`
  const edited = `Final ${stamp}`
  await signIn(page, USER)
  await writePost(page, text)

  await postCard(page, text).getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit your post' })
  await dialog.getByLabel('Post', { exact: true }).fill(edited)
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()
  await expect(postCard(page, edited)).toContainText('edited')
  await expect(postCard(page, text)).toHaveCount(0)

  await postCard(page, edited).getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete this post?' }).getByRole('button', { name: 'Delete post' }).click()
  await expect(postCard(page, edited)).toHaveCount(0)

  // It is gone for good
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Social feed' })).toBeVisible()
  await expect(postCard(page, edited)).toHaveCount(0)
})

test('a connection request is accepted, then removed', async ({ page }) => {
  await signIn(page, USER)
  await page.goto('/network')
  await page.getByLabel('Search by name').fill('Admin User')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const find = page.locator('section', { has: page.getByRole('heading', { name: 'Find people' }) })
  await find.getByRole('button', { name: 'Connect with Admin User' }).click()
  await expect(find.getByText('Request sent')).toBeVisible()
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Requests' }) })).toContainText('Requests you sent')
  await signOut(page, USER)

  await signIn(page, ADMIN)
  await page.goto('/network')
  await page.getByRole('button', { name: 'Accept Demo User' }).first().click()
  const connections = page.locator('section', { has: page.getByRole('heading', { name: 'Your connections' }) })
  await expect(connections).toContainText('Demo User')

  await connections.getByRole('button', { name: 'Remove Demo User' }).click()
  await page.getByRole('dialog', { name: 'Remove Demo User?' }).getByRole('button', { name: 'Remove connection' }).click()
  await expect(connections.getByText('You aren’t connected with anyone yet.')).toBeVisible()
})

test('a post for GitHub waits for approval until an admin approves it', async ({ page }) => {
  const text = `For GitHub ${stamp}`
  await signIn(page, USER)
  await writePost(page, text, { github: true })
  const own = postCard(page, text)
  await expect(own).toContainText('Awaiting approval')
  await expect(own).toContainText('Only the author and admins can see this post until it is approved.')
  await signOut(page, USER)

  await signIn(page, ADMIN)
  await page.goto('/social')
  const waiting = page.locator('section', { has: page.getByRole('heading', { name: 'Waiting for your approval' }) })
  await expect(waiting).toContainText(text)
  await waiting.locator('li', { hasText: text }).getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Post approved.')).toBeVisible()
  await expect(waiting.locator('li', { hasText: text })).toHaveCount(0)
  // The post in the feed shows the decision, and nothing was sent to GitHub
  await expect(postCard(page, text)).not.toContainText('Awaiting approval')
  await expect(postCard(page, text)).toContainText('Not on GitHub yet.')
})

test('an admin flags and unflags a post from Moderation, then hides it for the author to see why', async ({ page }) => {
  const text = `Moderate me ${stamp}`
  await signIn(page, USER)
  await writePost(page, text)
  await signOut(page, USER)

  await signIn(page, ADMIN)
  await page.goto('/admin/moderation')
  const row = page.locator('li', { hasText: text })
  await row.getByRole('button', { name: 'Flag the post by Demo User' }).click()
  const flag = page.getByRole('dialog', { name: 'Flag this post?' })
  await flag.getByLabel(/^Reason/).fill('Needs a second look')
  await flag.getByRole('button', { name: 'Flag', exact: true }).click()
  await expect(row).toContainText('Flagged')
  await expect(row).toContainText('Needs a second look')
  // Only the moves that fit a flagged post are offered
  await expect(row.getByRole('button', { name: /^Flag the post/ })).toHaveCount(0)

  await row.getByRole('button', { name: 'Unflag the post by Demo User' }).click()
  await page.getByRole('dialog', { name: 'Unflag this post?' }).getByRole('button', { name: 'Unflag', exact: true }).click()
  await expect(row).toContainText('Normal')
  await expect(row).not.toContainText('Needs a second look')

  await row.getByRole('button', { name: 'Hide the post by Demo User' }).click()
  const hide = page.getByRole('dialog', { name: 'Hide this post?' })
  await hide.getByLabel(/^Reason/).fill('Mentions a customer')
  await hide.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect(row).toContainText('Hidden')
  // The row buttons are named after their authors (Admin User among them), so leave the list before the sign-out helper looks for a button with the admin's name
  await page.goto('/notifications')
  await signOut(page, ADMIN)

  // The author finds it among their own posts, marked, with the reason
  await signIn(page, USER)
  await page.goto('/social')
  await page.getByRole('button', { name: 'My posts' }).click()
  const own = postCard(page, text)
  await expect(own).toContainText('Hidden by an admin')
  await expect(own).toContainText('Mentions a customer')
})

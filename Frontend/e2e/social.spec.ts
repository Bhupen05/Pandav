import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADMIN, USER, registerAccount, signIn, signOut } from './support/app'

// The Social Hub with the two seeded accounts: the user posts and the admin
// comments, the author edits and deletes, a post carries links, a connection is
// asked for, accepted and removed, a post for GitHub waits for approval, and the
// admin moderates posts and handles reported chat messages.

const stamp = Date.now()

const composer = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Compose update' }) })
const postCard = (page: Page, text: string) => page.locator('article', { hasText: text })

// The composer's chips hide their checkbox under the label, as people see it: click the label
const choose = async (control: Locator) => {
  await control.locator('xpath=..').click()
  await expect(control).toBeChecked()
}

// The filter's radio buttons hide under their labels too
const show = async (radio: Locator) => {
  await radio.locator('xpath=..').click()
  await expect(radio).toBeChecked()
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
test('a post carries links that open safely, and a link can be removed again', async ({ page }) => {
  const text = `With links ${stamp}`
  await signIn(page, USER)
  await page.goto('/social')
  const form = composer(page)
  await form.getByLabel('Post', { exact: true }).fill(text)

  // Only full https addresses are taken, and the reason is said
  const field = form.getByLabel(/^Links/)
  const add = form.getByRole('button', { name: 'Add link' })
  await field.fill('http://example.com/plain')
  await add.click()
  await expect(form.getByRole('alert').filter({ hasText: 'https://' })).toBeVisible()
  await field.fill('example.com')
  await add.click()
  await expect(form.getByRole('alert')).toContainText('full web address')
  await field.fill('javascript:alert(1)')
  await add.click()
  await expect(form.getByRole('alert')).toContainText('https://')
  await expect(form.getByRole('list', { name: 'Added links' })).toHaveCount(0)

  // Enter adds a link instead of posting; a link still in the box when the post is sent is kept too
  await field.fill('https://example.com/docs/release-notes?v=2')
  await field.press('Enter')
  await expect(form.getByRole('list', { name: 'Added links' })).toContainText('example.com/docs/release-notes?v=2')
  await expect(field).toHaveValue('')
  await field.fill('https://example.com/docs/release-notes?v=2')
  await add.click()
  await expect(form.getByRole('alert')).toContainText('already added')
  await field.fill('https://example.org/second')
  await form.getByRole('button', { name: 'Create post' }).click()

  const card = postCard(page, text)
  await expect(card).toBeVisible()
  const first = card.getByRole('link', { name: /example\.com\/docs\/release-notes\?v=2/ })
  await expect(first).toHaveAttribute('href', 'https://example.com/docs/release-notes?v=2')
  await expect(first).toHaveAttribute('target', '_blank')
  await expect(first).toHaveAttribute('rel', 'noopener noreferrer')
  const second = card.getByRole('link', { name: /example\.org\/second/ })
  await expect(second).toHaveAttribute('href', 'https://example.org/second')
  // The composer starts over
  await expect(form.getByRole('list', { name: 'Added links' })).toHaveCount(0)

  // The server kept both
  await page.reload()
  await expect(postCard(page, text).getByRole('link')).toHaveCount(2)

  // Editing shows the links and removes one; the other stays
  await postCard(page, text).getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit your post' })
  await expect(dialog.getByRole('list', { name: 'Added links' }).getByRole('listitem')).toHaveCount(2)
  await dialog.getByRole('button', { name: /^Remove the link example\.com/ }).click()
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()
  await expect(postCard(page, text).getByRole('link', { name: /example\.com/ })).toHaveCount(0)
  await expect(postCard(page, text).getByRole('link', { name: /example\.org\/second/ })).toBeVisible()

  // Removing the last one leaves a post without links
  await postCard(page, text).getByRole('button', { name: 'Edit', exact: true }).click()
  await dialog.getByRole('button', { name: /^Remove the link example\.org/ }).click()
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()
  await expect(postCard(page, text).getByRole('list', { name: 'Links' })).toHaveCount(0)
  await page.reload()
  await expect(postCard(page, text)).toBeVisible()
  await expect(postCard(page, text).getByRole('link')).toHaveCount(0)
})

test('a link that is not https is shown as text and never opened', async ({ page }) => {
  const text = `Older link ${stamp}`
  await signIn(page, USER)
  // The server still takes http links (older posts have them); the page doesn't open them
  const created = await page.request.post('/api/v2/social/posts', { data: { content: text, mediaUrls: ['http://insecure.example/page'] } })
  expect(created.status()).toBe(201)
  await page.goto('/social')
  const card = postCard(page, text)
  await expect(card.getByRole('list', { name: 'Links' })).toContainText('insecure.example/page')
  await expect(card.getByRole('link')).toHaveCount(0)
})

test('the Moderation author filter finds a person by name and shows who it is set to', async ({ page, request }) => {
  const author = await registerAccount(request, 'Filtered Writer')
  const text = `Posted by the filtered author ${stamp}`
  await signIn(page, author)
  await writePost(page, text)
  await signOut(page, author)
  await signIn(page, USER)
  await writePost(page, `Posted by someone else ${stamp}`)
  await signOut(page, USER)

  await signIn(page, ADMIN)
  await page.goto('/admin/moderation')
  const posts = page.locator('section', { has: page.getByRole('heading', { name: 'Posts', exact: true }) })
  await expect(posts.locator('li', { hasText: `Posted by someone else ${stamp}` })).toBeVisible()

  const search = posts.getByRole('combobox', { name: 'Author' })
  await search.fill('F')
  await expect(posts.getByText('Type at least 2 characters.')).toBeVisible()
  await search.fill(author.name)
  await posts.getByRole('option', { name: new RegExp(author.name) }).click()
  // The chosen name shows, and only that person's posts are listed
  const chosen = posts.getByRole('group', { name: 'Author' })
  await expect(chosen).toContainText(author.name)
  await expect(posts.locator('li', { hasText: text })).toBeVisible()
  await expect(posts.locator('li', { hasText: `Posted by someone else ${stamp}` })).toHaveCount(0)
  await expect(posts.locator('li[id^="moderate-"]')).toHaveCount(1)

  // Taking the choice back lists everyone again
  await chosen.getByRole('button', { name: /Show posts by everyone/ }).click()
  await expect(search).toBeFocused()
  await expect(posts.locator('li', { hasText: `Posted by someone else ${stamp}` })).toBeVisible()

  // The search leaves the caller out, so admins are offered themselves when the text fits
  await search.fill('Admin Us')
  await posts.getByRole('option', { name: /Admin User \(you\)/ }).click()
  await expect(posts.getByRole('group', { name: 'Author' })).toContainText('Admin User')
  // The row buttons are named after their authors, so leave the list before the sign-out helper looks for a button with the admin's name
  await page.goto('/notifications')
  await signOut(page, ADMIN)
})

test('an admin marks a reported message as handled, and reopens it', async ({ browser }) => {
  const text = `Please report this ${stamp}`
  const admin = await (await browser.newContext()).newPage()
  await signIn(admin, ADMIN)
  const user = await (await browser.newContext()).newPage()
  await signIn(user, USER)

  // The admin writes to the user (an admin may message anyone); the user reports it
  const me = await (await user.request.get('/api/v2/auth/me')).json()
  expect((await admin.request.post('/api/v2/chat/send', { data: { receiverId: me.data._id, message: text } })).status()).toBe(201)
  await user.goto('/chat')
  await user.getByRole('button', { name: ADMIN.name }).click()
  const bubble = user.getByRole('list', { name: 'Messages' }).getByRole('listitem').filter({ hasText: text })
  await expect(bubble).toBeVisible()
  await bubble.getByRole('button', { name: 'Message options' }).click()
  await user.getByRole('menuitem', { name: 'Report' }).click()
  const report = user.getByRole('dialog', { name: 'Report this message?' })
  await report.getByLabel('What is wrong with it?').fill('Not for this chat')
  await report.getByRole('button', { name: 'Report', exact: true }).click()
  await expect(user.getByText('Thanks for telling us.')).toBeVisible()

  // It is on the admin's Open list, with the reason
  await admin.goto('/admin/moderation?tab=messages')
  const section = admin.locator('section', { has: admin.getByRole('heading', { name: 'Reported messages' }) })
  await expect(section.getByRole('radio', { name: 'Open' })).toBeChecked()
  const row = section.locator('li', { hasText: text })
  await expect(row).toBeVisible()
  await row.getByText(/^Who reported it/).click()
  await expect(row).toContainText('Not for this chat')

  // Mark it as handled, with a note: it leaves Open
  await row.getByRole('button', { name: 'Mark as handled' }).click()
  const ask = admin.getByRole('dialog', { name: 'Mark as handled?' })
  await ask.getByLabel('Note (optional)').fill('Spoke to the sender')
  await ask.getByRole('button', { name: 'Mark as handled' }).click()
  await expect(admin.getByText('Marked as handled.')).toBeVisible()
  await expect(section.locator('li', { hasText: text })).toHaveCount(0)

  // It shows under Resolved, with who handled it and the note
  await show(section.getByRole('radio', { name: 'Resolved' }))
  const resolved = section.locator('li', { hasText: text })
  await expect(resolved).toBeVisible()
  await expect(resolved).toContainText('Handled by Admin User')
  await expect(resolved).toContainText('Spoke to the sender')
  await expect(resolved.getByRole('button', { name: 'Mark as handled' })).toHaveCount(0)

  // After a reload the server still has it there
  await admin.reload()
  await show(section.getByRole('radio', { name: 'Resolved' }))
  await expect(section.locator('li', { hasText: text })).toBeVisible()

  // Reopen it: back under Open, and gone from Resolved
  await section.locator('li', { hasText: text }).getByRole('button', { name: 'Reopen' }).click()
  await expect(admin.getByText('Reopened.')).toBeVisible()
  await expect(section.locator('li', { hasText: text })).toHaveCount(0)
  await show(section.getByRole('radio', { name: 'Open' }))
  await expect(section.locator('li', { hasText: text })).toBeVisible()

  await admin.context().close()
  await user.context().close()
})

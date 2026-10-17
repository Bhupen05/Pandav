import { expect, test } from '@playwright/test'
import { signIn, type Account } from './support/app'

// Anyone can start a team and lead it: invite people, give them tasks, and
// edit or delete those tasks. An edited task says who changed it and when.
test('a user starts a team, and edits and deletes a task for a member', async ({ browser, request }) => {
  const stamp = Date.now()
  const founder: Account = { name: `Founder ${stamp}`, email: `founder-${stamp}@e2e.test`, password: 'FounderPass123!' }
  const member: Account = { name: `Member ${stamp}`, email: `member-${stamp}@e2e.test`, password: 'MemberPass123!' }
  for (const account of [founder, member]) {
    expect((await request.post('/api/v2/auth/register', { data: account })).status()).toBe(201)
  }

  const page = await (await browser.newContext()).newPage()
  // confirm() before deleting; alert() after inviting
  page.on('dialog', (dialog) => dialog.accept())
  await signIn(page, founder)

  // Start a team
  await page.getByRole('link', { name: 'Team', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Create your team' })).toBeVisible()
  await page.getByRole('button', { name: 'Create Team' }).click()
  const teamName = `Crew ${stamp}`
  await page.getByLabel('Team Name').fill(teamName)
  await page.locator('form').getByRole('button', { name: 'Create Team' }).click()
  await expect(page.getByRole('heading', { name: teamName })).toBeVisible()

  // Invite the member, who accepts from their own team page
  await page.getByRole('button', { name: 'members', exact: true }).click()
  await page.getByRole('button', { name: '+ Invite Member' }).click()
  await page.getByPlaceholder('Username or user id').fill(member.name)
  await page.getByRole('button', { name: 'Send Invite' }).click()
  await expect(page.getByRole('button', { name: 'Send Invite' })).toBeHidden()

  const memberPage = await (await browser.newContext()).newPage()
  await signIn(memberPage, member)
  await memberPage.goto('/teams')
  await memberPage.getByRole('button', { name: 'Accept' }).click()
  await expect(memberPage).toHaveURL(/\/team-member/)
  await memberPage.context().close()

  // Give the member a task
  await page.reload()
  await page.getByRole('button', { name: 'tasks', exact: true }).click()
  await page.getByRole('button', { name: '+ Create Task' }).click()
  await page.getByLabel('Title').fill('Write the brief')
  await page.getByLabel('Description').fill('One page')
  await page.getByLabel('Assign To').selectOption({ label: member.name })
  await page.getByLabel('Start Date').fill('2026-10-01')
  await page.getByLabel('Due Date').fill('2026-10-20')
  await page.getByRole('button', { name: 'Create Task', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: 'Write the brief' })
  await expect(row).toBeVisible()
  await expect(row).not.toContainText('Edited by')

  // Edit it: the row now says who edited it
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Title').fill('Write the short brief')
  await page.getByRole('button', { name: 'Save Changes' }).click()
  const editedRow = page.getByRole('row').filter({ hasText: 'Write the short brief' })
  await expect(editedRow).toContainText(`Edited by ${founder.name}`)

  // And delete it
  await editedRow.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Write the short brief')).toBeHidden()

  await page.context().close()
})

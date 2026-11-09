import { expect, request, test, type Browser } from '@playwright/test'
import { ADMIN, signIn, type Account } from './support/app'
import { FRONTEND_PORT } from './support/servers'

// The team pages, from three sides: a leader who starts a team and works with
// it, someone who is invited, and an admin who manages every team. The three
// accounts are made once (sign-ups are limited) and the tests run in order.
test.describe.serial('teams', () => {
  const stamp = Date.now()
  const founder: Account = { name: `Founder ${stamp}`, email: `founder-${stamp}@e2e.test`, password: 'FounderPass123!' }
  const member: Account = { name: `Member ${stamp}`, email: `member-${stamp}@e2e.test`, password: 'MemberPass123!' }
  const invitee: Account = { name: `Invitee ${stamp}`, email: `invitee-${stamp}@e2e.test`, password: 'InviteePass123!' }
  const teamName = `Crew ${stamp}`

  const signedInPage = async (browser: Browser, account: Account) => {
    const page = await (await browser.newContext()).newPage()
    await signIn(page, account)
    return page
  }

  test.beforeAll(async () => {
    const api = await request.newContext({ baseURL: `http://localhost:${FRONTEND_PORT}` })
    for (const account of [founder, member, invitee]) {
      expect((await api.post('/api/v2/auth/register', { data: account })).status()).toBe(201)
    }
    await api.dispose()
  })

  // Anyone can start a team and lead it: invite people, give them tasks, and
  // edit or delete those tasks. An edited task says who changed it and when.
  test('a user starts a team, invites a member found by name, and edits and deletes a task', async ({ browser }) => {
    const page = await signedInPage(browser, founder)

    // Start a team
    await page.getByRole('link', { name: 'Team', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: 'Create your team' })).toBeVisible()
    await page.getByRole('button', { name: 'Create Team' }).click()
    await page.getByLabel('Team Name').fill(teamName)
    await page.locator('form').getByRole('button', { name: 'Create Team' }).click()
    await expect(page.getByRole('heading', { name: teamName })).toBeVisible()

    // Invite the member: search by name, pick, send
    await page.getByRole('tab', { name: 'members' }).click()
    await page.getByRole('button', { name: '+ Invite Member' }).click()
    const invite = page.getByRole('dialog', { name: /Invite to/ })
    await invite.getByLabel('Find a person').fill(member.name)
    await invite.getByRole('radio', { name: new RegExp(member.name) }).check()
    await invite.getByRole('button', { name: 'Send Invite' }).click()
    await expect(invite).toBeHidden()

    // They accept from their own team page
    const memberPage = await signedInPage(browser, member)
    await memberPage.goto('/teams')
    await memberPage.getByRole('button', { name: 'Accept' }).click()
    await expect(memberPage).toHaveURL(/\/team-member/)
    await expect(memberPage.getByRole('heading', { name: teamName })).toBeVisible()
    await expect(memberPage.getByRole('link', { name: 'Open team chat' })).toHaveAttribute('href', /\/chat\?team=/)

    // Give the member a task
    await page.reload()
    await page.getByRole('tab', { name: /^tasks/ }).click()
    await page.getByRole('button', { name: '+ Create Task' }).click()
    const form = page.getByRole('dialog', { name: 'Create Team Task' })
    await form.getByLabel('Title').fill('Write the brief')
    await form.getByLabel('Description').fill('One page')
    await form.getByRole('group', { name: 'Assign To' }).getByLabel(member.name).check()
    await form.getByLabel('Start Date').fill('2026-10-01')
    await form.getByLabel('Due Date').fill('2026-10-20')
    await form.getByRole('button', { name: 'Create Task', exact: true }).click()
    await expect(form).toBeHidden()
    const row = page.getByRole('row').filter({ hasText: 'Write the brief' })
    await expect(row).toBeVisible()
    await expect(row).not.toContainText('Edited by')
    await expect(row.getByRole('link', { name: 'Write the brief' })).toHaveAttribute('href', /\/tasks\?task=/)

    // The member sees it on their page, linked to the task
    await memberPage.reload()
    await expect(memberPage.getByRole('link', { name: 'Write the brief' })).toHaveAttribute('href', /\/tasks\?task=/)
    await memberPage.context().close()

    // Edit it: the row now says who edited it
    await row.getByRole('button', { name: /^Edit/ }).click()
    const edit = page.getByRole('dialog', { name: 'Edit Task' })
    await edit.getByLabel('Title').fill('Write the short brief')
    await edit.getByRole('button', { name: 'Save Changes' }).click()
    await expect(edit).toBeHidden()
    const editedRow = page.getByRole('row').filter({ hasText: 'Write the short brief' })
    await expect(editedRow).toContainText(`Edited by ${founder.name}`)

    // And delete it, after the confirmation
    await editedRow.getByRole('button', { name: /^Delete/ }).click()
    await page.getByRole('dialog', { name: 'Delete this task?' }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Write the short brief')).toBeHidden()

    await page.context().close()
  })

  // Invites: sent from a search, withdrawn, sent again by email; the invited
  // person accepts, and later leaves
  test('a leader withdraws an invite, and the invitee accepts another and then leaves', async ({ browser }) => {
    const page = await signedInPage(browser, founder)
    await page.goto('/teams?tab=members')

    // Invite the invitee, found through the search
    await page.getByRole('button', { name: '+ Invite Member' }).click()
    const invite = page.getByRole('dialog', { name: /Invite to/ })
    await invite.getByLabel('Find a person').fill(invitee.name)
    await invite.getByRole('radio', { name: new RegExp(invitee.name) }).check()
    await invite.getByRole('button', { name: 'Send Invite' }).click()
    await expect(invite).toBeHidden()

    // The invite is listed as waiting; withdraw it
    await page.getByRole('tab', { name: /^invites sent/ }).click()
    const waiting = page.getByRole('listitem').filter({ hasText: invitee.name })
    await expect(waiting).toContainText('Waiting for an answer')
    await waiting.getByRole('button', { name: 'Withdraw' }).click()
    await page.getByRole('dialog', { name: 'Withdraw this invite?' }).getByRole('button', { name: 'Withdraw' }).click()
    await expect(waiting).toContainText('Withdrawn')
    await expect(waiting.getByRole('button', { name: /Withdraw/ })).toHaveCount(0)

    // Invite again, by email this time
    await page.getByRole('button', { name: '+ Invite Member' }).click()
    const again = page.getByRole('dialog', { name: /Invite to/ })
    await again.getByLabel('Or invite by email').fill(invitee.email)
    await again.getByRole('button', { name: 'Invite by email' }).click()
    await expect(again).toBeHidden()
    await expect(page.getByRole('listitem').filter({ hasText: 'Waiting for an answer' })).toHaveCount(1)

    // The invitee sees only the new invite, and accepts it
    const inviteePage = await signedInPage(browser, invitee)
    await inviteePage.goto('/teams')
    await expect(inviteePage.getByRole('button', { name: /^Accept/ })).toHaveCount(1)
    await inviteePage.getByRole('button', { name: /^Accept/ }).click()
    await expect(inviteePage).toHaveURL(/\/team-member/)
    await expect(inviteePage.getByRole('heading', { name: teamName })).toBeVisible()

    // Later they leave, after the confirmation, and land on the page for people without a team
    await inviteePage.getByRole('button', { name: 'Leave team' }).click()
    await inviteePage.getByRole('dialog', { name: 'Leave this team?' }).getByRole('button', { name: 'Leave team' }).click()
    await expect(inviteePage).toHaveURL(/\/teams/)
    await expect(inviteePage.getByRole('heading', { name: 'Create your team' })).toBeVisible()
    await inviteePage.context().close()

    // The leader no longer lists them among the people
    await page.reload()
    await page.getByRole('tab', { name: 'members' }).click()
    await expect(page.getByRole('heading', { name: 'Team Members (2)' })).toBeVisible()
    await expect(page.getByText(invitee.name)).toBeHidden()

    await page.context().close()
  })

  // Admins manage every team: eligible people only, freezing, and a delete
  // that says what it does
  test('an admin creates, freezes and deletes a team', async ({ browser }) => {
    const adminTeam = `Admin team ${stamp}`
    const page = await signedInPage(browser, ADMIN)

    // Admins have no team of their own: /teams is the management page
    await page.goto('/teams')
    await expect(page).toHaveURL(/\/admin\/teams/)

    // Create a team for the invitee, who is a user without a team
    await page.getByRole('button', { name: '+ Create Team' }).click()
    const create = page.getByRole('dialog', { name: 'Create New Team' })
    await create.getByLabel('Team Name').fill(adminTeam)
    // People already in a team are not offered
    await create.getByLabel('Team Leader').fill(member.name)
    await expect(create.getByText(`Nobody matches "${member.name}".`)).toBeVisible()
    await create.getByLabel('Team Leader').fill(invitee.name)
    await create.getByRole('radio', { name: new RegExp(invitee.name) }).check()
    await create.getByRole('button', { name: 'Create Team' }).click()
    await expect(create).toBeHidden()
    const card = page.getByRole('article').filter({ hasText: adminTeam })
    await expect(card).toBeVisible()
    // A team's only leader has no remove button
    await expect(card.getByRole('button', { name: /as a leader of/ })).toHaveCount(0)

    // Search and the frozen filter
    await page.getByLabel('Search teams').fill(adminTeam)
    await expect(page.getByRole('article')).toHaveCount(1)
    await page.getByLabel('Show', { exact: true }).selectOption('true')
    await expect(page.getByText('No teams match this search.')).toBeVisible()
    await page.getByLabel('Show', { exact: true }).selectOption('')

    // Freeze it: inviting and adding leaders are switched off
    await card.getByRole('button', { name: /^Freeze/ }).click()
    await page.getByRole('dialog', { name: /^Freeze/ }).getByRole('button', { name: 'Freeze' }).click()
    await expect(card.getByText('Frozen', { exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: /^Invite to/ })).toBeDisabled()
    await expect(card.getByRole('button', { name: /^Add Leader to/ })).toBeDisabled()

    // The team's leader sees the banner, and cannot change anything
    const leaderPage = await signedInPage(browser, invitee)
    await leaderPage.goto('/teams')
    await expect(leaderPage.getByRole('heading', { name: adminTeam })).toBeVisible()
    await expect(leaderPage.getByText('This team is frozen.')).toBeVisible()
    await expect(leaderPage.getByRole('button', { name: 'Edit team' })).toHaveCount(0)
    await leaderPage.context().close()

    // Delete it: the confirmation says what happens to the people
    await card.getByRole('button', { name: /^Delete/ }).click()
    const confirmDelete = page.getByRole('dialog', { name: /^Delete team/ })
    await expect(confirmDelete).toContainText('go back to being users without a team')
    await confirmDelete.getByRole('button', { name: 'Delete team' }).click()
    await expect(page.getByRole('article').filter({ hasText: adminTeam })).toHaveCount(0)

    await page.context().close()
  })
})

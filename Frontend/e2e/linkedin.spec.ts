import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADMIN, signIn } from './support/app'
import { CONTROL_URL } from './support/servers'

// Posting to LinkedIn from the Social Hub, against the fake LinkedIn in
// Backend/test/e2e-server.js: connecting through LinkedIn's consent page,
// posting with an image straight away, and scheduling, cancelling and then
// posting by hand. Admins' posts need no approval.

// A 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

type LinkedInCall = { method: string; path: string; body: Record<string, unknown> | null; bytes: number }
const linkedInCalls = async () => (await (await fetch(`${CONTROL_URL}/linkedin/calls`)).json()) as LinkedInCall[]
const postsSent = async () => (await linkedInCalls()).filter((call) => call.method === 'POST' && call.path === '/rest/posts')

const composer = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Compose update' }) })

// The composer's chips hide their checkbox or radio under the label, as people see it: click the label
const choose = async (control: Locator) => {
  await control.locator('xpath=..').click()
  await expect(control).toBeChecked()
}

// A time in the browser's own timezone, as a datetime-local input takes it
const localTime = (page: Page, hoursAhead: number) =>
  page.evaluate((hours) => {
    const at = new Date(Date.now() + hours * 60 * 60 * 1000)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
  }, hoursAhead)

test('an admin connects LinkedIn, posts there with an image, and schedules a post', async ({ page }) => {
  const stamp = Date.now()
  await signIn(page, ADMIN)
  await page.goto('/social')

  // Ticking LinkedIn without an account offers to connect it
  await choose(composer(page).getByRole('checkbox', { name: 'LinkedIn' }))
  await composer(page).getByRole('button', { name: 'Connect LinkedIn' }).click()
  // LinkedIn's consent page agrees and sends the browser back where it was
  await expect(page).toHaveURL(/\/social$/)
  await expect(page.getByText('LinkedIn connected as Pandav Tester.')).toBeVisible()
  await expect(page.locator('#integrations').getByText('Connected as')).toContainText('Pandav Tester')

  // ---------- Straight away, with an image ----------
  const form = composer(page)
  await choose(form.getByRole('checkbox', { name: 'LinkedIn' }))
  await expect(form.getByText('Posting as')).toContainText('Pandav Tester')
  const text = `Release ${stamp} is out (finally)`
  await form.getByLabel('Post', { exact: true }).fill(text)
  await form.getByLabel(/^Tags/).fill('release, team work')
  await form.locator('input[type=file]').setInputFiles({ name: 'chart.png', mimeType: 'image/png', buffer: PNG })
  await form.getByLabel('Description of chart.png').fill('A rising chart')
  await expect(form.getByText(/on LinkedIn, with the title and tags/)).toContainText(`${text.length + '\n\n#release #teamwork'.length}/3000`)

  await form.getByRole('button', { name: 'Preview on LinkedIn' }).click()
  const preview = form.getByRole('figure')
  await expect(preview).toContainText(text)
  await expect(preview.getByText('#teamwork')).toBeVisible()
  await expect(preview.getByRole('img', { name: 'A rising chart' })).toBeVisible()

  const before = (await postsSent()).length
  await form.getByRole('button', { name: 'Post now' }).click()
  await expect(page.getByText('Posted here and on LinkedIn.')).toBeVisible()

  const card = page.locator('article', { hasText: text })
  await expect(card.getByText(/^On LinkedIn/)).toBeVisible()
  await expect(card.getByRole('link', { name: 'View on LinkedIn' })).toHaveAttribute('href', /^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:share:e2e-/)
  const image = card.getByRole('img', { name: 'A rising chart' })
  await expect(image).toBeVisible()
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1)

  const sent = (await postsSent()).slice(before)
  expect(sent).toHaveLength(1)
  expect(sent[0].body?.commentary).toBe(`Release ${stamp} is out \\(finally\\)\n\n{hashtag|\\#|release} {hashtag|\\#|teamwork}`)
  expect(sent[0].body?.content).toMatchObject({ media: { altText: 'A rising chart' } })

  // ---------- Scheduled, cancelled, then posted by hand ----------
  await choose(form.getByRole('checkbox', { name: 'LinkedIn' }))
  const later = `Later ${stamp}`
  await form.getByLabel('Post', { exact: true }).fill(later)
  await choose(form.getByRole('radio', { name: 'At a time I choose' }))
  await form.getByLabel('Post on LinkedIn at').fill(await localTime(page, 2))
  await form.getByRole('button', { name: 'Schedule' }).click()
  await expect(page.getByText(/^Saved\. It goes to LinkedIn on/)).toBeVisible()

  const scheduled = page.locator('article', { hasText: later })
  await expect(scheduled.getByText(/^Scheduled for LinkedIn:/)).toBeVisible()
  expect((await postsSent()).length).toBe(before + 1)

  await scheduled.getByRole('button', { name: 'Cancel schedule' }).click()
  await expect(scheduled.getByText('Not on LinkedIn yet.')).toBeVisible()
  await scheduled.getByRole('button', { name: 'Post now' }).click()
  await expect(scheduled.getByText(/^On LinkedIn/)).toBeVisible()
  expect((await postsSent()).length).toBe(before + 2)

  // After a reload the post still says so
  await page.reload()
  await expect(page.locator('article', { hasText: later }).getByRole('link', { name: 'View on LinkedIn' })).toBeVisible()
})

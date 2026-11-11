import { expect, test } from '@playwright/test'
import { adminApi, registerAccount, signIn } from './support/app'

// A 1x1 PNG, saved as a profile image (the app itself resizes real photos to 256 px)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const day = (offset: number) => new Date(Date.now() + offset * 24 * 3600 * 1000).toISOString().slice(0, 10)

test('the leaderboard loads photos from their own address and falls back to initials', async ({ page, request }) => {
  const account = await registerAccount(request, 'Photo')
  await adminApi(request)
  const task = await request.post('/api/v2/tasks', {
    data: { title: 'Photo task', description: 'Gives the leaderboard a row', startDate: day(0), dueDate: day(5), assignedTo: [account.id] },
  })
  expect(task.status(), 'create task').toBe(201)
  await signIn(page, account)

  const board = page.getByRole('region', { name: 'Leaderboard' })
  const row = board.getByRole('listitem').filter({ hasText: account.name })
  const openDashboard = async () => {
    const answer = page.waitForResponse((response) => response.url().includes('/tasks/leaderboard'))
    await page.goto('/user')
    return (await answer).text()
  }

  // No photo yet: the initials
  const withoutPhoto = await openDashboard()
  await expect(row).toBeVisible()
  await expect(row.locator('img')).toHaveCount(0)
  expect(JSON.parse(withoutPhoto).data.find((r: { _id: string }) => r._id === account.id).photoUrl).toBeNull()

  // A photo: the row links to it instead of carrying it, and the page shows it
  const saved = await page.request.put(`/api/v2/users/${account.id}`, { data: { profileImage: PNG } })
  expect(saved.status(), 'save photo').toBe(200)
  const withPhoto = await openDashboard()
  expect(withPhoto).not.toContain('base64')
  const photo = row.locator('img')
  await expect(photo).toHaveAttribute('src', new RegExp(`^/api/v2/users/${account.id}/photo\\?v=\\d+$`))
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)

  // A photo that doesn't load: the initials again, not a broken picture
  await page.route('**/api/v2/users/*/photo*', (route) => route.fulfill({ status: 404, json: { success: false, message: 'Photo not found' } }))
  await openDashboard()
  await expect(row).toBeVisible()
  await expect(row.locator('img')).toHaveCount(0)
})

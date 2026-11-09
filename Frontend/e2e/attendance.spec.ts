import { readFileSync } from 'node:fs'
import { expect, test, type Browser } from '@playwright/test'
import { ADMIN, USER, signIn, type Account } from './support/app'

const signedInPage = async (browser: Browser, account: Account) => {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, account)
  return page
}

// Days as YYYY-MM-DD, worked out in UTC so the tests agree on the calendar
const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const nextMonday = (from: string) => {
  let day = from
  while (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) day = addDays(day, 1)
  return day
}

const today = new Date().toISOString().slice(0, 10)
// A Monday two weeks ahead or later: Monday to Wednesday are three workdays,
// and the Friday after it is where the holiday goes
const leaveStart = nextMonday(addDays(today, 14))
const leaveEnd = addDays(leaveStart, 2)
const holidayDay = addDays(leaveStart, 4)

// The tests share one database and build on each other
test.describe.configure({ mode: 'serial' })

test('a user requests three days of leave and sees the balance change', async ({ browser }) => {
  const page = await signedInPage(browser, USER)
  await page.goto('/attendance?tab=leave')
  await expect(page.getByRole('heading', { name: 'Request leave' })).toBeVisible()

  const casual = page.getByRole('list', { name: 'Leave balance' }).getByRole('listitem').filter({ hasText: 'Casual leave' })
  await expect(casual).toContainText('12 days left')

  await page.getByLabel('First day').fill(leaveStart)
  await page.getByLabel('Last day').fill(leaveEnd)
  await page.getByLabel('Remarks (optional)').fill('Family wedding')
  await expect(page.getByText('This asks for 3 days of casual leave')).toBeVisible()
  await page.getByRole('button', { name: 'Request leave' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Leave requested for' })).toBeVisible()
  await expect(casual).toContainText('9 days left')
  await expect(casual).toContainText('3 awaiting approval')

  const mine = page.getByRole('region', { name: 'My leave requests' })
  await expect(mine.getByText('Awaiting approval')).toBeVisible()
  await expect(mine.getByText('Family wedding')).toBeVisible()
  await expect(mine.getByRole('button', { name: /^Withdraw leave request/ })).toBeVisible()

  // The same days again: the server's conflict message names the days
  await page.getByLabel('First day').fill(leaveStart)
  await page.getByLabel('Last day').fill(leaveStart)
  await page.getByRole('button', { name: 'Request leave' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'You already have attendance on' })).toBeVisible()

  await page.context().close()
})

test('the admin approves the leave request on the admin page', async ({ browser }) => {
  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/admin/attendance?tab=leave')
  await expect(admin.getByRole('tab', { name: /Leave requests/, selected: true })).toBeVisible()

  const request = admin.getByRole('listitem').filter({ hasText: USER.name }).filter({ hasText: 'Casual leave' })
  await expect(request).toContainText('Family wedding')
  await request.getByRole('button', { name: /^Approve leave of Demo User/ }).click()
  await expect(admin.getByRole('status').filter({ hasText: 'Approved the leave of Demo User' })).toBeVisible()
  await expect(admin.getByText('No leave requests are waiting for a decision.')).toBeVisible()

  await admin.getByLabel('Show').selectOption('approved')
  await expect(admin.getByRole('listitem').filter({ hasText: USER.name }).getByText('Approved', { exact: true })).toBeVisible()

  // The person sees the decision and the days used
  const user = await signedInPage(browser, USER)
  await user.goto('/attendance?tab=leave')
  const casual = user.getByRole('list', { name: 'Leave balance' }).getByRole('listitem').filter({ hasText: 'Casual leave' })
  await expect(casual).toContainText('3 used')
  await expect(casual).toContainText('0 awaiting approval')
  await expect(user.getByRole('region', { name: 'My leave requests' }).getByText('Approved', { exact: true })).toBeVisible()

  await user.context().close()
  await admin.context().close()
})

test('the admin sets a shift start and adds a holiday', async ({ browser }) => {
  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/admin/attendance?tab=settings')
  await expect(admin.getByRole('heading', { name: 'Attendance rules' })).toBeVisible()
  await admin.getByLabel('Shift start').fill('09:30')
  await admin.getByLabel('Late after (minutes)').fill('10')
  await expect(admin.getByText('Shift starts 09:30 · Late after 09:40')).toBeVisible()
  await admin.getByRole('button', { name: 'Save settings' }).click()
  await expect(admin.getByRole('status').filter({ hasText: 'Attendance settings saved' })).toBeVisible()
  await admin.reload()
  await expect(admin.getByLabel('Shift start')).toHaveValue('09:30')

  await admin.getByRole('tab', { name: 'Holidays' }).click()
  await admin.getByLabel('Date').fill(holidayDay)
  await admin.getByLabel('Holiday name').fill('E2E Founders Day')
  await admin.getByRole('button', { name: 'Add holiday' }).click()
  await expect(admin.getByRole('status').filter({ hasText: 'Added the holiday' })).toBeVisible()
  await expect(admin.getByRole('listitem').filter({ hasText: 'E2E Founders Day' })).toBeVisible()

  // Everyone sees the shift rule and the holiday
  const user = await signedInPage(browser, USER)
  await user.goto('/attendance')
  await expect(user.getByText('Shift starts 09:30 · Late after 09:40')).toBeVisible()
  await expect(user.getByRole('region', { name: 'Upcoming holidays' }).getByText('E2E Founders Day')).toBeVisible()
  await user.context().close()

  await admin.getByRole('button', { name: 'Remove the holiday E2E Founders Day' }).click()
  await admin.getByRole('dialog', { name: 'Remove this holiday?' }).getByRole('button', { name: 'Remove' }).click()
  await expect(admin.getByRole('listitem').filter({ hasText: 'E2E Founders Day' })).toHaveCount(0)
  await admin.context().close()
})

test('Export CSV downloads a file', async ({ browser }) => {
  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/admin/attendance')
  await expect(admin.getByRole('heading', { name: 'Attendance Management' })).toBeVisible()

  const download = admin.waitForEvent('download')
  await admin.getByRole('button', { name: 'Export CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^attendance.*\.csv$/)
  expect(readFileSync(await file.path(), 'utf8')).toContain('Employee')
  await expect(admin.getByRole('status').filter({ hasText: 'Downloaded attendance' })).toBeVisible()
  await admin.context().close()
})

test('the admin adds, edits and deletes a record on the admin page', async ({ browser }) => {
  const admin = await signedInPage(browser, ADMIN)
  await admin.goto('/admin/attendance')
  await expect(admin.getByRole('heading', { name: 'Attendance Management' })).toBeVisible()

  const day = addDays(today, -40)
  await admin.getByRole('button', { name: 'Add record' }).click()
  const dialog = admin.getByRole('dialog', { name: 'Add attendance record' })
  await dialog.getByLabel('Person').selectOption({ label: `${USER.name} (${USER.email})` })
  await dialog.getByLabel('Date').fill(day)
  await dialog.getByLabel("Employee's note").fill('E2E manual record')
  await dialog.getByRole('button', { name: 'Add record' }).click()
  await expect(admin.getByRole('status').filter({ hasText: 'Added a record for Demo User' })).toBeVisible()

  const row = admin.getByRole('row').filter({ hasText: 'E2E manual record' })
  await expect(row.getByText('Approved', { exact: true })).toBeVisible()

  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = admin.getByRole('dialog', { name: 'Edit attendance record' })
  await edit.getByLabel('Check-in time').fill(`${day}T09:00`)
  await edit.getByLabel('Check-out time').fill(`${day}T17:30`)
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(row.getByText('8.5 hrs')).toBeVisible()

  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  const confirm = admin.getByRole('dialog', { name: 'Delete this attendance record?' })
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(admin.getByRole('row').filter({ hasText: 'E2E manual record' })).toHaveCount(0)
  await admin.context().close()
})

test('a user sees their own records without an Employee column', async ({ browser }) => {
  const user = await signedInPage(browser, USER)
  await user.goto('/attendance')
  await expect(user.getByRole('heading', { name: 'Attendance records' })).toBeVisible()
  await expect(user.getByRole('columnheader', { name: 'Date' })).toBeVisible()
  await expect(user.getByRole('columnheader', { name: 'Employee' })).toHaveCount(0)
  await expect(user.getByRole('tab', { name: 'My attendance', selected: true })).toBeVisible()
  await user.context().close()
})

import { readFileSync } from 'node:fs'
import { expect, test, type Browser } from '@playwright/test'
import { dayKeyIn, fromZonedInput, toZonedInput } from '../src/utils/date'
import { ADMIN, USER, adminApi, registerAccount, signIn, type Account } from './support/app'

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
  // The person is searched for, not chosen from a list of everyone
  await dialog.getByRole('button', { name: /^Person/ }).click()
  await dialog.getByLabel('Search people').fill(USER.email)
  await dialog.getByRole('radio', { name: new RegExp(USER.name) }).click()
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

// ─── Times in the server's time zone (APP_TIMEZONE, Asia/Kolkata in these tests) ─────────────────

// The helpers behind the Add/Edit dialog and the page's "today" (src/utils/date.ts): the zone with
// no clock changes, then zones whose clocks change, including the times that are skipped or happen twice
test('typed times are read as the zone\'s wall clock, also where the clocks change', () => {
  // Asia/Kolkata is UTC+5:30 all year
  expect(fromZonedInput('2026-10-16T09:00', 'Asia/Kolkata')).toBe('2026-10-16T03:30:00.000Z')
  expect(fromZonedInput('2026-01-05T00:15', 'Asia/Kolkata')).toBe('2026-01-04T18:45:00.000Z')
  expect(toZonedInput('2026-10-16T03:30:00.000Z', 'Asia/Kolkata')).toBe('2026-10-16T09:00')
  expect(toZonedInput('2026-10-16T18:30:00.000Z', 'Asia/Kolkata')).toBe('2026-10-17T00:00')

  // New York: UTC-4 in summer, UTC-5 in winter
  expect(fromZonedInput('2026-07-01T09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z')
  expect(fromZonedInput('2026-12-01T09:00', 'America/New_York')).toBe('2026-12-01T14:00:00.000Z')
  expect(toZonedInput('2026-07-01T13:00:00.000Z', 'America/New_York')).toBe('2026-07-01T09:00')
  // The clocks go forward at 02:00 on 8 March 2026: 01:59 and 03:00 exist, 02:30 never happens
  expect(fromZonedInput('2026-03-08T01:59', 'America/New_York')).toBe('2026-03-08T06:59:00.000Z')
  expect(fromZonedInput('2026-03-08T03:00', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z')
  expect(fromZonedInput('2026-03-08T02:30', 'America/New_York')).toBeNull()
  // They go back on 1 November: 01:30 happens twice, and the first one is meant
  expect(fromZonedInput('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z')
  expect(fromZonedInput('2026-11-01T01:30', 'Europe/London')).toBe('2026-11-01T01:30:00.000Z')
  expect(fromZonedInput('2026-10-25T01:30', 'Europe/London')).toBe('2026-10-25T00:30:00.000Z')
  // Southern summer time (Sydney starts it on 4 October)
  expect(fromZonedInput('2026-10-10T09:00', 'Australia/Sydney')).toBe('2026-10-09T22:00:00.000Z')

  // Not a time at all
  expect(fromZonedInput('', 'Asia/Kolkata')).toBeNull()
  expect(fromZonedInput('2026-02-31T09:00', 'UTC')).toBeNull()

  // Reading a moment back and typing it again gives the same moment, across a whole year
  for (const zone of ['Asia/Kolkata', 'America/New_York', 'Europe/London', 'Australia/Sydney']) {
    for (let hours = 0; hours < 24 * 366; hours += 37) {
      const moment = new Date(Date.UTC(2026, 0, 1) + hours * 3600 * 1000).toISOString()
      const shown = toZonedInput(moment, zone)
      const typed = fromZonedInput(shown, zone)
      // The same wall-clock minute; a moment in the second pass of a repeated hour comes back as the first
      expect(toZonedInput(typed ?? '', zone), `${zone} ${moment}`).toBe(shown)
    }
  }
})

test('"today" is the date in the zone, not the browser\'s', () => {
  // 19:00 UTC on the 16th is already the 17th in India, and still the 15th in Los Angeles at 05:00 UTC
  expect(dayKeyIn('Asia/Kolkata', new Date('2026-10-16T19:00:00Z'))).toBe('2026-10-17')
  expect(dayKeyIn('UTC', new Date('2026-10-16T19:00:00Z'))).toBe('2026-10-16')
  expect(dayKeyIn('America/Los_Angeles', new Date('2026-10-16T05:00:00Z'))).toBe('2026-10-15')
  // Midnight there, either side of it
  expect(dayKeyIn('Asia/Kolkata', new Date('2026-10-16T18:29:59Z'))).toBe('2026-10-16')
  expect(dayKeyIn('Asia/Kolkata', new Date('2026-10-16T18:30:00Z'))).toBe('2026-10-17')
})

test('the settings carry the server zone, and the admin dialog reads times in it from a browser in another zone', async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: 'America/New_York' })
  const admin = await context.newPage()
  await signIn(admin, ADMIN)

  const settings = await (await admin.request.get('/api/v2/attendance/settings')).json()
  expect(settings.data.timezone).toBe('Asia/Kolkata')

  await admin.goto('/admin/attendance')
  await expect(admin.getByRole('heading', { name: 'Attendance Management' })).toBeVisible()
  const day = addDays(today, -45)
  await admin.getByRole('button', { name: 'Add record' }).click()
  const dialog = admin.getByRole('dialog', { name: 'Add attendance record' })
  await expect(dialog.getByText('Times are in Asia/Kolkata.')).toBeVisible()
  await dialog.getByRole('button', { name: /^Person/ }).click()
  await dialog.getByLabel('Search people').fill(USER.email)
  await dialog.getByRole('radio', { name: new RegExp(USER.name) }).click()
  await dialog.getByLabel('Date').fill(day)
  await dialog.getByLabel('Check-in time').fill(`${day}T09:00`)
  await dialog.getByLabel('Check-out time').fill(`${day}T17:30`)
  await dialog.getByLabel("Employee's note").fill('E2E zone record')
  const created = admin.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v2/attendance')
  await dialog.getByRole('button', { name: 'Add record' }).click()
  // 09:00 and 17:30 in India are 03:30 and 12:00 UTC, whatever the browser's zone
  expect((await created).postDataJSON()).toMatchObject({ checkInTime: `${day}T03:30:00.000Z`, checkOutTime: `${day}T12:00:00.000Z` })
  await expect(admin.getByRole('status').filter({ hasText: 'Added a record for Demo User' })).toBeVisible()

  // Editing shows the same wall-clock times, and sends only what changed
  const row = admin.getByRole('row').filter({ hasText: 'E2E zone record' })
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = admin.getByRole('dialog', { name: 'Edit attendance record' })
  await expect(edit.getByLabel('Check-in time')).toHaveValue(`${day}T09:00`)
  await expect(edit.getByLabel('Check-out time')).toHaveValue(`${day}T17:30`)
  await edit.getByLabel('Check-out time').fill(`${day}T18:00`)
  const saved = admin.waitForRequest((request) => request.method() === 'PUT' && /\/api\/v2\/attendance\/[0-9a-f]{24}$/.test(new URL(request.url()).pathname))
  await edit.getByRole('button', { name: 'Save changes' }).click()
  expect((await saved).postDataJSON()).toEqual({ checkOutTime: `${day}T12:30:00.000Z` })
  await expect(edit).toBeHidden()

  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  await admin.getByRole('dialog', { name: 'Delete this attendance record?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(admin.getByRole('row').filter({ hasText: 'E2E zone record' })).toHaveCount(0)
  await context.close()
})

test('a user\'s own attendance page works out "today" and its window in the server zone', async ({ browser }) => {
  // Pago Pago is 16.5 hours behind India: for most of the day the dates differ
  const context = await browser.newContext({ timezoneId: 'Pacific/Pago_Pago' })
  const page = await context.newPage()
  await signIn(page, USER)
  // The window the attendance page asks for (the dashboard it lands on after signing in asks for others)
  const asked = page.waitForRequest((request) => {
    const url = new URL(request.url())
    return (
      url.pathname === '/api/v2/attendance' &&
      url.searchParams.has('startDate') &&
      url.searchParams.has('endDate') &&
      new URL(request.frame().url()).pathname === '/attendance'
    )
  })
  await page.goto('/attendance')
  const url = new URL((await asked).url())
  const serverToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  expect(url.searchParams.get('startDate')).toBe(addDays(serverToday, -2))
  expect(url.searchParams.get('endDate')).toBe(addDays(serverToday, 1))
  await expect(page.getByRole('heading', { name: 'Attendance records' })).toBeVisible()
  await context.close()
})

// ─── The admin filters ───────────────────────────────────────────────────────────────────────────

test('the person and team filters search as you type, and show their names when the page opens from a link', async ({ browser, request }) => {
  // A team to filter by: its leader signs up first, then the admin makes the team
  const leader = await registerAccount(request, 'Filter')
  await adminApi(request)
  const teamName = `Filter Crew ${Date.now()}`
  const team = await request.post('/api/v2/teams', { data: { name: teamName, leaderId: leader.id } })
  expect(team.status()).toBe(201)
  const teamId: string = (await team.json()).data._id
  const people = await (await request.get(`/api/v2/users?q=${encodeURIComponent(USER.email)}&isActive=true`)).json()
  const userId: string = people.data[0]._id

  const admin = await signedInPage(browser, ADMIN)
  // Nothing asks for the whole list of people any more: every request for people has a limit
  const peopleRequests: string[] = []
  admin.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/v2/users') peopleRequests.push(url.search)
  })

  // Opened from a link, the filters name the team and the person, not "Selected ..."
  await admin.goto(`/admin/attendance?team=${teamId}&user=${userId}`)
  await expect(admin.getByRole('heading', { name: 'Attendance Management' })).toBeVisible()
  await expect(admin.getByRole('button', { name: `Team ${teamName}` })).toBeVisible()
  await expect(admin.getByRole('button', { name: `Person ${USER.name}` })).toBeVisible()
  await expect(admin.getByText('Selected person')).toHaveCount(0)
  await expect(admin.getByText('Selected team')).toHaveCount(0)

  // Clearing the filters empties the pickers and the address
  await admin.getByRole('button', { name: 'Clear filters' }).click()
  await expect(admin.getByRole('button', { name: 'Team All teams' })).toBeVisible()
  await expect(admin.getByRole('button', { name: 'Person Everyone' })).toBeVisible()
  await expect(admin).not.toHaveURL(/[?&](team|user)=/)

  // Search for a person: the request carries the text and a limit, and the choice goes in the address
  await admin.getByRole('button', { name: /^Person/ }).click()
  const searched = admin.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname === '/api/v2/users' && url.searchParams.get('q') === 'Demo' && url.searchParams.get('limit') === '20'
  })
  await admin.getByLabel('Search people').fill('Demo')
  await searched
  await admin.getByRole('radio', { name: new RegExp(USER.name) }).click()
  await expect(admin.getByRole('button', { name: `Person ${USER.name}` })).toBeVisible()
  await expect(admin).toHaveURL(new RegExp(`[?&]user=${userId}`))

  // And for a team, by part of its name
  await admin.getByRole('button', { name: /^Team/ }).click()
  await admin.getByLabel('Search teams').fill('Filter Crew')
  await admin.getByRole('radio', { name: teamName }).click()
  await expect(admin.getByRole('button', { name: `Team ${teamName}` })).toBeVisible()
  await expect(admin).toHaveURL(new RegExp(`[?&]team=${teamId}`))
  // Someone from another team has no records in this one
  await expect(admin.getByText('No records match these filters.')).toBeVisible()

  // The address brings the same filters back
  await admin.reload()
  await expect(admin.getByRole('button', { name: `Team ${teamName}` })).toBeVisible()
  await expect(admin.getByRole('button', { name: `Person ${USER.name}` })).toBeVisible()
  expect(peopleRequests.length).toBeGreaterThan(0)
  expect(peopleRequests.filter((search) => !search.includes('limit=20'))).toEqual([])
  await admin.context().close()
})

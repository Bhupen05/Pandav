import { expect, test, type Page } from '@playwright/test'

// The public pages: contact form, pricing, about, services, landing, footer.
// Nothing here signs in or registers (sign-ups are limited per hour) and the
// contact form is sent only twice (the server takes 5 an hour per address).

const PUBLIC_PAGES = [
  { path: '/', name: 'Landing' },
  { path: '/about', name: 'About' },
  { path: '/service', name: 'Services' },
  { path: '/pricing', name: 'Pricing' },
  { path: '/contact', name: 'Contact' },
]

// The Landing page's hero photo comes from another site: tests don't wait for it
test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', (route) => route.abort())
})

const isContactPost = (request: { url(): string; method(): string }) =>
  request.url().endsWith('/api/v2/contact') && request.method() === 'POST'

async function fillContactForm(page: Page, subject: string) {
  await page.getByLabel(/^Your Name/).fill('Visitor')
  await page.getByLabel(/^Email Address/).fill('visitor@example.com')
  await page.getByLabel(/^Subject/).fill(subject)
  await page.getByLabel(/^Message/).fill('Do you offer a team plan?')
}

test.describe('contact form', () => {
  test('sends a message with its subject and says so', async ({ page }) => {
    await page.goto('/contact')
    await fillContactForm(page, 'Pricing question')
    await page.getByLabel('Phone (optional)').fill('+91 98765 43210')

    const request = page.waitForRequest(isContactPost)
    await page.getByRole('button', { name: 'Send Message' }).click()

    const body = (await request).postDataJSON()
    expect(body).toMatchObject({
      name: 'Visitor',
      email: 'visitor@example.com',
      phone: '+91 98765 43210',
      subject: 'Pricing question',
      message: 'Do you offer a team plan?',
      website: '',
    })
    await expect(page.getByText("We'll get back to you soon.")).toBeVisible()
    // The form is empty again for the next message
    await expect(page.getByLabel(/^Subject/)).toHaveValue('')
  })

  test('a filled honeypot still shows the visitor the same success', async ({ page }) => {
    await page.goto('/contact')
    await fillContactForm(page, 'Hello')

    // People never see this field: tests (like bots) fill it in directly
    const honeypot = page.locator('input[name="website"]')
    await expect(honeypot).toHaveAttribute('tabindex', '-1')
    await expect(honeypot).toHaveAttribute('autocomplete', 'off')
    await honeypot.fill('https://spam.example', { force: true })

    const request = page.waitForRequest(isContactPost)
    await page.getByRole('button', { name: 'Send Message' }).click()

    expect((await request).postDataJSON().website).toBe('https://spam.example')
    await expect(page.getByText("We'll get back to you soon.")).toBeVisible()
  })

  test('says what is missing before anything is sent', async ({ page }) => {
    let posted = false
    page.on('request', (request) => {
      if (isContactPost(request)) posted = true
    })
    await page.goto('/contact')

    await page.getByRole('button', { name: 'Send Message' }).click()
    await expect(page.getByText('Enter your name.')).toBeVisible()
    await expect(page.getByText('Enter your email address.')).toBeVisible()
    await expect(page.getByText('Enter a subject.')).toBeVisible()
    await expect(page.getByText('Enter your message.')).toBeVisible()
    // The first problem gets the cursor
    await expect(page.getByLabel(/^Your Name/)).toBeFocused()

    // The error goes once the field is typed in, and the count follows
    await page.getByLabel(/^Your Name/).fill('Visitor')
    await expect(page.getByText('Enter your name.')).toHaveCount(0)
    await expect(page.locator('#contact-name-count')).toContainText('7/100')

    // Typing stops at the field's limit
    await page.getByLabel(/^Subject/).pressSequentially('x'.repeat(205))
    await expect(page.getByLabel(/^Subject/)).toHaveValue('x'.repeat(200))
    await expect(page.locator('#contact-subject-count')).toContainText('200/200')

    await page.getByLabel(/^Email Address/).fill('not-an-email')
    await page.getByRole('button', { name: 'Send Message' }).click()
    await expect(page.getByText('Enter an email address like name@example.com.')).toBeVisible()
    expect(posted).toBe(false)
  })

  test('?topic= starts the subject off', async ({ page }) => {
    await page.goto('/contact?topic=Sales')
    await expect(page.getByLabel(/^Subject/)).toHaveValue('Sales')
  })
})

test.describe('pricing', () => {
  test('"Most Popular" and the Growth button are visible, not white on white', async ({ page }) => {
    await page.goto('/pricing')
    const badge = page.getByText('Most Popular')
    await expect(badge).toBeVisible()
    // The brand colour (#00386c) behind white text
    await expect(badge).toHaveCSS('background-color', 'rgb(0, 56, 108)')
    await expect(page.getByRole('link', { name: 'Choose Growth' })).toHaveCSS('background-color', 'rgb(0, 56, 108)')
    await expect(page.getByRole('link', { name: 'Create Account' }).first()).toHaveCSS('background-color', 'rgb(0, 56, 108)')
  })

  test('every plan button leads somewhere', async ({ page }) => {
    await page.goto('/pricing')
    await page.getByRole('link', { name: 'Start Free' }).click()
    await expect(page).toHaveURL(/\/register$/)

    await page.goto('/pricing')
    await page.getByRole('link', { name: 'Choose Growth' }).click()
    await expect(page).toHaveURL(/\/register\?plan=growth$/)

    await page.goto('/pricing')
    await page.getByRole('link', { name: 'Contact Sales' }).click()
    await expect(page).toHaveURL(/\/contact\?topic=Enterprise%20plan$/)
    await expect(page.getByLabel(/^Subject/)).toHaveValue('Enterprise plan')

    await page.goto('/pricing')
    await page.getByRole('link', { name: 'Talk to Sales' }).click()
    await expect(page).toHaveURL(/\/contact\?topic=Sales$/)
    await expect(page.getByLabel(/^Subject/)).toHaveValue('Sales')
  })

  test('the footer spans the page instead of sitting inside its padding', async ({ page }) => {
    await page.goto('/pricing')
    const footer = await page.locator('footer').boundingBox()
    const viewport = page.viewportSize()
    expect(footer?.x).toBe(0)
    expect(footer?.width).toBe(viewport?.width)
  })
})

test.describe('about and services', () => {
  test('"Get Started" opens the sign-up page', async ({ page }) => {
    await page.goto('/about')
    await page.getByRole('link', { name: 'Get Started Now' }).click()
    await expect(page).toHaveURL(/\/register$/)

    await page.goto('/service')
    await page.getByRole('link', { name: 'Get Started', exact: true }).last().click()
    await expect(page).toHaveURL(/\/register$/)
  })

  test('Services lists teams, chat, the Social Hub and the four roles', async ({ page }) => {
    await page.goto('/service')
    for (const feature of ['Teams', 'Chat', 'Social Hub']) {
      await expect(page.getByRole('heading', { name: feature, exact: true })).toBeVisible()
    }
    for (const role of ['Users', 'Team Members', 'Team Leaders', 'Administrators']) {
      await expect(page.getByRole('heading', { name: `For ${role}` })).toBeVisible()
    }
  })
})

test.describe('landing', () => {
  test('has one main landmark, the Social Hub and team members', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Social Hub', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Team Members', exact: true })).toBeVisible()
  })

  test('shows a panel when the hero photo cannot be loaded', async ({ page }) => {
    // beforeEach already refuses the photo
    await page.goto('/')
    await expect(page.getByRole('img', { name: 'Modern architectural office' })).toBeVisible()
    await expect(page.locator('img[alt="Modern architectural office"]')).toHaveCount(0)
  })
})

test.describe('every public page', () => {
  for (const { path, name } of PUBLIC_PAGES) {
    test(`${name} has the footer, with real links and this year`, async ({ page }) => {
      await page.goto(path)
      const footer = page.locator('footer')
      await expect(footer).toBeVisible()
      // The one contentinfo landmark, outside <main>
      const landmark = page.getByRole('contentinfo')
      await expect(landmark).toBeVisible()
      await expect(landmark).toHaveCount(1)
      await expect(page.getByRole('main').getByRole('contentinfo')).toHaveCount(0)
      await expect(footer).toContainText(String(new Date().getFullYear()))
      await expect(footer.locator('a[href="#"]')).toHaveCount(0)
      for (const link of ['Pricing', 'About Us', 'Contact', 'Login']) {
        await expect(footer.getByRole('link', { name: link, exact: true })).toBeVisible()
      }
    })

    test(`${name} does not start underneath the fixed header`, async ({ page }) => {
      await page.goto(path)
      const header = await page.locator('header').first().boundingBox()
      const heading = await page.getByRole('heading', { level: 1 }).boundingBox()
      expect(header).not.toBeNull()
      expect(heading).not.toBeNull()
      expect(heading!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
    })
  }

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 } })

    for (const { path, name } of PUBLIC_PAGES) {
      test(`${name} does not scroll sideways`, async ({ page }) => {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        expect(overflow).toBeLessThanOrEqual(0)
      })
    }
  })
})

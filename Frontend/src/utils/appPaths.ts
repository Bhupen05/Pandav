// The routes of the marketing site, shown with the public header
export const PUBLIC_PATHS = ['/', '/about', '/service', '/pricing', '/login', '/register', '/contact', '/forgot-password', '/reset-password', '/verify-email']

// The routes of the signed-in app (App.tsx), shown with the app shell
const APP_PATHS = [
  '/dashboard', '/user', '/tasks', '/attendance', '/chat', '/profile', '/team', '/teams', '/team-member',
  '/social', '/todo', '/network', '/integrations', '/publish-jobs', '/notifications', '/approvals',
]

export const isPublicPath = (pathname: string) => PUBLIC_PATHS.includes(pathname)

// The marketing pages end with the site footer (the sign-in and password pages don't)
const FOOTER_PATHS = ['/', '/about', '/service', '/pricing', '/contact']

export const hasPublicFooter = (pathname: string) => FOOTER_PATHS.includes(pathname)

// A page that needs a session (the admin pages included); anything that is
// neither public nor this is the 404 page
export const isAppPath = (pathname: string) =>
  APP_PATHS.includes(pathname) || pathname === '/admin' || pathname.startsWith('/admin/')

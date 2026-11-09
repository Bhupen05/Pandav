import { Link } from 'react-router-dom'
import Footer from '../components/Footer'

// The features of the app, as plain facts. Class names are written out in
// full so Tailwind can find them.
const FEATURES = [
  {
    title: 'Task Management',
    body: 'Create, assign, and track tasks with real-time progress monitoring and priority settings.',
    bullets: ['Task creation and assignment', 'Priority and deadline management', 'Real-time status updates'],
    iconBg: 'bg-emerald-600',
    dot: 'bg-blue-500',
    path: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    title: 'Attendance Tracking',
    body: 'Automated attendance system with check-in/out functionality and comprehensive reporting.',
    bullets: ['Quick check-in/check-out', 'Automatic hours calculation', 'Detailed attendance reports'],
    iconBg: 'bg-blue-600',
    dot: 'bg-green-500',
    path: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    title: 'Teams',
    body: 'Start a team, invite people and keep its tasks and attendance in one place.',
    bullets: [
      'Create a team and invite people to it',
      "Leaders review the team's tasks and attendance",
      'Admins can see and manage every team',
    ],
    iconBg: 'bg-neutral-900',
    dot: 'bg-teal-500',
    path: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z',
  },
  {
    title: 'Chat',
    body: 'Message people directly, or talk with the whole team in its own chat room.',
    bullets: ['Direct messages, with online status', 'A chat room for each team', 'Read receipts and unread counts'],
    iconBg: 'bg-emerald-600',
    dot: 'bg-cyan-500',
    path: 'M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z',
  },
  {
    title: 'Social Hub',
    body: 'Share updates with your team, keep personal to-dos and connect with colleagues.',
    bullets: [
      'A feed with likes and comments',
      'Publish posts to LinkedIn or GitHub',
      'Personal to-dos and connections',
    ],
    iconBg: 'bg-blue-600',
    dot: 'bg-rose-500',
    path: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z',
  },
  {
    title: 'User Management',
    body: 'Role-based access control with secure authentication and user profile management.',
    bullets: ['Four roles: user, team member, team leader and admin', 'Secure JWT authentication', 'Profile management'],
    iconBg: 'bg-neutral-900',
    dot: 'bg-purple-500',
    path: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  },
  {
    title: 'Admin Dashboard',
    body: 'Comprehensive admin panel with analytics and management tools.',
    bullets: ['Real-time analytics', 'User activity monitoring', 'Task statistics'],
    iconBg: 'bg-emerald-600',
    dot: 'bg-orange-500',
    path: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  {
    title: 'Contact Management',
    body: 'Handle inquiries and feedback through an integrated contact system.',
    bullets: ['Contact form submissions', 'Message tracking', 'Response management'],
    iconBg: 'bg-blue-600',
    dot: 'bg-pink-500',
    path: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
  {
    title: 'Security',
    body: 'Enterprise-grade security with encrypted data storage and secure access.',
    bullets: ['JWT token authentication', 'Password encryption', 'Protected API routes'],
    iconBg: 'bg-neutral-900',
    dot: 'bg-indigo-500',
    path: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  },
]

// What each of the four roles can do
const ROLES = [
  {
    title: 'Users',
    intro: 'Everyone starts here.',
    tick: 'text-emerald-600',
    items: [
      'View and update assigned tasks',
      'Quick attendance check-in/out',
      'Chat and the Social Hub',
      'Personal profile and work history',
      'Start a team, or accept an invite to one',
    ],
  },
  {
    title: 'Team Members',
    intro: 'Joined a team by invite.',
    tick: 'text-teal-600',
    items: [
      "Work on the team's tasks",
      'Check in and out each day',
      "The team's chat room",
      'Everything a user can do, inside one team',
    ],
  },
  {
    title: 'Team Leaders',
    intro: 'Created a team, or made a leader by an admin.',
    tick: 'text-purple-600',
    items: [
      "Create, edit and assign the team's tasks",
      "Review the team's tasks and attendance",
      'Invite people to the team and remove them',
      "Approve members' LinkedIn and GitHub posts",
    ],
  },
  {
    title: 'Administrators',
    intro: 'Set by another admin.',
    tick: 'text-blue-600',
    items: [
      'Create and assign tasks to team members',
      'Monitor attendance and work hours',
      'Manage user accounts and permissions',
      'Access analytics and reports',
      'Review and respond to inquiries',
    ],
  },
]

function Service() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section (the top padding clears the fixed header) */}
      <section className="border-b border-neutral-200 bg-neutral-50 pb-16 pt-28 md:pb-20 md:pt-32">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <div className="mb-4 inline-block rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-medium text-emerald-800">
            Complete Solutions
          </div>
          <h1 className="mb-4 text-4xl font-bold text-neutral-900 md:text-5xl lg:text-6xl">
            Our Services
          </h1>
          <p className="mx-auto max-w-2xl text-base text-neutral-600 md:text-lg">
            Complete workforce management solutions for modern teams
          </p>
        </div>
      </section>

      {/* Main Services */}
      <section className="border-b border-neutral-200 bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Core Features</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Everything you need to manage your team effectively
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg ${feature.iconBg}`}>
                  <svg aria-hidden="true" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={feature.path} />
                  </svg>
                </div>
                <h3 className="mb-3 text-xl font-bold text-neutral-900">{feature.title}</h3>
                <p className="mb-4 text-neutral-600 leading-relaxed">{feature.body}</p>
                <ul className="space-y-2 text-sm text-neutral-700">
                  {feature.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2">
                      <span aria-hidden="true" className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${feature.dot}`}></span>
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="border-b border-neutral-200 bg-neutral-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Why Choose Pandav</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Built with modern technology and best practices for optimal performance
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm hover:shadow-md transition-shadow">
              <div className="mb-4 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-600">
                  <svg aria-hidden="true" className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-bold text-neutral-900">Fast & Efficient</h3>
              <p className="text-neutral-600 text-sm">
                Optimized performance for quick load times and smooth user experience across all features
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm hover:shadow-md transition-shadow">
              <div className="mb-4 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-blue-600">
                  <svg aria-hidden="true" className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-bold text-neutral-900">Responsive Design</h3>
              <p className="text-neutral-600 text-sm">
                Works seamlessly across desktop, tablet, and mobile devices with adaptive layouts
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm hover:shadow-md transition-shadow">
              <div className="mb-4 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-neutral-900">
                  <svg aria-hidden="true" className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-bold text-neutral-900">Secure & Reliable</h3>
              <p className="text-neutral-600 text-sm">
                Built with security best practices and reliable infrastructure for 99.9% uptime
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Technology Stack */}
      <section className="border-b border-neutral-200 bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Built With Modern Technology</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Powered by industry-leading technologies for optimal performance and scalability
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-center">
              <div className="mb-3 text-2xl font-bold text-neutral-900">MERN</div>
              <p className="text-sm text-neutral-600">MongoDB, Express, React, Node.js full-stack solution</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-center">
              <div className="mb-3 text-2xl font-bold text-neutral-900">TypeScript</div>
              <p className="text-sm text-neutral-600">Type-safe code for better development experience</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-center">
              <div className="mb-3 text-2xl font-bold text-neutral-900">TailwindCSS</div>
              <p className="text-sm text-neutral-600">Modern utility-first CSS framework</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-center">
              <div className="mb-3 text-2xl font-bold text-neutral-900">JWT Auth</div>
              <p className="text-sm text-neutral-600">Secure token-based authentication system</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-b border-neutral-200 bg-neutral-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Trusted By Teams Worldwide</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Join thousands of organizations already streamlining their operations
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-4">
            <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
              <div className="mb-2 text-3xl font-bold text-emerald-600">500+</div>
              <p className="text-sm text-neutral-600">Active Users</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
              <div className="mb-2 text-3xl font-bold text-blue-600">10K+</div>
              <p className="text-sm text-neutral-600">Tasks Completed</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
              <div className="mb-2 text-3xl font-bold text-neutral-900">99.9%</div>
              <p className="text-sm text-neutral-600">Uptime</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
              <div className="mb-2 text-3xl font-bold text-emerald-600">24/7</div>
              <p className="text-sm text-neutral-600">Support</p>
            </div>
          </div>
        </div>
      </section>

      {/* The four roles */}
      <section className="border-b border-neutral-200 bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Everything You Need</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Four roles, each with the tools it needs to manage the work
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 shadow-sm">
            <div className="grid gap-px md:grid-cols-2 lg:grid-cols-4">
              {ROLES.map((role) => (
                <div key={role.title} className="bg-white p-6">
                  <h3 className="text-lg font-bold text-neutral-900">For {role.title}</h3>
                  <p className="mb-4 mt-1 text-sm text-neutral-500">{role.intro}</p>
                  <ul className="space-y-3">
                    {role.items.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <svg aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${role.tick}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm text-neutral-700">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-4xl px-4">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-8 text-center md:p-12">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900 md:text-4xl">Ready to Get Started?</h2>
            <p className="mb-8 text-base text-neutral-600 md:text-lg">
              Join teams using Pandav to streamline their operations
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                to="/register"
                className="rounded-lg bg-neutral-900 px-6 py-3 text-sm font-semibold text-white shadow-md outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
              >
                Get Started
              </Link>
              <Link
                to="/contact"
                className="rounded-lg border border-neutral-300 bg-white px-6 py-3 text-sm font-semibold text-neutral-900 outline-none hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
              >
                Contact Us
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}

export default Service

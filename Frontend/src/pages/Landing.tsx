export default function Landing() {
  return (
      <div className="min-h-screen bg-linear-to-b from-neutral-50 to-white">
        
      {/* Hero Section */}
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-16 text-center md:pt-24">
        <div className="mb-4 inline-block rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-medium text-emerald-800">
          Team Management Platform
        </div>
        <h1 className="mb-4 text-4xl font-bold leading-tight text-neutral-900 md:text-5xl lg:text-6xl">
          Manage Your Team's
          <br />
          <span className="bg-linear-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
            Tasks & Attendance
          </span>
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-base text-neutral-600 md:text-lg">
          Streamline task assignment, track attendance in real-time, and boost productivity with our all-in-one team management solution.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href="#get-started"
            className="rounded-lg bg-neutral-900 px-6 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90"
          >
            Get Started Free
          </a>
          <a
            href="#features"
            className="rounded-lg border border-neutral-300 bg-white px-6 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
          >
            View Features
          </a>
        </div>
      </section>

      {/* Stats Section */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-neutral-900 md:text-3xl">10K+</p>
            <p className="text-xs text-neutral-600 md:text-sm">Active Teams</p>
          </div>
          <div className="rounded-xl border bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-neutral-900 md:text-3xl">50K+</p>
            <p className="text-xs text-neutral-600 md:text-sm">Tasks Completed</p>
          </div>
          <div className="rounded-xl border bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-neutral-900 md:text-3xl">98%</p>
            <p className="text-xs text-neutral-600 md:text-sm">Attendance Rate</p>
          </div>
          <div className="rounded-xl border bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-neutral-900 md:text-3xl">24/7</p>
            <p className="text-xs text-neutral-600 md:text-sm">Support</p>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-12 text-center">
          <h2 className="mb-3 text-3xl font-bold text-neutral-900 md:text-4xl">Everything You Need</h2>
          <p className="text-base text-neutral-600 md:text-lg">
            Powerful features to manage your team effectively
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Task Management */}
          <div className="group rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
              <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">Task Management</h3>
            <p className="text-sm text-neutral-600">
              Create, assign, and track tasks with priorities, due dates, and status updates. Keep everyone aligned.
            </p>
          </div>

          {/* Attendance Tracking */}
          <div className="group rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100">
              <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">Attendance Tracking</h3>
            <p className="text-sm text-neutral-600">
              Mark attendance with timestamps, track patterns, and generate reports. Stay compliant effortlessly.
            </p>
          </div>

          {/* Team Collaboration */}
          <div className="group rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100">
              <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">Team Collaboration</h3>
            <p className="text-sm text-neutral-600">
              Communicate seamlessly, share updates, and collaborate on projects with your entire team in one place.
            </p>
          </div>

          {/* Real-time Analytics */}
          <div className="group rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100">
              <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">Real-time Analytics</h3>
            <p className="text-sm text-neutral-600">
              Visualize productivity trends, attendance patterns, and task completion rates with interactive dashboards.
            </p>
          </div>

          {/* Custom Reports */}
          <div className="group rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">Custom Reports</h3>
            <p className="text-sm text-neutral-600">
              Generate detailed reports for tasks, attendance, and team performance. Export in multiple formats.
            </p>
          </div>

          {/* Mobile Access */}
          <div className="group rounded-xl border bg-white p-6 shadow-sm transition hover:shadow-md">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100">
              <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-neutral-900">Mobile Access</h3>
            <p className="text-sm text-neutral-600">
              Access your team dashboard anywhere, anytime. Fully responsive design for desktop, tablet, and mobile.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="bg-neutral-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-3xl font-bold text-neutral-900 md:text-4xl">How It Works</h2>
            <p className="text-base text-neutral-600 md:text-lg">Get started in three simple steps</p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="mb-4 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-900 text-2xl font-bold text-white">
                  1
                </div>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-neutral-900">Create Your Team</h3>
              <p className="text-sm text-neutral-600">
                Set up your workspace and invite team members with custom roles and permissions.
              </p>
            </div>

            <div className="text-center">
              <div className="mb-4 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-900 text-2xl font-bold text-white">
                  2
                </div>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-neutral-900">Add Tasks & Track Attendance</h3>
              <p className="text-sm text-neutral-600">
                Create tasks with priorities, mark attendance daily, and keep everyone on the same page.
              </p>
            </div>

            <div className="text-center">
              <div className="mb-4 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-900 text-2xl font-bold text-white">
                  3
                </div>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-neutral-900">Monitor & Improve</h3>
              <p className="text-sm text-neutral-600">
                Track progress with analytics, generate reports, and optimize team performance over time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="get-started" className="mx-auto max-w-4xl px-4 py-20 text-center">
        <h2 className="mb-4 text-3xl font-bold text-neutral-900 md:text-4xl">
          Ready to Transform Your Team Management?
        </h2>
        <p className="mb-8 text-base text-neutral-600 md:text-lg">
          Join thousands of teams already using our platform to boost productivity.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href="#signup"
            className="rounded-lg bg-neutral-900 px-8 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90"
          >
            Start Free Trial
          </a>
          <a
            href="/contact"
            className="rounded-lg border border-neutral-300 bg-white px-8 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
          >
            Schedule Demo
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-neutral-50 py-8">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <p className="text-sm text-neutral-600">
            © 2025 Pandav Team Management. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}

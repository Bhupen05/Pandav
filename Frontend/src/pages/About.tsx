function About() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="border-b bg-neutral-50 py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <div className="mb-6 inline-block rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-medium text-emerald-800">
              Powering teams since 2024
            </div>
            <h1 className="mb-6 text-4xl font-bold leading-tight text-neutral-900 md:text-5xl lg:text-6xl">
              About <span className="bg-linear-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">Pandav</span>
            </h1>
            <p className="mx-auto max-w-3xl text-base leading-relaxed text-neutral-600 md:text-lg">
              Empowering teams worldwide with seamless task management, intelligent attendance tracking, and collaborative workspace solutions that drive productivity and success.
            </p>
          </div>
        </div>
      </section>

      {/* Story Section */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Our Story</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Born from the need to simplify workforce management, Pandav has evolved into a comprehensive solution trusted by teams globally.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl bg-linear-to-br from-blue-50 to-blue-100 p-8">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600 text-white">
                🎯
              </div>
              <h3 className="mb-3 text-2xl font-bold text-neutral-900">Our Mission</h3>
              <p className="mb-3 text-neutral-700 leading-relaxed">
                At Pandav, we're on a mission to transform how teams work together. We believe that effective collaboration shouldn't be complicated. Our platform is designed to eliminate friction, streamline workflows, and help teams stay organized.
              </p>
              <p className="text-neutral-700 leading-relaxed">
                Every feature we build is guided by one principle: make it simple, make it powerful, make it accessible to everyone.
              </p>
            </div>
            <div className="rounded-2xl bg-linear-to-br from-purple-50 to-purple-100 p-8">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-purple-600 text-white">
                🔮
              </div>
              <h3 className="mb-3 text-2xl font-bold text-neutral-900">Our Vision</h3>
              <p className="mb-3 text-neutral-700 leading-relaxed">
                We envision a future where every organization, regardless of size, has access to enterprise-grade workforce management tools. A world where teams can focus on innovation and growth instead of administrative overhead.
              </p>
              <p className="text-neutral-700 leading-relaxed">
                Through continuous innovation and listening to our users, we're building the future of work management, one feature at a time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">What We Offer</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Comprehensive tools designed to streamline your workflow and boost team productivity
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            <div className="group rounded-xl border bg-neutral-50 p-6 transition-all hover:shadow-lg hover:-translate-y-1">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-linear-to-br from-blue-500 to-blue-600 text-white shadow-lg">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-neutral-900">Task Management</h3>
              <p className="text-neutral-600 leading-relaxed">
                Create, assign, and track tasks with ease. Set priorities, deadlines, and monitor progress in real-time with our intuitive interface.
              </p>
            </div>

            <div className="group rounded-xl border bg-neutral-50 p-6 transition-all hover:shadow-lg hover:-translate-y-1">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-linear-to-br from-green-500 to-green-600 text-white shadow-lg">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-neutral-900">Attendance Tracking</h3>
              <p className="text-neutral-600 leading-relaxed">
                Automated check-in/check-out system with work hours calculation, leave management, and comprehensive attendance reporting.
              </p>
            </div>

            <div className="group rounded-xl border bg-neutral-50 p-6 transition-all hover:shadow-lg hover:-translate-y-1">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-linear-to-br from-purple-500 to-purple-600 text-white shadow-lg">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-neutral-900">Team Collaboration</h3>
              <p className="text-neutral-600 leading-relaxed">
                Enhance team productivity with role-based access, admin controls, user management, and seamless communication tools.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="border-b bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Our Core Values</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              The principles that guide everything we do and shape our culture
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-white p-6 text-center shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-600">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-lg font-bold text-neutral-900">Efficiency</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">Streamlined workflows that save time and boost productivity for every team member</p>
            </div>

            <div className="rounded-2xl bg-white p-6 text-center shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-green-500 to-green-600 shadow-lg">
                  <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-lg font-bold text-neutral-900">Reliability</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">Dependable system you can trust for your most critical business operations</p>
            </div>

            <div className="rounded-2xl bg-white p-6 text-center shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-purple-500 to-purple-600 shadow-lg">
                  <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-lg font-bold text-neutral-900">Simplicity</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">Intuitive interface designed for ease of use without sacrificing powerful features</p>
            </div>

            <div className="rounded-2xl bg-white p-6 text-center shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-orange-500 to-orange-600 shadow-lg">
                  <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-lg font-bold text-neutral-900">Innovation</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">Continuously evolving with latest technology trends and user feedback</p>
            </div>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="border-b bg-neutral-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-4 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Trusted Worldwide</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Organizations across the globe rely on Pandav to manage their workforce efficiently
            </p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
              <div className="mb-3 text-4xl font-bold text-neutral-900">500+</div>
              <div className="text-lg font-semibold text-neutral-900">Active Users</div>
              <div className="mt-2 text-sm text-neutral-600">Growing community of professionals</div>
            </div>
            <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
              <div className="mb-3 text-4xl font-bold text-neutral-900">10K+</div>
              <div className="text-lg font-semibold text-neutral-900">Tasks Completed</div>
              <div className="mt-2 text-sm text-neutral-600">Delivered with excellence</div>
            </div>
            <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
              <div className="mb-3 text-4xl font-bold text-neutral-900">99.9%</div>
              <div className="text-lg font-semibold text-neutral-900">Uptime</div>
              <div className="mt-2 text-sm text-neutral-600">Always available when you need us</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-4xl px-4">
          <div className="rounded-xl border bg-neutral-50 p-8 text-center md:p-12">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900 md:text-4xl">Ready to Transform Your Workflow?</h2>
            <p className="mb-8 text-base text-neutral-600 md:text-lg">
              Join hundreds of teams already using Pandav to streamline their operations and achieve more
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a
                href="/login"
                className="rounded-lg bg-neutral-900 px-6 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90"
              >
                Get Started Now
              </a>
              <a
                href="/contact"
                className="rounded-lg border border-neutral-300 bg-white px-6 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
              >
                Contact Us
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default About

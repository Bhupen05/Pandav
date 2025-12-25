function Service() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="border-b bg-neutral-50 py-16 md:py-20">
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
      <section className="border-b bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Core Features</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Everything you need to manage your team effectively
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Service 1 */}
            <div className="group rounded-xl border bg-white p-6 shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-600">
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <h3 className="mb-3 text-xl font-bold text-neutral-900">Task Management</h3>
              <p className="mb-4 text-neutral-600 leading-relaxed">
                Create, assign, and track tasks with real-time progress monitoring and priority settings.
              </p>
              <ul className="space-y-2 text-sm text-neutral-700">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500"></span>
                  Task creation and assignment
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500"></span>
                  Priority and deadline management
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500"></span>
                  Real-time status updates
                </li>
              </ul>
            </div>

            {/* Service 2 */}
            <div className="group rounded-xl border bg-white p-6 shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600">
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="mb-3 text-xl font-bold text-neutral-900">Attendance Tracking</h3>
              <p className="mb-4 text-neutral-600 leading-relaxed">
                Automated attendance system with check-in/out functionality and comprehensive reporting.
              </p>
              <ul className="space-y-2 text-sm text-neutral-700">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                  Quick check-in/check-out
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                  Automatic hours calculation
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                  Detailed attendance reports
                </li>
              </ul>
            </div>

            {/* Service 3 */}
            <div className="group rounded-xl border bg-white p-6 shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-900">
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="mb-3 text-xl font-bold text-neutral-900">User Management</h3>
              <p className="mb-4 text-neutral-600 leading-relaxed">
                Role-based access control with secure authentication and user profile management.
              </p>
              <ul className="space-y-2 text-sm text-neutral-700">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-500"></span>
                  Admin and user roles
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-500"></span>
                  Secure JWT authentication
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-500"></span>
                  Profile management
                </li>
              </ul>
            </div>

            {/* Service 4 */}
            <div className="group rounded-xl border bg-white p-6 shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-600">
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="mb-3 text-xl font-bold text-neutral-900">Admin Dashboard</h3>
              <p className="mb-4 text-neutral-600 leading-relaxed">
                Comprehensive admin panel with analytics and management tools.
              </p>
              <ul className="space-y-2 text-sm text-neutral-700">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
                  Real-time analytics
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
                  User activity monitoring
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-orange-500"></span>
                  Task statistics
                </li>
              </ul>
            </div>

            {/* Service 5 */}
            <div className="group rounded-xl border bg-white p-6 shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-600">
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="mb-3 text-xl font-bold text-neutral-900">Contact Management</h3>
              <p className="mb-4 text-neutral-600 leading-relaxed">
                Handle inquiries and feedback through an integrated contact system.
              </p>
              <ul className="space-y-2 text-sm text-neutral-700">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
                  Contact form submissions
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
                  Message tracking
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
                  Response management
                </li>
              </ul>
            </div>

            {/* Service 6 */}
            <div className="group rounded-xl border bg-white p-6 shadow-sm transition-all hover:shadow-md">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-900">
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="mb-3 text-xl font-bold text-neutral-900">Security</h3>
              <p className="mb-4 text-neutral-600 leading-relaxed">
                Enterprise-grade security with encrypted data storage and secure access.
              </p>
              <ul className="space-y-2 text-sm text-neutral-700">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                  JWT token authentication
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                  Password encryption
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                  Protected API routes
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="border-b bg-neutral-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Why Choose Pandav</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Built with modern technology and best practices for optimal performance
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border bg-white p-6 text-center shadow-sm hover:shadow-md transition-shadow">
              <div className="mb-4 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-600">
                  <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-bold text-neutral-900">Fast & Efficient</h3>
              <p className="text-neutral-600 text-sm">
                Optimized performance for quick load times and smooth user experience across all features
              </p>
            </div>

            <div className="rounded-xl border bg-white p-6 text-center shadow-sm hover:shadow-md transition-shadow">
              <div className="mb-4 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-blue-600">
                  <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-bold text-neutral-900">Responsive Design</h3>
              <p className="text-neutral-600 text-sm">
                Works seamlessly across desktop, tablet, and mobile devices with adaptive layouts
              </p>
            </div>

            <div className="rounded-xl border bg-white p-6 text-center shadow-sm hover:shadow-md transition-shadow">
              <div className="mb-4 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-neutral-900">
                  <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
      <section className="border-b bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Built With Modern Technology</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Powered by industry-leading technologies for optimal performance and scalability
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-neutral-50 p-6 text-center">
              <div className="mb-3 text-2xl font-bold text-neutral-900">MERN</div>
              <p className="text-sm text-neutral-600">MongoDB, Express, React, Node.js full-stack solution</p>
            </div>
            <div className="rounded-xl border bg-neutral-50 p-6 text-center">
              <div className="mb-3 text-2xl font-bold text-neutral-900">TypeScript</div>
              <p className="text-sm text-neutral-600">Type-safe code for better development experience</p>
            </div>
            <div className="rounded-xl border bg-neutral-50 p-6 text-center">
              <div className="mb-3 text-2xl font-bold text-neutral-900">TailwindCSS</div>
              <p className="text-sm text-neutral-600">Modern utility-first CSS framework</p>
            </div>
            <div className="rounded-xl border bg-neutral-50 p-6 text-center">
              <div className="mb-3 text-2xl font-bold text-neutral-900">JWT Auth</div>
              <p className="text-sm text-neutral-600">Secure token-based authentication system</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-b bg-neutral-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Trusted By Teams Worldwide</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              Join thousands of organizations already streamlining their operations
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-4">
            <div className="rounded-xl border bg-white p-6 text-center shadow-sm">
              <div className="mb-2 text-3xl font-bold text-emerald-600">500+</div>
              <p className="text-sm text-neutral-600">Active Users</p>
            </div>
            <div className="rounded-xl border bg-white p-6 text-center shadow-sm">
              <div className="mb-2 text-3xl font-bold text-blue-600">10K+</div>
              <p className="text-sm text-neutral-600">Tasks Completed</p>
            </div>
            <div className="rounded-xl border bg-white p-6 text-center shadow-sm">
              <div className="mb-2 text-3xl font-bold text-neutral-900">99.9%</div>
              <p className="text-sm text-neutral-600">Uptime</p>
            </div>
            <div className="rounded-xl border bg-white p-6 text-center shadow-sm">
              <div className="mb-2 text-3xl font-bold text-emerald-600">24/7</div>
              <p className="text-sm text-neutral-600">Support</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Comparison */}
      <section className="border-b bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900">Everything You Need</h2>
            <p className="mx-auto max-w-2xl text-neutral-600">
              All essential features included to manage your team effectively
            </p>
          </div>
          
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="grid md:grid-cols-2">
              <div className="p-6 border-b md:border-b-0 md:border-r">
                <h3 className="mb-4 text-lg font-bold text-neutral-900">For Team Members</h3>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">View and update assigned tasks</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">Quick attendance check-in/out</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">Personal profile management</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">View work history and stats</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">Submit inquiries via contact form</span>
                  </li>
                </ul>
              </div>
              <div className="p-6">
                <h3 className="mb-4 text-lg font-bold text-neutral-900">For Administrators</h3>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">Create and assign tasks to team members</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">Monitor attendance and work hours</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">Manage user accounts and permissions</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">Access analytics and reports</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm text-neutral-700">Review and respond to inquiries</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-white py-16">
        <div className="mx-auto max-w-4xl px-4">
          <div className="rounded-xl border bg-neutral-50 p-8 text-center md:p-12">
            <h2 className="mb-4 text-3xl font-bold text-neutral-900 md:text-4xl">Ready to Get Started?</h2>
            <p className="mb-8 text-base text-neutral-600 md:text-lg">
              Join teams using Pandav to streamline their operations
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a
                href="/login"
                className="rounded-lg bg-neutral-900 px-6 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90"
              >
                Get Started
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

export default Service

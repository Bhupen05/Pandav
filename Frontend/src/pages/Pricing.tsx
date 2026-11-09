import { Link } from 'react-router-dom'
import Footer from '../components/Footer'

const plans = [
  {
    name: 'Starter',
    price: '$0',
    period: '/month',
    description: 'For small teams starting with digital task and attendance tracking.',
    features: ['Up to 10 members', 'Task board', 'Attendance check-in/out', 'Basic chat'],
    cta: 'Start Free',
    to: '/register',
    featured: false,
  },
  {
    name: 'Growth',
    price: '$29',
    period: '/month',
    description: 'For growing teams needing approvals, analytics, and better visibility.',
    features: [
      'Up to 75 members',
      'Task approval workflows',
      'Attendance approvals',
      'Team management',
      'Priority support',
    ],
    cta: 'Choose Growth',
    to: '/register?plan=growth',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For organizations requiring advanced governance and dedicated support.',
    features: [
      'Unlimited members',
      'Advanced admin controls',
      'SLA and onboarding support',
      'Integration consultation',
      'Dedicated success manager',
    ],
    cta: 'Contact Sales',
    // The contact form starts with this as its subject
    to: '/contact?topic=Enterprise%20plan',
    featured: false,
  },
]

export default function Pricing() {
  return (
    <div className="min-h-screen">
      {/* pt-28 clears the fixed header */}
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-28 sm:px-6">
        <div className="mb-10 text-center">
          <p className="mb-3 inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold tracking-wide text-primary">
            Pandav Pricing
          </p>
          <h1 className="text-4xl font-extrabold text-secondary sm:text-5xl">Simple plans for every stage</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-600 sm:text-base">
            Start free, scale with confidence, and keep your operations in one clean digital atrium.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`flex flex-col rounded-xl border p-6 ${
                plan.featured
                  ? 'border-primary bg-white ring-2 ring-blue-100'
                  : 'border-slate-200 bg-white'
              }`}
            >
              {plan.featured && (
                <span className="mb-3 inline-flex self-start rounded-md bg-primary px-2 py-1 text-xs font-semibold text-white">
                  Most Popular
                </span>
              )}
              <h2 className="text-xl font-bold text-slate-900">{plan.name}</h2>
              <p className="mt-2 text-sm text-slate-600">{plan.description}</p>

              <div className="mt-5 flex items-end gap-1">
                <span className="text-4xl font-extrabold text-primary">{plan.price}</span>
                {plan.period && <span className="pb-1 text-sm text-slate-500">{plan.period}</span>}
              </div>

              <ul className="mb-6 mt-5 space-y-2 text-sm text-slate-700">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs text-emerald-700">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                to={plan.to}
                className={`mt-auto block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  plan.featured
                    ? 'bg-primary text-white hover:opacity-95'
                    : 'border border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100'
                }`}
              >
                {plan.cta}
              </Link>
            </article>
          ))}
        </div>

        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-bold text-slate-900">Frequently asked questions</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-semibold text-slate-900">Can I change plans later?</p>
              <p className="mt-1 text-sm text-slate-600">Yes. You can upgrade or downgrade your plan as your team evolves.</p>
            </div>
            <div>
              <p className="font-semibold text-slate-900">Is support included?</p>
              <p className="mt-1 text-sm text-slate-600">Starter includes community help, while paid plans include priority support.</p>
            </div>
            <div>
              <p className="font-semibold text-slate-900">Do you offer annual billing?</p>
              <p className="mt-1 text-sm text-slate-600">Yes, annual plans are available with discounted pricing.</p>
            </div>
            <div>
              <p className="font-semibold text-slate-900">Need a custom setup?</p>
              <p className="mt-1 text-sm text-slate-600">Enterprise includes tailored onboarding and implementation support.</p>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-xl border border-blue-200 bg-linear-to-r from-blue-50 to-slate-50 p-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900">Ready to get started?</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            Create your account and organize tasks, attendance, and collaboration in one place.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link
              to="/register"
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white outline-none hover:opacity-95 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Create Account
            </Link>
            <Link
              to="/contact?topic=Sales"
              className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Talk to Sales
            </Link>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
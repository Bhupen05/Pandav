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
    featured: false,
  },
]

export default function Pricing() {
  return (
    <div className="min-h-screen px-4 pb-12 pt-24 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 text-center">
          <p className="mb-3 inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold tracking-wide text-[--color-primary]">
            Pandav Pricing
          </p>
          <h1 className="text-4xl font-extrabold text-[--color-secondary] sm:text-5xl">Simple plans for every stage</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-slate-600 sm:text-base">
            Start free, scale with confidence, and keep your operations in one clean digital atrium.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`rounded-xl border p-6 ${
                plan.featured
                  ? 'border-[--color-primary] bg-white ring-2 ring-blue-100'
                  : 'border-slate-200 bg-white'
              }`}
            >
              {plan.featured && (
                <span className="mb-3 inline-flex rounded-md bg-[--color-primary] px-2 py-1 text-xs font-semibold text-white">
                  Most Popular
                </span>
              )}
              <h2 className="text-xl font-bold text-slate-900">{plan.name}</h2>
              <p className="mt-2 text-sm text-slate-600">{plan.description}</p>

              <div className="mt-5 flex items-end gap-1">
                <span className="text-4xl font-extrabold text-[--color-primary]">{plan.price}</span>
                {plan.period && <span className="pb-1 text-sm text-slate-500">{plan.period}</span>}
              </div>

              <ul className="mt-5 space-y-2 text-sm text-slate-700">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs text-emerald-700">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  plan.featured
                    ? 'bg-[--color-primary] text-white hover:opacity-95'
                    : 'border border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100'
                }`}
              >
                {plan.cta}
              </button>
            </article>
          ))}
        </div>

        <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
          <h3 className="text-xl font-bold text-slate-900">Frequently asked questions</h3>
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
          <h3 className="text-2xl font-bold text-slate-900">Ready to get started?</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            Create your account and organize tasks, attendance, and collaboration in one place.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="rounded-lg bg-[--color-primary] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-95">
              Create Account
            </Link>
            <Link to="/contact" className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              Talk to Sales
            </Link>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
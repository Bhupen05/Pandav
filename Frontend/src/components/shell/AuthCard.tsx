import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// The card the sign-in, sign-up and password screens sit on: the brand, a
// title, and room under the fixed public header.
export default function AuthCard({
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 pb-12 pt-28">
      <div className={`w-full rounded-xl border border-neutral-200 bg-white p-6 shadow-sm ${wide ? 'max-w-lg' : 'max-w-md'}`}>
        <Link to="/" className="mb-4 block text-center text-2xl font-black tracking-tight text-primary">
          Pandav
        </Link>
        <h1 className="mb-1 text-center text-2xl font-semibold text-neutral-900">{title}</h1>
        {subtitle && <p className="mb-6 text-center text-sm text-neutral-600">{subtitle}</p>}
        {!subtitle && <div className="mb-6" />}

        {children}

        {footer && <p className="mt-4 text-center text-xs text-neutral-600">{footer}</p>}
      </div>
    </div>
  )
}

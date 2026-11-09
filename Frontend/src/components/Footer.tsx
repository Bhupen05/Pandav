import { Link } from 'react-router-dom'

// Only pages that exist: no documentation, legal pages or social accounts yet
const COLUMNS = [
  {
    title: 'Product',
    links: [
      { to: '/', label: 'Features' },
      { to: '/service', label: 'Services' },
      { to: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Company',
    links: [
      { to: '/about', label: 'About Us' },
      { to: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Account',
    links: [
      { to: '/login', label: 'Login' },
      { to: '/register', label: 'Create Account' },
    ],
  },
]

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-8 gap-y-10 px-6 py-16 sm:grid-cols-3 sm:px-8 lg:grid-cols-5 lg:gap-12">
        <div className="col-span-2 sm:col-span-3 lg:col-span-2">
          <span className="mb-4 block font-headline text-2xl font-bold text-primary">Pandav</span>
          <p className="max-w-xs text-sm leading-relaxed text-slate-500">
            © {year} Pandav Technologies. The Digital Atrium for modern teams. Orchestrating excellence in every interaction.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-labelledby={`footer-${column.title.toLowerCase()}`} className="flex flex-col gap-4">
            <h2 id={`footer-${column.title.toLowerCase()}`} className="text-xs font-bold uppercase tracking-widest text-primary">
              {column.title}
            </h2>
            {column.links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="w-fit rounded-sm text-sm text-slate-500 outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
    </footer>
  )
}

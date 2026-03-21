import { AtSign, Globe } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-12 px-8 py-16 md:grid-cols-4 lg:grid-cols-6">
        <div className="col-span-2">
          <span className="mb-4 block font-headline text-2xl font-bold text-primary">Pandav</span>
          <p className="mb-8 max-w-xs text-sm leading-relaxed text-slate-500">
            © 2024 Pandav Technologies. The Digital Atrium for modern teams. Orchestrating excellence in every interaction.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Product</span>
          <a className="text-sm text-slate-500 transition-colors hover:text-primary" href="#">Features</a>
          <a className="text-sm text-slate-500 transition-colors hover:text-primary" href="/pricing">Pricing</a>
          <a className="text-sm text-slate-500 transition-colors hover:text-primary" href="/about">About Us</a>
        </div>
        <div className="flex flex-col gap-4">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Support</span>
          <a className="text-sm text-slate-500 transition-colors hover:text-primary" href="/contact">Contact</a>
          <a className="text-sm text-slate-500 transition-colors hover:text-primary" href="#">Documentation</a>
          <a className="text-sm text-slate-500 transition-colors hover:text-primary" href="#">Help Center</a>
        </div>
        <div className="flex flex-col gap-4">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Legal</span>
          <a className="text-sm text-slate-500 transition-colors hover:text-primary" href="#">Privacy Policy</a>
          <a className="text-sm text-slate-500 transition-colors hover:text-primary" href="#">Terms of Service</a>
        </div>
        <div className="flex flex-col gap-4">
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Social</span>
          <div className="flex gap-4">
            <a className="text-slate-500 transition-colors hover:text-primary" href="#">
              <Globe className="h-5 w-5" />
            </a>
            <a className="text-slate-500 transition-colors hover:text-primary" href="#">
              <AtSign className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
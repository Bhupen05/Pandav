// Classes shared by the account screens (sign in, sign up, reset, profile), so
// their fields and buttons look the same. Every border has a colour, and focus
// is drawn by the global :focus-visible ring in index.css.
export const labelClass = 'mb-1 block text-sm font-medium text-neutral-800'

export const inputClass =
  'block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-emerald-600 disabled:bg-neutral-50 disabled:text-neutral-500'

export const primaryButtonClass =
  'inline-flex items-center justify-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50'

export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50'

export const dangerButtonClass =
  'inline-flex items-center justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'

export const linkClass = 'font-medium text-emerald-700 hover:text-emerald-800 hover:underline'

export const errorBoxClass = 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'
export const successBoxClass = 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
export const infoBoxClass = 'rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900'

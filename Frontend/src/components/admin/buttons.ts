// Button looks shared by the admin pages and the approvals inbox
const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

export const BTN = {
  // Sizes
  sm: `${base} px-2.5 py-1 text-xs`,
  md: `${base} px-4 py-2 text-sm`,
  // Looks, added after a size
  neutral: 'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50',
  primary: 'border border-neutral-900 bg-neutral-900 text-white hover:opacity-90',
  success: 'border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
  danger: 'border border-red-300 bg-white text-red-600 hover:bg-red-50',
  dangerSolid: 'border border-red-600 bg-red-600 text-white hover:bg-red-700',
} as const

export const FIELD =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 disabled:bg-neutral-100'

export const LABEL = 'mb-1 block text-xs font-medium text-neutral-600'

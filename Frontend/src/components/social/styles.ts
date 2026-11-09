// Class names shared by the Social Hub views, so every form and button looks the same

export const inputClass =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60'

export const labelClass = 'mb-1.5 block text-sm font-semibold text-slate-700'

export const hintClass = 'mt-1 text-xs text-slate-500'

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

export const primaryButton = `${buttonBase} bg-sky-600 px-4 py-2.5 text-white hover:bg-sky-700`
export const darkButton = `${buttonBase} bg-slate-900 px-4 py-2.5 text-white hover:bg-slate-800`
export const successButton = `${buttonBase} bg-emerald-600 px-4 py-2.5 text-white hover:bg-emerald-700`
export const secondaryButton = `${buttonBase} border border-slate-200 bg-white px-4 py-2.5 text-slate-700 hover:bg-slate-50`
export const dangerButton = `${buttonBase} border border-rose-200 bg-rose-50 px-4 py-2.5 text-rose-700 hover:bg-rose-100`
export const smallButton = 'px-3 py-2 text-xs'
export const linkButton =
  'rounded text-sm font-semibold text-sky-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-60'

export const badgeClass = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold'

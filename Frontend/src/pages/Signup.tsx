/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

type Screen = 'login' | 'register';

export default function App() {
  const [screen, setScreen] = useState<Screen>('login');

  return (
    <div className="bg-surface font-body text-on-surface min-h-screen flex flex-col">

      <main className="flex items-center justify-center pt-24 pb-12 px-6">
        <AnimatePresence mode="wait">
          {screen === 'login' ? (
            <motion.div
              key="login"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-[1100px] flex bg-surface-container-low rounded-xl overflow-hidden shadow-sm border border-outline-variant/10"
            >
              {/* Left Side: Visual/Branding Section */}
              <div className="hidden lg:flex w-1/2 atrium-gradient p-16 flex-col justify-between relative overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -mr-24 -mt-24 blur-3xl"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-primary-container/20 rounded-full -ml-16 -mb-16 blur-2xl"></div>
                <div className="relative z-10">
                  <h2 className="font-headline text-4xl font-extrabold text-white leading-tight tracking-tight">
                    Architecting the<br />Future of Flow.
                  </h2>
                  <p className="mt-6 text-on-primary-container/80 text-lg font-light max-w-sm">
                    Enterprise-grade workspace management with architectural precision and human-centric design.
                  </p>
                </div>
                <div className="relative z-10 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-sm">
                    <span className="material-symbols-outlined text-white text-sm">verified_user</span>
                  </div>
                  <span className="text-white/60 text-xs font-label tracking-widest uppercase">Secured by Pandav Infrastructure</span>
                </div>
              </div>

              {/* Right Side: Login Form */}
              <div className="w-full lg:w-1/2 bg-surface-container-lowest p-8 md:p-16 flex flex-col justify-center">
                <div className="mb-10">
                  <h1 className="font-headline text-3xl font-bold text-primary tracking-tight">Welcome back</h1>
                  <p className="text-secondary mt-2">Sign in to your account</p>
                </div>
                <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-on-surface-variant/80 uppercase tracking-wider font-label" htmlFor="email">Email Address</label>
                    <input 
                      className="w-full h-12 px-4 bg-surface-container-highest rounded-xl focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 transition-all outline-none border-none placeholder:text-slate-400" 
                      id="email" 
                      placeholder="name@company.com" 
                      type="email" 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-semibold text-on-surface-variant/80 uppercase tracking-wider font-label" htmlFor="password">Password</label>
                      <a className="text-xs font-medium text-primary-container hover:underline transition-all" href="#">Forgot password?</a>
                    </div>
                    <input 
                      className="w-full h-12 px-4 bg-surface-container-highest rounded-xl focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 transition-all outline-none border-none placeholder:text-slate-400" 
                      id="password" 
                      placeholder="••••••••" 
                      type="password" 
                    />
                  </div>
                  <div className="flex items-center">
                    <input className="w-4 h-4 rounded border-none bg-surface-container-highest text-primary focus:ring-primary/20" id="remember" type="checkbox" />
                    <label className="ml-2 text-sm text-secondary font-medium select-none" htmlFor="remember">Remember me</label>
                  </div>
                  <button className="w-full h-12 atrium-gradient text-white font-headline font-bold rounded-xl shadow-lg shadow-primary/10 hover:opacity-90 transition-opacity active:scale-[0.98]" type="submit">
                    Sign in
                  </button>
                </form>
                <div className="my-8 flex items-center gap-4">
                  <div className="h-[1px] flex-grow bg-outline-variant/30"></div>
                  <span className="text-xs font-label text-slate-400 uppercase tracking-widest">or</span>
                  <div className="h-[1px] flex-grow bg-outline-variant/30"></div>
                </div>
                <button className="w-full h-12 bg-white border border-outline-variant/30 text-secondary font-medium rounded-xl flex items-center justify-center gap-3 hover:bg-slate-50 transition-colors shadow-sm">
                  <img 
                    alt="Google logo" 
                    className="w-5 h-5" 
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuDGT_KtcdSsip4FiUiFvFiAd38g3tCGG0ZhfegPCKeqlgxQk5tvTK6REpNK8G0y-c5H0_hTiMfU1uRvow-lJlScjA6y41yik53hCxszkeFDccboOvaT0-41EEtJNMTzOFUGPd94yid5t7Dr2LIm07WIxiwEZIz41dlJ-56PNP02D2c0FnaLkeLnJQmjKFF5Pl8avL0YbBDDZmfPsH8lIHscS7qqYNOpOnH9Zk3iRZrhAG7Syefs_ME_lcYLCbl5Ddpqy6Ge48mLFvuF" 
                    referrerPolicy="no-referrer"
                  />
                  <span>Continue with Google</span>
                </button>
                <p className="mt-10 text-center text-sm text-slate-500">
                  Don't have an account? 
                  <button onClick={() => setScreen('register')} className="text-primary font-semibold hover:underline ml-1">Request access</button>
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="register"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-4xl grid md:grid-cols-12 gap-12 items-start"
            >
              {/* Left Side: Narrative/Identity */}
              <div className="md:col-span-5 flex flex-col gap-6 pt-12">
                <div className="space-y-2">
                  <h1 className="text-4xl md:text-5xl font-extrabold font-headline tracking-tighter text-primary leading-tight">Create Account</h1>
                  <p className="text-secondary text-lg leading-relaxed">Join the architectural atrium of productivity.</p>
                </div>
                <div className="hidden md:flex flex-col gap-4 mt-8">
                  <div className="flex items-center gap-4 group">
                    <div className="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center text-primary group-hover:bg-primary-container group-hover:text-white transition-colors">
                      <span className="material-symbols-outlined">architecture</span>
                    </div>
                    <span className="font-medium text-sm text-on-surface-variant">Structured Workspace Management</span>
                  </div>
                  <div className="flex items-center gap-4 group">
                    <div className="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center text-primary group-hover:bg-primary-container group-hover:text-white transition-colors">
                      <span className="material-symbols-outlined">group</span>
                    </div>
                    <span className="font-medium text-sm text-on-surface-variant">Seamless Team Integration</span>
                  </div>
                  <div className="flex items-center gap-4 group">
                    <div className="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center text-primary group-hover:bg-primary-container group-hover:text-white transition-colors">
                      <span className="material-symbols-outlined">shield_with_heart</span>
                    </div>
                    <span className="font-medium text-sm text-on-surface-variant">Enterprise-Grade Security</span>
                  </div>
                </div>
                <div className="mt-auto hidden md:block opacity-40">
                  <div className="w-32 h-1 bg-gradient-to-r from-primary to-transparent rounded-full"></div>
                </div>
              </div>

              {/* Right Side: Registration Form */}
              <div className="md:col-span-7 bg-surface-container-lowest rounded-xl p-8 md:p-10 shadow-[0_20px_40px_rgba(25,28,30,0.06)] border border-outline-variant/10">
                {/* Social Auth */}
                <button className="w-full flex items-center justify-center gap-3 bg-white border border-outline-variant/30 hover:bg-surface-container-low transition-all py-3.5 rounded-xl font-medium text-on-surface shadow-sm">
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"></path>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>
                  </svg>
                  Continue with Google
                </button>

                <div className="relative my-8">
                  <div aria-hidden="true" className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-outline-variant/20"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase tracking-widest text-slate-400">
                    <span className="bg-surface-container-lowest px-4 font-semibold">Or register manually</span>
                  </div>
                </div>

                {/* Profile Upload (Optional) */}
                <div className="mb-8 flex items-center gap-6">
                  <div className="relative group">
                    <div className="w-20 h-20 rounded-full bg-surface-container-high border-2 border-dashed border-outline-variant/50 flex flex-col items-center justify-center overflow-hidden transition-all group-hover:border-primary-container">
                      <span className="material-symbols-outlined text-slate-400 group-hover:text-primary transition-colors">add_a_photo</span>
                    </div>
                    <input className="absolute inset-0 opacity-0 cursor-pointer" title="Upload profile picture" type="file" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-on-surface">Profile Picture</h4>
                    <p className="text-xs text-secondary">Optional: JPEG or PNG, max 2MB</p>
                  </div>
                </div>

                {/* Registration Form */}
                <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Full Name</label>
                      <input className="w-full bg-surface-container-highest border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all outline-none" placeholder="John Doe" type="text" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Work Email</label>
                      <input className="w-full bg-surface-container-highest border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all outline-none" placeholder="john@pandav.com" type="email" />
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Phone Number</label>
                      <input className="w-full bg-surface-container-highest border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all outline-none" placeholder="+1 (555) 000-0000" type="tel" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Department</label>
                      <div className="relative">
                        <select className="w-full appearance-none bg-surface-container-highest border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all outline-none">
                          <option value="">Select department</option>
                          <option value="arch">Architecture & Design</option>
                          <option value="eng">Engineering</option>
                          <option value="pm">Project Management</option>
                          <option value="ops">Operations</option>
                        </select>
                        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">expand_more</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Password</label>
                      <input className="w-full bg-surface-container-highest border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all outline-none" placeholder="••••••••" type="password" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Confirm Password</label>
                      <input className="w-full bg-surface-container-highest border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all outline-none" placeholder="••••••••" type="password" />
                    </div>
                  </div>
                  <div className="flex items-start gap-3 pt-2">
                    <input className="mt-1 rounded border-outline-variant text-primary focus:ring-primary/20" id="terms" type="checkbox" />
                    <label className="text-xs text-secondary leading-relaxed" htmlFor="terms">
                      I agree to the <a className="text-primary font-semibold hover:underline" href="#">Terms of Service</a> and <a className="text-primary font-semibold hover:underline" href="#">Privacy Policy</a>. I understand that my data will be handled according to Pandav's security standards.
                    </label>
                  </div>
                  <button className="w-full atrium-gradient text-on-primary py-4 rounded-xl font-bold text-sm tracking-wide shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 group" type="submit">
                    Register Account
                    <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">arrow_forward</span>
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

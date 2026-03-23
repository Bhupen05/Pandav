/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";
import { 
  CheckCircle2, 
  Timer, 
  Users, 
  MessageSquare, 
  ShieldCheck, 
  Headphones, 
  ArrowRight,
  ClipboardCheck,
  LayoutDashboard
} from "lucide-react";
import Footer from "../components/Footer";

const Hero = () => (
  <section className="relative min-h-[90vh] flex items-center overflow-hidden px-6 pt-20">
    <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
      <motion.div 
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10"
      >
        <span className="inline-block py-1 px-3 rounded-full bg-blue-100 text-primary text-xs font-bold tracking-widest uppercase mb-6">
          Unified Operations
        </span>
        <h1 className="text-6xl md:text-7xl font-extrabold font-headline leading-[1.1] text-primary tracking-tight mb-8">
          The Digital <span className="text-blue-500">Atrium</span> for Modern Teams
        </h1>
        <p className="text-lg text-secondary leading-relaxed max-w-xl mb-10">
          Break the spreadsheet trap. Manage tasks, attendance, and team communication in a high-end architectural workspace designed for structural clarity.
        </p>
        <div className="flex flex-wrap gap-4">
          <button className="bg-primary-gradient text-white px-8 py-4 rounded-xl font-bold text-lg shadow-xl shadow-primary/20 active:scale-95 transition-all">
            Get Started for Free
          </button>
          <button className="bg-surface-container-highest text-slate-900 px-8 py-4 rounded-xl font-bold text-lg hover:bg-slate-200 transition-colors active:scale-95">
            Request a Demo
          </button>
        </div>
      </motion.div>
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="relative lg:h-[600px]"
      >
        <div className="absolute inset-0 bg-primary/5 rounded-[3rem] -rotate-3 blur-3xl"></div>
        <div className="relative bg-white rounded-[2rem] shadow-2xl overflow-hidden aspect-square lg:aspect-auto lg:h-full border border-slate-200">
          <img 
            className="w-full h-full object-cover opacity-90" 
            src="https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1200" 
            alt="Modern architectural office"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-primary/40 to-transparent"></div>
          
          {/* Floating Glass Metric */}
          <div className="absolute bottom-8 left-8 right-8 bg-white/60 backdrop-blur-xl p-6 rounded-2xl border border-white/20 shadow-2xl">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-primary mb-1">Live Productivity</p>
                <p className="text-3xl font-black font-headline text-slate-900">98.4%</p>
              </div>
              <div className="h-12 w-px bg-primary/20 rounded-full"></div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-primary mb-1">Check-ins</p>
                <p className="text-3xl font-black font-headline text-slate-900">1,240</p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  </section>
);

const Features = () => (
  <section className="py-24 px-6 bg-surface-container-low">
    <div className="max-w-7xl mx-auto">
      <div className="mb-16">
        <h2 className="text-4xl font-extrabold font-headline text-primary mb-4">Core Operating Pillars</h2>
        <p className="text-secondary max-w-2xl">Everything you need to orchestrate a high-performing team without the visual noise of legacy enterprise software.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Task Lifecycle */}
        <motion.div 
          whileHover={{ y: -5 }}
          className="md:col-span-2 bg-white p-8 rounded-[2rem] flex flex-col justify-between group hover:shadow-xl transition-all border border-slate-200"
        >
          <div className="max-w-md">
            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
              <ClipboardCheck className="text-primary w-8 h-8" />
            </div>
            <h3 className="text-2xl font-bold font-headline mb-4">Task Lifecycle Management</h3>
            <p className="text-secondary leading-relaxed">Create, assign, and track tasks with multi-stage approval workflows. Ensure nothing falls through the cracks with automated follow-ups.</p>
          </div>
          <div className="mt-12 flex gap-4 overflow-hidden">
            <div className="bg-slate-100 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">Drafting</div>
            <div className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap">In Review</div>
            <div className="bg-slate-100 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">Approved</div>
          </div>
        </motion.div>

        {/* Attendance */}
        <motion.div 
          whileHover={{ y: -5 }}
          className="bg-primary-gradient p-8 rounded-[2rem] text-white border border-primary/20 flex flex-col"
        >
          <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-6">
            <Timer className="text-white w-8 h-8" />
          </div>
          <h3 className="text-2xl font-bold font-headline mb-4">Attendance & Check-ins</h3>
          <p className="opacity-80 leading-relaxed mb-8">One-tap employee check-in/out with location intelligence and comprehensive shift records.</p>
          <div className="mt-auto bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-orange-200 flex items-center justify-center text-orange-900 font-bold">JD</div>
              <div>
                <p className="text-sm font-bold">John Doe</p>
                <p className="text-xs opacity-60">Checked in at 08:45 AM</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Team Operations */}
        <motion.div 
          whileHover={{ y: -5 }}
          className="bg-white p-8 rounded-[2rem] border border-slate-200"
        >
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
            <Users className="text-primary w-8 h-8" />
          </div>
          <h3 className="text-2xl font-bold font-headline mb-4">Team Operations</h3>
          <p className="text-secondary leading-relaxed">Role-based permissions and team-scoped tasks. Scale from 5 to 500 without losing structural integrity.</p>
        </motion.div>

        {/* Internal Messaging */}
        <motion.div 
          whileHover={{ y: -5 }}
          className="md:col-span-2 bg-white p-8 rounded-[2rem] flex flex-col md:flex-row gap-8 items-center border border-slate-200"
        >
          <div className="flex-1">
            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
              <MessageSquare className="text-primary w-8 h-8" />
            </div>
            <h3 className="text-2xl font-bold font-headline mb-4">Internal Messaging</h3>
            <p className="text-secondary leading-relaxed">Real-time chat for seamless team communication. Keep project context where the work actually happens.</p>
          </div>
          <div className="flex-1 w-full space-y-3">
            <div className="bg-slate-100 p-4 rounded-2xl rounded-bl-sm text-sm text-slate-700">
              Update on the new atrium design?
            </div>
            <div className="bg-primary text-white p-4 rounded-2xl rounded-br-sm text-sm ml-8">
              Almost done, sending the files now.
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  </section>
);

const Personas = () => (
  <section className="py-24 px-6">
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-16">
        <h2 className="text-4xl font-extrabold font-headline text-primary mb-4">Who is Pandav for?</h2>
        <p className="text-secondary">Tailored experiences for every level of your organization.</p>
      </div>
      
      <div className="grid md:grid-cols-3 gap-8">
        {[
          {
            title: "Standard Users",
            features: ["Effortless task tracking", "Mobile-first check-ins", "Direct team messaging"],
            icon: CheckCircle2,
            dark: false
          },
          {
            title: "Team Leaders",
            features: ["Multi-level task approvals", "Performance analytics", "Roster & shift planning"],
            icon: LayoutDashboard,
            dark: true
          },
          {
            title: "Admins",
            features: ["Granular role management", "Organization-wide logs", "API & Third-party integrations"],
            icon: ShieldCheck,
            dark: false
          }
        ].map((persona, i) => (
          <motion.div 
            key={i}
            whileHover={{ scale: 1.02 }}
            className={`p-8 rounded-3xl relative overflow-hidden ${persona.dark ? 'bg-primary text-white shadow-2xl shadow-primary/20' : 'bg-slate-100 text-slate-900'}`}
          >
            <div className={`absolute -right-4 -top-4 w-32 h-32 rounded-full ${persona.dark ? 'bg-white/5' : 'bg-primary/5'}`}></div>
            <h4 className="text-xl font-bold font-headline mb-6">{persona.title}</h4>
            <ul className="space-y-4">
              {persona.features.map((feature, j) => (
                <li key={j} className="flex items-start gap-3 text-sm opacity-90">
                  <persona.icon className={`w-5 h-5 ${persona.dark ? 'text-blue-300' : 'text-primary'}`} />
                  {feature}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

const CTA = () => (
  <section className="py-24 px-6 bg-primary">
    <div className="max-w-4xl mx-auto bg-white rounded-[2.5rem] p-12 md:p-16 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-100/50 blur-[100px]"></div>
      <div className="relative z-10 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <h2 className="text-4xl font-extrabold font-headline text-primary mb-6">Ready to enter the Atrium?</h2>
          <p className="text-secondary mb-8">Join over 500+ teams optimizing their operations with Pandav. Request a personalized walkthrough today.</p>
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-primary">
              <Headphones className="w-5 h-5" />
              <span className="text-sm font-bold">24/7 Premium Support</span>
            </div>
            <div className="flex items-center gap-4 text-primary">
              <ShieldCheck className="w-5 h-5" />
              <span className="text-sm font-bold">Enterprise-grade Security</span>
            </div>
          </div>
        </div>
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 px-1">Full Name</label>
            <input 
              className="w-full bg-slate-100 border-none rounded-xl focus:ring-2 focus:ring-primary/20 py-3 px-4 outline-none" 
              placeholder="Alex Carter" 
              type="text"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-widest text-slate-500 px-1">Work Email</label>
            <input 
              className="w-full bg-slate-100 border-none rounded-xl focus:ring-2 focus:ring-primary/20 py-3 px-4 outline-none" 
              placeholder="alex@company.com" 
              type="email"
            />
          </div>
          <button className="w-full bg-primary-gradient text-white py-4 rounded-xl font-bold shadow-lg shadow-primary/20 hover:opacity-90 transition-opacity mt-4 flex items-center justify-center gap-2">
            Request a Demo <ArrowRight className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  </section>
);

export default function App() {
  return (
    <div className="min-h-screen selection:bg-blue-100 selection:text-primary">
      <main>
        <Hero />
        <Features />
        <Personas />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

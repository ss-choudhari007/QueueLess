import { ArrowRight, BellRing, Building2, CalendarClock, QrCode, ShieldCheck, Smartphone, Timer, Users } from 'lucide-react';
import { ButtonLink, Card } from '../../components/ui/index.jsx';
import { useAuth, homePathFor } from '../../context/AuthContext.jsx';
import { useDocumentTitle } from '../../hooks/index.js';

const STEPS = [
  { icon: Smartphone, title: 'Join from anywhere', text: 'Pick an organization and a service, and receive a token number instantly.' },
  { icon: BellRing, title: 'Follow your turn live', text: 'See how many people are ahead of you and an estimated wait that updates in real time.' },
  { icon: QrCode, title: 'Check in at the counter', text: 'When you’re called, staff scan your QR code and you confirm your arrival in the app.' },
];

const FEATURES = [
  { icon: Users, title: 'Live staff console', text: 'Call the next customer, verify arrivals, and start or complete service with one click.' },
  { icon: Timer, title: 'Fair no-show handling', text: 'A five-minute grace period after each call, with audited corrections for staff.' },
  { icon: CalendarClock, title: 'Hours & capacity', text: 'Set weekly opening hours, daily token limits and per-service durations.' },
  { icon: ShieldCheck, title: 'Private by design', text: 'Each organization only sees its own queues. Customers only see their own tokens.' },
];

export default function Landing() {
  useDocumentTitle();
  const { user } = useAuth();
  return (
    <div>
      <section className="relative overflow-hidden bg-navy-900 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,124,246,0.35),transparent_55%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-brand-200 ring-1 ring-white/15">
              Clinics · Salons · College offices · Service centers
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Stop standing in line.
              <span className="block text-brand-200">Arrive when it’s your turn.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-300">
              QueueLess lets customers join queues digitally and follow their position live, while staff and owners run every
              counter from one clear dashboard.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/orgs" size="lg" icon={ArrowRight}>
                Find a queue
              </ButtonLink>
              {user ? (
                <ButtonLink to={homePathFor(user)} size="lg" variant="secondary">
                  Go to dashboard
                </ButtonLink>
              ) : (
                <ButtonLink to="/register?type=owner" size="lg" variant="secondary" icon={Building2}>
                  Register your organization
                </ButtonLink>
              )}
            </div>
          </div>
          <div className="mx-auto w-full max-w-sm" aria-hidden>
            <div className="rounded-2xl bg-white p-6 text-navy-900 shadow-2xl ring-1 ring-black/5">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Your token · General Consultation</p>
              <p className="mt-2 text-5xl font-extrabold tracking-tight">GC-014</p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">People ahead</p>
                  <p className="text-2xl font-bold">3</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Estimated wait</p>
                  <p className="text-2xl font-bold">~25 min</p>
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">Now serving GC-011 — we’ll notify you when you’re called.</div>
              <p className="mt-3 text-center text-[11px] text-slate-400">Illustration</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-navy-900">How it works</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title} className="p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <s.icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-sm font-semibold text-slate-400">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 font-semibold text-navy-900">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{s.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold text-navy-900">Built for the people behind the counter</h2>
            <p className="mt-2 text-slate-600">Owners configure services and hours; staff manage the line in real time; every important change is recorded.</p>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <f.icon className="h-6 w-6 text-brand-600" aria-hidden />
                <h3 className="mt-3 font-semibold text-navy-900">{f.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-navy-900 p-8 text-white sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-bold">Ready to skip the line?</h2>
            <p className="mt-1 text-slate-300">Create a free customer account and join your first queue in under a minute.</p>
          </div>
          <ButtonLink to={user ? '/orgs' : '/register'} size="lg">
            {user ? 'Browse organizations' : 'Create an account'}
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

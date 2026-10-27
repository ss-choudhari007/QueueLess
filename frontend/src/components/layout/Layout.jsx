import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Building2, ClipboardList, History, LayoutDashboard, LogOut, Menu, MonitorPlay, Search, Ticket, UserRound, X } from 'lucide-react';
import { homePathFor, safeNext, useAuth } from '../../context/AuthContext.jsx';
import { ROLE_LABEL } from '../../lib/format.js';
import { ButtonLink, PageLoader, cx } from '../ui/index.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';

export function Logo({ light = false }) {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="QueueLess home">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-900 ring-1 ring-white/10">
        <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
          <path d="M8 11h16M8 16h11M8 21h6" stroke="#60a5fa" strokeWidth="3" strokeLinecap="round" fill="none" />
        </svg>
      </span>
      <span className={cx('text-lg font-bold tracking-tight', light ? 'text-white' : 'text-navy-900')}>QueueLess</span>
    </Link>
  );
}

const NAV = {
  guest: [{ to: '/orgs', label: 'Find a queue', icon: Search }],
  CUSTOMER: [
    { to: '/app', label: 'My tokens', icon: Ticket, end: true },
    { to: '/orgs', label: 'Find a queue', icon: Search },
    { to: '/app/history', label: 'History', icon: History },
  ],
  STAFF: [{ to: '/staff', label: 'Queue console', icon: MonitorPlay }],
  OWNER: [
    { to: '/owner', label: 'Organizations', icon: Building2 },
    { to: '/staff', label: 'Queue console', icon: MonitorPlay },
  ],
};

function NavItems({ items, onNavigate, vertical }) {
  return items.map((item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          vertical ? 'w-full' : '',
          isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
        )
      }
    >
      <item.icon className="h-4 w-4" aria-hidden />
      {item.label}
    </NavLink>
  ));
}

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const items = NAV[user?.role] || NAV.guest;

  const signOut = async () => {
    setOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 bg-navy-900 text-white shadow-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo light />
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              <NavItems items={items} />
            </nav>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {user ? (
              <>
                <NavLink
                  to="/account"
                  className={({ isActive }) =>
                    cx('flex items-center gap-2 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-white/10' : 'hover:bg-white/5')
                  }
                >
                  <UserRound className="h-4 w-4" aria-hidden />
                  <span className="max-w-[10rem] truncate">{user.name}</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">{ROLE_LABEL[user.role]}</span>
                </NavLink>
                <button onClick={signOut} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
                  <LogOut className="h-4 w-4" aria-hidden /> Sign out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 hover:text-white">
                  Sign in
                </Link>
                <Link to="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">
                  Get started
                </Link>
              </>
            )}
          </div>
          <button className="rounded-lg p-2 hover:bg-white/10 md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Toggle menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {open && (
          <div className="border-t border-white/10 px-4 pt-2 pb-4 md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              <NavItems items={items} vertical onNavigate={() => setOpen(false)} />
              {user ? (
                <>
                  <NavItems items={[{ to: '/account', label: 'Account', icon: UserRound }]} vertical onNavigate={() => setOpen(false)} />
                  <button onClick={signOut} className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5">
                    <LogOut className="h-4 w-4" aria-hidden /> Sign out
                  </button>
                </>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Link to="/login" onClick={() => setOpen(false)} className="rounded-lg border border-white/20 px-3 py-2 text-center text-sm">
                    Sign in
                  </Link>
                  <Link to="/register" onClick={() => setOpen(false)} className="rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-semibold">
                    Get started
                  </Link>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>
      <main className="flex-1">
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} QueueLess. Digital queues for real-world services.</p>
          <p>Waiting times are estimates, not guarantees.</p>
        </div>
      </footer>
    </div>
  );
}

export function Container({ children, className, size = 'xl' }) {
  const widths = { md: 'max-w-3xl', lg: 'max-w-5xl', xl: 'max-w-7xl' };
  return <div className={cx('mx-auto w-full px-4 py-8 sm:px-6', widths[size], className)}>{children}</div>;
}

// Frontend route guard. This is a convenience only — the API enforces
// every permission on the server.
export function RequireAuth({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Checking your session" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user)} replace />;
  return children;
}

export function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (user) {
    const next = safeNext(new URLSearchParams(location.search).get('next'));
    const target = user.role === 'OWNER' && location.pathname === '/register' ? '/owner/new' : next || homePathFor(user);
    return <Navigate to={target} replace />;
  }
  return children;
}

export function NotFoundPage() {
  return (
    <Container size="md">
      <div className="card flex flex-col items-center px-6 py-16 text-center">
        <ClipboardList className="h-10 w-10 text-slate-400" aria-hidden />
        <h1 className="mt-4 text-xl font-bold text-navy-900">Page not found</h1>
        <p className="mt-1 text-sm text-slate-500">The page you’re looking for doesn’t exist or has moved.</p>
        <div className="mt-6 flex gap-2">
          <ButtonLink to="/" variant="secondary" icon={LayoutDashboard}>
            Home
          </ButtonLink>
          <ButtonLink to="/orgs" icon={Search}>
            Find a queue
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}

import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpCircle,
  Banknote,
  Bell,
  BookOpen,
  ClipboardList,
  CreditCard,
  FileClock,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  LineChart,
  LogOut,
  Megaphone,
  Menu,
  Package,
  Receipt,
  Settings,
  ShieldAlert,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Spinner, cx } from './ui';

export function Logo({ light }: { light?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2">
      <img src="/logo-mark.png" alt="" className="h-9 w-9 rounded-full ring-1 ring-brand-400/40" />
      <span className={cx('text-lg font-extrabold tracking-tight', light ? 'text-neutral-100' : 'text-ink')}>
        SKILLS<span className={light ? 'text-brand-400' : 'text-brand-500'}>EARN</span>
      </span>
    </Link>
  );
}

export function PublicLayout() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const links = [
    ['/#courses', 'Courses'],
    ['/#packages', 'Pricing'],
    ['/#how-it-works', 'How it works'],
    ['/#faq', 'FAQ'],
  ];
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Logo light />
          <nav className="hidden items-center gap-6 text-sm font-medium text-neutral-300 md:flex">
            {links.map(([href, label]) => (
              <a key={href} href={href} className="hover:text-brand-300">
                {label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {me ? (
              <Link to={me.role === 'admin' ? '/admin' : '/app'} className="btn-gold rounded-lg px-4 py-2 text-sm font-semibold">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-white/10">
                  Log in
                </Link>
                <Link to="/register" className="btn-gold rounded-lg px-4 py-2 text-sm font-semibold">
                  Get started
                </Link>
              </>
            )}
          </div>
          <button className="rounded-lg p-2 text-neutral-200 md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X /> : <Menu />}
          </button>
        </div>
        {open && (
          <div className="space-y-1 border-t border-white/10 px-4 py-3 md:hidden">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-neutral-200 hover:bg-white/10">
                {label}
              </a>
            ))}
            <Link to={me ? '/app' : '/login'} className="block rounded-lg px-3 py-2 text-sm font-medium text-brand-300">
              {me ? 'Dashboard' : 'Log in'}
            </Link>
            {!me && (
              <Link to="/register" className="btn-gold block rounded-lg px-3 py-2 text-center text-sm font-semibold">
                Get started
              </Link>
            )}
          </div>
        )}
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-brand-500/20 bg-ink text-neutral-400">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
          <div>
            <Logo light />
            <p className="mt-3">Practical online courses to learn job-ready skills at your own pace, on any device.</p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-white">Platform</p>
            <a href="/#courses" className="block hover:text-white">Courses</a>
            <a href="/#packages" className="block hover:text-white">Pricing</a>
            <a href="/#faq" className="block hover:text-white">FAQ</a>
            <Link to="/terms" className="block hover:text-white">Terms & Conditions</Link>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-white">Account</p>
            <Link to="/login" className="block hover:text-white">Log in</Link>
            <Link to="/register" className="block hover:text-white">Create account</Link>
            <Link to="/forgot-password" className="block hover:text-white">Forgot password</Link>
          </div>
        </div>
        <p className="border-t border-white/10 py-4 text-center text-xs">© {new Date().getFullYear()} SKILLSEARN. All rights reserved.</p>
      </footer>
    </div>
  );
}

type NavItem = [to: string, label: string, icon: ReactNode, end?: boolean];

const CREDIT_URL = 'https://sabkasaathidigitalservices.com/';

function Credit() {
  return (
    <p className="no-print mt-10 text-center text-xs text-slate-400">
      A little digital magic by{' '}
      <a href={CREDIT_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
        Sabka Saathi Digital Services
      </a>{' '}
      ✨
    </p>
  );
}

function Shell({ nav, title, badge, tabs, footer }: { nav: NavItem[]; title: string; badge?: ReactNode; tabs?: NavItem[]; footer?: ReactNode }) {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  // Stop the page behind the mobile drawer from scrolling.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="px-5 py-4">
        <Logo light />
        <p className="mt-1.5 text-xs font-medium uppercase tracking-wider text-brand-400/80">{title}</p>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map(([to, label, icon, end]) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition', isActive ? 'bg-brand-400/15 text-brand-300 ring-1 ring-inset ring-brand-400/25' : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-100')
            }
          >
            {icon}
            {label}
          </NavLink>
        ))}
      </div>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 px-3 text-xs text-neutral-500">
          <p className="truncate font-semibold text-neutral-200">{me?.fullName}</p>
          <p>{me?.userCode}</p>
        </div>
        <button
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-400 hover:bg-rose-500/10 hover:text-rose-300"
        >
          <LogOut className="h-4 w-4" /> Logout
        </button>
      </div>
    </nav>
  );
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/10 bg-ink lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button className="absolute right-3 top-4 rounded-lg p-1.5 text-neutral-400 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:px-8">
        <div className="flex items-center gap-2 lg:hidden">
          <button className="-ml-1.5 rounded-lg p-1.5" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
        </div>
        <div className="hidden text-sm text-slate-500 lg:block">
          Welcome, <span className="font-semibold text-slate-800">{me?.fullName?.split(' ')[0]}</span>
        </div>
        <div className="flex items-center gap-2">{badge}</div>
      </header>
      <main className={cx('mx-auto max-w-7xl px-4 py-5 sm:py-6 lg:px-8', tabs && 'pb-24 lg:pb-6')}>
        <Outlet />
        {footer}
      </main>
      {tabs && (
        <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map(([to, label, icon, end]) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-slate-500')}
            >
              {icon}
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

function NotificationBell() {
  const { data } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api.get<{ unread: number }>('/me/notifications?pageSize=1'),
    refetchInterval: 60_000,
  });
  return (
    <Link to="/app/notifications" className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
      <Bell className="h-5 w-5" />
      {!!data?.unread && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
          {data.unread > 9 ? '9+' : data.unread}
        </span>
      )}
    </Link>
  );
}

const i = 'h-4 w-4';

export function AppLayout() {
  const nav: NavItem[] = [
    ['/app', 'Dashboard', <LayoutDashboard className={i} />, true],
    ['/app/team', 'My Team', <Users className={i} />],
    ['/app/income', 'Income & Wallet', <Wallet className={i} />],
    ['/app/withdrawals', 'Withdrawals', <Banknote className={i} />],
    ['/app/courses', 'My Courses', <GraduationCap className={i} />],
    ['/app/purchases', 'Purchases', <Receipt className={i} />],
    ['/app/upgrade', 'Upgrade Package', <ArrowUpCircle className={i} />],
    ['/app/notifications', 'Notifications', <Bell className={i} />],
    ['/app/profile', 'Profile', <User className={i} />],
  ];
  const t = 'h-5 w-5';
  const tabs: NavItem[] = [
    ['/app', 'Home', <LayoutDashboard className={t} />, true],
    ['/app/team', 'Team', <Users className={t} />],
    ['/app/income', 'Wallet', <Wallet className={t} />],
    ['/app/withdrawals', 'Withdraw', <Banknote className={t} />],
    ['/app/courses', 'Courses', <GraduationCap className={t} />],
  ];
  return <Shell nav={nav} title="Member area" badge={<NotificationBell />} tabs={tabs} footer={<Credit />} />;
}

export function AdminLayout() {
  const nav: NavItem[] = [
    ['/admin', 'Dashboard', <Gauge className={i} />, true],
    ['/admin/reports', 'Reports & Exports', <LineChart className={i} />],
    ['/admin/users', 'Users', <Users className={i} />],
    ['/admin/payments', 'Payments', <CreditCard className={i} />],
    ['/admin/commissions', 'Commissions', <ClipboardList className={i} />],
    ['/admin/withdrawals', 'Withdrawals', <Banknote className={i} />],
    ['/admin/ledger', 'Wallet Ledger', <Wallet className={i} />],
    ['/admin/packages', 'Packages & Rules', <Package className={i} />],
    ['/admin/courses', 'Courses', <BookOpen className={i} />],
    ['/admin/settings', 'Settings', <Settings className={i} />],
    ['/admin/announcements', 'Announcements', <Megaphone className={i} />],
    ['/admin/fraud', 'Fraud Alerts', <ShieldAlert className={i} />],
    ['/admin/audit', 'Audit Logs', <FileClock className={i} />],
  ];
  return <Shell nav={nav} title="Admin panel" />;
}

export function RequireAuth({ role }: { role?: 'admin' }) {
  const { ready, me } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.status === 'suspended') return <Navigate to="/suspended" replace />;
  if (role === 'admin' && me.role !== 'admin') return <Navigate to="/app" replace />;
  return <Outlet />;
}

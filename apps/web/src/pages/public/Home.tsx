import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, BookOpen, CheckCircle2, Gem, Lock, Share2, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatINR, packageColor, pct } from '../../lib/format';
import type { Package } from '../../lib/types';
import { Spinner } from '../../components/ui';

export function PackageCards({ packages, cta = true }: { packages: Package[]; cta?: boolean }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {packages.map((p) => (
        <div key={p.id} className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm ${p.level === 2 ? 'border-brand-300 ring-2 ring-brand-200' : 'border-slate-200'}`}>
          {p.level === 2 && <span className="btn-gold absolute right-4 top-4 rounded-full px-2 py-0.5 text-xs font-bold">Popular</span>}
          <div className={`bg-gradient-to-br ${packageColor(p.level)} px-6 py-5 text-white`}>
            <div className="flex items-center gap-2">
              <Gem className="h-5 w-5" />
              <h3 className="text-lg font-bold">{p.name}</h3>
            </div>
            <p className="mt-2 text-3xl font-extrabold">{formatINR(p.price, true)}</p>
            <p className="text-sm opacity-90">one-time</p>
          </div>
          <div className="flex flex-1 flex-col p-6">
            {p.description && <p className="text-sm text-slate-600">{p.description}</p>}
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> {p.name} course access</li>
              <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> Direct referral commission: <b>{pct(p.directRateBps)}</b></li>
              {[1, 2, 3].map((g) =>
                g <= p.maxGenerations ? (
                  <li key={g} className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> Generation {g} commission: <b>{pct(p.generationRatesBps[g - 1])}</b></li>
                ) : (
                  <li key={g} className="flex gap-2 text-slate-400"><Lock className="h-4 w-4 shrink-0" /> Generation {g} — not included</li>
                ),
              )}
              <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> Turnover income from Generation 4 onwards</li>
            </ul>
            {cta && (
              <Link to={`/register?package=${p.slug}`} className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-brand-300 hover:bg-neutral-800">
                Choose {p.name} <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const packages = useQuery({ queryKey: ['packages'], queryFn: () => api.get<Package[]>('/packages') });
  const courses = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<{ id: string; title: string; description: string; minPackageLevel: number; lessons: { count: number }[] }[]>('/courses/catalog'),
  });
  const levelName = (lvl: number) => packages.data?.find((p) => p.level === lvl)?.name ?? `Level ${lvl}`;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-400/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-2">
          <div>
            <img src="/logo.png" alt="SKILLSEARN — Learn · Grow · Earn" className="mb-6 h-28 w-28 rounded-full shadow-[0_0_40px_rgba(226,177,58,0.35)] sm:h-32 sm:w-32" />
            <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium ring-1 ring-brand-400/30">
              <BadgeCheck className="h-4 w-4 text-brand-300" /> Learn · Grow · Earn
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Learn skills that pay.<br />
              <span className="bg-linear-to-r from-brand-200 via-brand-400 to-brand-500 bg-clip-text text-transparent">Share & earn</span> as you grow.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-neutral-300">
              Pick a Gold, Platinum or Diamond package, unlock practical courses, and earn referral income when people you invite join.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="btn-gold inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold shadow-lg">
                Get started <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#packages" className="rounded-lg px-6 py-3 font-semibold text-brand-200 ring-1 ring-brand-400/40 hover:bg-white/5">
                View packages
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              [BookOpen, 'Practical courses', 'Marketing, design, English, freelancing & more'],
              [Users, 'Referral network', 'Direct, generation & turnover income'],
              [Wallet, 'Transparent wallet', 'Every rupee recorded in your ledger'],
              [ShieldCheck, 'Secure payouts', 'Scheduled withdrawals to bank or UPI'],
            ].map(([Icon, title, text]) => {
              const I = Icon as typeof BookOpen;
              return (
                <div key={title as string} className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-brand-400/20 backdrop-blur">
                  <I className="h-6 w-6 text-brand-300" />
                  <p className="mt-3 font-semibold">{title as string}</p>
                  <p className="mt-1 text-sm text-neutral-400">{text as string}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Packages */}
      <section id="packages" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Choose your package</h2>
          <p className="mt-3 text-slate-600">Upgrade anytime by paying only the difference.</p>
        </div>
        {packages.isLoading ? <Spinner /> : <PackageCards packages={packages.data ?? []} />}
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 bg-white py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">How referral income works</h2>
            <p className="mt-3 text-slate-600">
              The person whose link was used earns the <b>direct commission</b>. Generation income starts from <b>their</b> upline.
            </p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-3">
            {[
              [Share2, 'Share your link', 'Every member gets a unique referral code and link.'],
              [Users, 'Friends join', 'They buy a package and the payment is verified.'],
              [Wallet, 'Wallet credited', 'Commissions land in your wallet instantly.'],
            ].map(([Icon, t, d], i) => {
              const I = Icon as typeof Share2;
              return (
                <li key={t as string} className="relative flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <span className="btn-gold flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold text-slate-900"><I className="h-4 w-4 text-brand-600" /> {t as string}</p>
                    <p className="mt-1 text-sm text-slate-600">{d as string}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
            <div className="border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
              <p className="font-semibold text-slate-900">Example: Mohan buys Diamond for ₹6,000</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {[['Mohan', 'buys'], ['Rohit', 'Direct'], ['Amit', 'Gen 1'], ['Rahul', 'Gen 2'], ['Suresh', 'Gen 3'], ['Vikas', 'Gen 4'], ['Neha', 'Gen 5']].map(([who, tag], i) => (
                  <span key={who} className="flex items-center gap-2">
                    {i > 0 && <ArrowRight className="h-4 w-4 text-brand-500" />}
                    <span className={`rounded-full px-3 py-1 font-medium ${i === 0 ? 'bg-ink text-brand-300' : 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'}`}>
                      {who} <span className="text-xs font-normal opacity-75">· {tag}</span>
                    </span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">Mohan used Rohit's link. Rohit was referred by Amit, Amit by Rahul, Rahul by Suresh, Suresh by Vikas, and Vikas by Neha.</p>
            </div>
            <ul className="divide-y divide-slate-200">
              {[
                ['Rohit', 'Direct referrer', '₹6,000 × 40%', '₹2,400.00'],
                ['Amit', 'Generation 1', '₹2,400 × 15%', '₹360.00'],
                ['Rahul', 'Generation 2', '₹2,400 × 12% + ₹360 × 15%', '₹342.00'],
                ['Suresh', 'Generation 3', '₹2,400 × 8% + ₹360 × 12% + ₹342 × 15%', '₹286.50'],
                ['Vikas', 'Generation 4 · turnover', '₹360 × 8% + ₹342 × 12% + ₹286.50 × 15%', '₹112.82'],
                ['Neha', 'Generation 5 · turnover', '₹342 × 8% + ₹286.50 × 12% + ₹112.82 × 15%', '₹78.66'],
              ].map(([who, role, calc, amt]) => (
                <li key={who} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 sm:grid-cols-[10rem_1fr_auto] sm:px-6">
                  <p className="font-medium text-slate-900">{who} <span className="block text-xs font-normal text-slate-500">{role}</span></p>
                  <p className="order-last col-span-2 text-xs text-slate-500 sm:order-none sm:col-span-1 sm:text-sm">{calc}</p>
                  <p className="text-right font-semibold tabular-nums text-emerald-700">{amt}</p>
                </li>
              ))}
            </ul>
            <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 sm:px-6">
              Generation income (Gen 1–3) depends on each person's own package: Gold → Generation 1, Platinum → Generations 1–2, Diamond → Generations 1–3.
              Turnover income (Gen 4 onwards) goes to every upline with an active package and continues up the network.
            </p>
          </div>
        </div>
      </section>

      {/* Courses */}
      <section id="courses" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Courses you unlock</h2>
          <p className="mt-3 text-slate-600">Higher packages include every course from lower packages.</p>
        </div>
        {courses.isLoading ? (
          <Spinner />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {courses.data?.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">{levelName(c.minPackageLevel)}+</span>
                <h3 className="mt-1 font-semibold">{c.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{c.description}</p>
                <p className="mt-3 text-xs text-slate-500">{c.lessons?.[0]?.count ?? 0} lessons</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 bg-white py-20">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">Frequently asked questions</h2>
          {[
            ['When is my package activated?', 'Immediately after your payment is verified by our payment gateway.'],
            ['Can I earn from my own purchase?', 'No. Commissions are never paid on your own purchases, and self-referrals are blocked.'],
            ['How do withdrawals work?', 'Request a withdrawal during the published weekly or monthly window. A 5% platform charge is deducted from the gross amount, and you see the exact net amount before confirming.'],
            ['Can I upgrade later?', 'Yes. Pay only the price difference within the upgrade period shown in your dashboard.'],
            ['Is there a minimum withdrawal?', 'Yes, the minimum amount is shown on your withdrawals page.'],
          ].map(([q, a]) => (
            <details key={q} className="group border-b border-slate-200 py-4">
              <summary className="cursor-pointer list-none font-medium text-slate-900 marker:hidden">
                <span className="flex items-center justify-between">
                  {q}
                  <span className="text-slate-400 transition group-open:rotate-45">+</span>
                </span>
              </summary>
              <p className="mt-2 text-sm text-slate-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="border-t border-brand-500/20 bg-ink">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-12 text-white md:flex-row">
          <p className="text-2xl font-bold">Ready to start learning and earning?</p>
          <Link to="/register" className="btn-gold rounded-lg px-6 py-3 font-semibold">
            Create your account
          </Link>
        </div>
      </section>
    </>
  );
}

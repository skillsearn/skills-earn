import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, BookOpen, Briefcase, CheckCircle2, Clapperboard, Code2, CreditCard, Gem, GraduationCap, Languages, Lock,
  Megaphone, PlayCircle, ShieldCheck, Smartphone, Sparkles, TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatINR, packageColor, pct } from '../../lib/format';
import type { Package } from '../../lib/types';
import { Spinner } from '../../components/ui';

export function PackageCards({ packages, cta = true, showIncome = true }: { packages: Package[]; cta?: boolean; showIncome?: boolean }) {
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
              {!showIncome && <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> Includes all lower-package courses</li>}
              {!showIncome && <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> Upgrade anytime by paying the difference</li>}
              {showIncome && <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> Direct referral commission: <b>{pct(p.directRateBps)}</b></li>}
              {showIncome && [1, 2, 3].map((g) =>
                g <= p.maxGenerations ? (
                  <li key={g} className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> Generation {g} commission: <b>{pct(p.generationRatesBps[g - 1])}</b></li>
                ) : (
                  <li key={g} className="flex gap-2 text-slate-400"><Lock className="h-4 w-4 shrink-0" /> Generation {g} — not included</li>
                ),
              )}
              {showIncome && <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> Turnover income from Generation 4 onwards</li>}
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

interface CatalogCourse {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  category: string | null;
  duration: string | null;
  minPackageLevel: number;
  lessons: { count: number }[];
}

/** Icon + colour for a course, picked from its title so new courses still look right. */
function courseLook(title: string, i: number) {
  const t = title.toLowerCase();
  const icon = /market|ads|seo|social/.test(t) ? Megaphone
    : /english|speak|communicat|language/.test(t) ? Languages
    : /freelanc|brand|business|career/.test(t) ? Briefcase
    : /video|edit|film|\breel/.test(t) ? Clapperboard
    : /web|code|develop|program/.test(t) ? Code2
    : BookOpen;
  const tones = [
    'from-amber-400 to-orange-500', 'from-sky-400 to-indigo-500', 'from-rose-400 to-fuchsia-500',
    'from-emerald-400 to-teal-500', 'from-violet-400 to-purple-600', 'from-yellow-400 to-amber-600',
  ];
  return { Icon: icon, tone: tones[i % tones.length] };
}

const lessonCount = (c: CatalogCourse) => c.lessons?.[0]?.count ?? 0;

function CourseThumb({ c, i, className = '' }: { c: CatalogCourse; i: number; className?: string }) {
  const { Icon, tone } = courseLook(c.title, i);
  if (c.thumbnailUrl) return <img src={c.thumbnailUrl} alt="" className={`aspect-video w-full object-cover ${className}`} />;
  return (
    <div className={`relative flex aspect-video w-full items-center justify-center overflow-hidden bg-linear-to-br ${tone} ${className}`}>
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/20" />
      <div className="absolute -bottom-8 -left-4 h-20 w-20 rounded-full bg-black/10" />
      <Icon className="relative h-12 w-12 text-white drop-shadow" strokeWidth={1.75} />
    </div>
  );
}

function SectionTitle({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-12">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-slate-600">{sub}</p>}
    </div>
  );
}

export default function Home() {
  const packages = useQuery({ queryKey: ['packages'], queryFn: () => api.get<Package[]>('/packages') });
  const courses = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<CatalogCourse[]>('/courses/catalog') });
  const list = courses.data ?? [];
  const plans = (packages.data ?? []).slice().sort((a, b) => a.level - b.level);
  const planName = (lvl: number) => plans.find((p) => p.level === lvl)?.name ?? `Level ${lvl}`;
  const totalLessons = list.reduce((n, c) => n + lessonCount(c), 0);
  const fromPrice = plans.length ? Math.min(...plans.map((p) => Number(p.price))) : null;

  return (
    <>
      {/* ───────── Hero ───────── */}
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-brand-500/10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:pt-16 md:grid-cols-[1.1fr_1fr] md:pb-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-brand-200 ring-1 ring-brand-400/30">
              <Sparkles className="h-3.5 w-3.5" /> Practical online courses
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
              Learn skills that{' '}
              <span className="bg-linear-to-r from-brand-200 via-brand-400 to-brand-500 bg-clip-text text-transparent">grow your career</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-neutral-300 sm:text-lg">
              Short, practical video lessons in digital marketing, spoken English, video editing, freelancing and web development.
              Learn on your phone, at your own pace.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#courses" className="btn-gold inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-semibold shadow-lg shadow-brand-500/20">
                Explore courses <ArrowRight className="h-4 w-4" />
              </a>
              <a href="#packages" className="inline-flex items-center justify-center rounded-xl px-6 py-3.5 font-semibold text-brand-200 ring-1 ring-brand-400/40 hover:bg-white/5">
                View plans & pricing
              </a>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-white/10 pt-6">
              {[
                [list.length ? String(list.length) : '—', 'Courses'],
                [totalLessons ? String(totalLessons) : '—', 'Video lessons'],
                [fromPrice ? formatINR(fromPrice, true) : '—', 'Plans from'],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="text-xs text-neutral-400">{l}</dt>
                  <dd className="mt-1 text-xl font-bold text-white sm:text-2xl">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Course preview card */}
          <div className="relative mx-auto w-full max-w-md">
            <div className="absolute -inset-4 rounded-[2rem] bg-linear-to-br from-brand-400/25 to-transparent blur-2xl" />
            <div className="relative overflow-hidden rounded-3xl bg-white text-slate-900 shadow-2xl ring-1 ring-white/10">
              {list[0] ? (
                <>
                  <div className="relative">
                    <CourseThumb c={list[0]} i={0} />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-lg"><PlayCircle className="h-8 w-8 text-ink" /></span>
                    </span>
                  </div>
                  <div className="p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Now learning</p>
                    <p className="mt-1 font-bold">{list[0].title}</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-2/5 rounded-full bg-linear-to-r from-brand-300 to-brand-500" /></div>
                    <ul className="mt-4 space-y-2">
                      {list.slice(1, 4).map((c, i) => {
                        const { Icon, tone } = courseLook(c.title, i + 1);
                        return (
                          <li key={c.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br ${tone}`}><Icon className="h-4 w-4 text-white" /></span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                            <span className="text-xs text-slate-500">{lessonCount(c)} lessons</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </>
              ) : (
                <div className="flex aspect-[4/5] items-center justify-center"><Spinner /></div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Benefits strip ───────── */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-4 gap-y-6 px-4 py-8 md:grid-cols-4">
          {[
            [Smartphone, 'Learn on any device', 'Phone, tablet or laptop'],
            [PlayCircle, 'Video lessons', 'Watch anytime, rewatch anytime'],
            [TrendingUp, 'Track progress', 'See what you have completed'],
            [ShieldCheck, 'Secure payments', 'UPI, cards, net banking'],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof BookOpen;
            return (
              <div key={t as string} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-brand-100"><I className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{t as string}</p>
                  <p className="text-xs text-slate-500">{d as string}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ───────── Courses ───────── */}
      <section id="courses" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:py-20">
        <SectionTitle eyebrow="Courses" title="Pick a skill and start today" sub="Every course is built around practical, step-by-step lessons you can apply right away." />
        {courses.isLoading ? <Spinner /> : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c, i) => (
              <article key={c.id} className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                <div className="relative">
                  <CourseThumb c={c} i={i} />
                  <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-sm">
                    {planName(c.minPackageLevel)} plan & above
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  {c.category && <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{c.category}</p>}
                  <h3 className="text-lg font-bold text-slate-900">{c.title}</h3>
                  <p className="mt-2 line-clamp-3 flex-1 text-sm text-slate-600">{c.description}</p>
                  <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4 text-xs font-medium text-slate-500">
                    <span className="flex items-center gap-1.5"><PlayCircle className="h-4 w-4" /> {lessonCount(c)} lessons</span>
                    <span className="flex items-center gap-1.5"><GraduationCap className="h-4 w-4" /> {c.duration ?? 'Self-paced'}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ───────── Plans ───────── */}
      <section id="packages" className="scroll-mt-20 bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <SectionTitle eyebrow="Plans & pricing" title="One-time payment. No subscription." sub="Choose the courses you need. Upgrade later by paying only the difference." />
          {packages.isLoading ? <Spinner /> : (
            <div className="grid gap-6 md:grid-cols-3">
              {plans.map((p) => {
                const included = list.filter((c) => c.minPackageLevel <= p.level);
                const locked = list.filter((c) => c.minPackageLevel > p.level);
                const popular = p.level === 2;
                return (
                  <div key={p.id} className={`relative flex flex-col rounded-3xl p-6 sm:p-7 ${popular ? 'bg-ink text-white shadow-2xl ring-2 ring-brand-400 md:-my-3' : 'border border-slate-200 bg-white shadow-sm'}`}>
                    {popular && <span className="btn-gold absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-bold">Most popular</span>}
                    <div className="flex items-center gap-2">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br ${packageColor(p.level)}`}><Gem className="h-4 w-4 text-white" /></span>
                      <h3 className="text-lg font-bold">{p.name}</h3>
                    </div>
                    <p className="mt-5 flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold tracking-tight">{formatINR(p.price, true)}</span>
                      <span className={popular ? 'text-sm text-neutral-400' : 'text-sm text-slate-500'}>one-time</span>
                    </p>
                    <p className={`mt-1 text-sm ${popular ? 'text-neutral-300' : 'text-slate-600'}`}>
                      {included.length} course{included.length === 1 ? '' : 's'} · {included.reduce((n, c) => n + lessonCount(c), 0)} lessons
                    </p>
                    <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                      {included.map((c) => (
                        <li key={c.id} className="flex gap-2"><CheckCircle2 className={`h-5 w-5 shrink-0 ${popular ? 'text-brand-300' : 'text-emerald-500'}`} /> {c.title}</li>
                      ))}
                      {locked.map((c) => (
                        <li key={c.id} className={`flex gap-2 ${popular ? 'text-neutral-500' : 'text-slate-400'}`}><Lock className="h-5 w-5 shrink-0 p-0.5" /> {c.title}</li>
                      ))}
                      <li className="flex gap-2"><CheckCircle2 className={`h-5 w-5 shrink-0 ${popular ? 'text-brand-300' : 'text-emerald-500'}`} /> Learn at your own pace on any device</li>
                    </ul>
                    <Link to={`/register?package=${p.slug}`}
                      className={`mt-7 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${popular ? 'btn-gold' : 'bg-ink text-brand-300 hover:bg-neutral-800'}`}>
                      Enroll in {p.name} <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm text-slate-500">
            <CreditCard className="h-4 w-4" /> Pay online with UPI, cards or net banking, or by UPI / bank transfer.
          </p>
        </div>
      </section>

      {/* ───────── How it works ───────── */}
      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:py-20">
        <SectionTitle eyebrow="How it works" title="Start learning in 3 simple steps" />
        <ol className="grid gap-5 sm:grid-cols-3">
          {[
            [Gem, 'Choose a plan', 'Pick Gold, Platinum or Diamond based on the courses you want.'],
            [CreditCard, 'Pay securely', 'Pay online or by UPI / bank transfer. Your courses unlock once payment is verified.'],
            [PlayCircle, 'Start learning', 'Watch lessons, mark them complete and apply your new skills.'],
          ].map(([Icon, t, d], i) => {
            const I = Icon as typeof BookOpen;
            return (
              <li key={t as string} className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <span className="absolute right-5 top-4 text-5xl font-extrabold text-slate-100">{i + 1}</span>
                <span className="relative flex h-11 w-11 items-center justify-center rounded-xl btn-gold"><I className="h-5 w-5" /></span>
                <p className="relative mt-4 font-bold text-slate-900">{t as string}</p>
                <p className="relative mt-1 text-sm text-slate-600">{d as string}</p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ───────── FAQ ───────── */}
      <section id="faq" className="scroll-mt-20 bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4">
          <SectionTitle eyebrow="FAQ" title="Frequently asked questions" />
          <div className="space-y-3">
            {[
              ['When do my courses unlock?', 'Online payments unlock your courses instantly. UPI / bank transfer payments unlock as soon as our team verifies your payment screenshot.'],
              ['Which payment methods can I use?', 'UPI, debit/credit cards and net banking through our secure payment gateway, or a direct UPI / bank transfer.'],
              ['Can I learn on my phone?', 'Yes. The platform works in any mobile or desktop browser. No app download needed.'],
              ['Can I upgrade my plan later?', 'Yes. Upgrade anytime within the upgrade period shown in your dashboard by paying only the price difference.'],
              ['Do higher plans include the lower plan courses?', 'Yes. Every plan includes all courses from the plans below it.'],
            ].map(([q, a]) => (
              <details key={q} className="group rounded-2xl border border-slate-200 bg-slate-50/60 px-5 py-4 open:bg-white open:shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900 marker:hidden">
                  {q}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-lg text-slate-500 ring-1 ring-slate-200 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── CTA ───────── */}
      <section className="px-4 py-16">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-ink px-6 py-12 text-center text-white sm:px-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-400/25 blur-3xl" />
          <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">Your next skill is one lesson away.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-neutral-300">Create your account, choose a plan and start learning today.</p>
          <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/register" className="btn-gold inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-semibold">
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#courses" className="inline-flex items-center justify-center rounded-xl px-6 py-3.5 font-semibold text-brand-200 ring-1 ring-brand-400/40 hover:bg-white/5">
              Browse courses
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CalendarClock, Clock, IndianRupee, Layers, Share, Share2, TrendingUp, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, CopyButton, Empty, PageHeader, Spinner, Stat } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatINR, packageColor, pct, scheduleText, whatsappShare } from '../../lib/format';
import type { Notification, TeamSummary, WalletSummary, WithdrawalSchedule } from '../../lib/types';

interface DashboardData {
  profile: { userCode: string; fullName: string; referralCode: string; activePackage: { name: string; level: number; maxGenerations: number } | null };
  wallet: WalletSummary;
  team: TeamSummary;
  withdrawal: WithdrawalSchedule;
  notifications: Notification[];
  pendingPurchase: { id: string; type: string; amount: string; package: { name: string } } | null;
}

export function ReferralCard({ link, code }: { link: string; code: string }) {
  const text = `Join me on SKILLSEARN — learn practical skills and earn. Use my referral code ${code}: ${link}`;
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  return (
    <Card title={<span className="flex items-center gap-2"><Share2 className="h-4 w-4 text-brand-600" /> Invite & earn</span>}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          Share your personal link. Anyone who joins through it is added to your team.
          <span className="ml-1 whitespace-nowrap">Code: <span className="rounded bg-brand-50 px-2 py-0.5 font-mono font-semibold text-brand-700">{code}</span></span>
        </p>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={link} label="Copy link" />
          {canShare && (
            <Button variant="secondary" size="sm" onClick={() => navigator.share({ title: 'SKILLSEARN', text, url: link }).catch(() => undefined)}>
              <Share className="h-4 w-4" /> Share
            </Button>
          )}
          <a href={whatsappShare(text)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
            Share on WhatsApp
          </a>
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { me } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/me/dashboard') });

  if (isLoading) return <Spinner />;
  if (error || !data) return <Alert>{(error as Error)?.message ?? 'Failed to load'}</Alert>;
  const w = data.wallet;
  const pkg = data.profile.activePackage;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={<>User ID <b className="text-slate-700">{data.profile.userCode}</b></>} />

      {!pkg && data.pendingPurchase && (
        <div className="mb-6">
          <Alert tone="amber">
            Your {data.pendingPurchase.package.name} package is awaiting payment of {formatINR(data.pendingPurchase.amount)}.{' '}
            <Link to={`/app/checkout/${data.pendingPurchase.id}`} className="font-semibold underline">Complete payment →</Link>
          </Alert>
        </div>
      )}
      {!pkg && !data.pendingPurchase && (
        <div className="mb-6">
          <Alert tone="amber">You don't have an active package. <Link to="/app/upgrade" className="font-semibold underline">Choose a package →</Link></Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`rounded-xl bg-gradient-to-br ${packageColor(pkg?.level)} p-5 text-white shadow-sm`}>
          <p className="text-xs font-medium uppercase tracking-wide opacity-80">Active package</p>
          <p className="mt-1 text-2xl font-bold">{pkg?.name ?? 'None'}</p>
          <p className="mt-1 text-sm opacity-90">{pkg ? `Eligible for generations 1–${pkg.maxGenerations}` : 'Activate to start earning'}</p>
          {pkg && pkg.level < 3 && (
            <Link to="/app/upgrade" className="mt-4 inline-flex items-center gap-1 rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium hover:bg-white/30">
              Upgrade <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Available wallet balance</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{formatINR(w.availableBalance)}</p>
          <p className="mt-1 text-xs text-slate-500">On hold for withdrawals: {formatINR(w.onHold)}</p>
          <Link to="/app/withdrawals" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">Withdraw <ArrowUpRight className="h-4 w-4" /></Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500"><CalendarClock className="h-4 w-4" /> Withdrawal schedule</p>
          <p className="mt-2 font-semibold text-slate-900">{scheduleText(data.withdrawal)}</p>
          <p className="mt-1 text-sm text-slate-500">
            {data.withdrawal.windowOpenNow ? <span className="font-medium text-emerald-600">Window open now</span> : <>Next window: {data.withdrawal.nextWindowStart}</>}
          </p>
          <p className="mt-1 text-xs text-slate-500">Min {formatINR(data.withdrawal.minAmount, true)} · platform charge {pct(data.withdrawal.chargeBps)}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total income" value={formatINR(w.totalIncome)} icon={<IndianRupee className="h-4 w-4" />} tone="brand" />
        <Stat label="Today's income" value={formatINR(w.todayIncome)} icon={<TrendingUp className="h-4 w-4" />} tone="green" />
        <Stat label="This week" value={formatINR(w.weeklyIncome)} icon={<TrendingUp className="h-4 w-4" />} tone="green" />
        <Stat label="This month" value={formatINR(w.monthlyIncome)} icon={<TrendingUp className="h-4 w-4" />} tone="green" />
        <Stat label="Direct referral income" value={formatINR(w.directIncome)} icon={<Users className="h-4 w-4" />} tone="sky" />
        <Stat label="Generation 1 income" value={formatINR(w.gen1Income)} icon={<Layers className="h-4 w-4" />} tone="sky" />
        <Stat label="Generation 2 income" value={formatINR(w.gen2Income)} icon={<Layers className="h-4 w-4" />} tone="sky" />
        <Stat label="Generation 3 income" value={formatINR(w.gen3Income)} icon={<Layers className="h-4 w-4" />} tone="sky" />
        <Stat label="Pending commission" value={formatINR(w.pendingCommission)} icon={<Clock className="h-4 w-4" />} tone="amber" />
        <Stat label="Total withdrawn (net)" value={formatINR(w.totalWithdrawn)} icon={<Wallet className="h-4 w-4" />} />
        <Stat label="Direct referrals" value={data.team.directReferrals} icon={<Users className="h-4 w-4" />} />
        <Stat label="Total downline" value={data.team.totalDownline} sub={`${data.team.active} active · ${data.team.inactive} inactive`} icon={<Users className="h-4 w-4" />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {me && <ReferralCard link={me.referralLink} code={me.referralCode} />}
        <Card title="Recent notifications" actions={<Link to="/app/notifications" className="text-sm font-medium text-brand-600">View all</Link>}>
          {data.notifications.length ? (
            <ul className="divide-y divide-slate-100">
              {data.notifications.map((n) => (
                <li key={n.id} className="py-2.5">
                  <p className="text-sm font-medium text-slate-800">{n.title}</p>
                  {n.body && <p className="text-xs text-slate-500">{n.body}</p>}
                  <p className="text-[11px] text-slate-400">{formatDateTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No notifications yet" />
          )}
        </Card>
      </div>
    </>
  );
}

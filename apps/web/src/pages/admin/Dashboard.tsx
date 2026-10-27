import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, CreditCard, Download, GraduationCap, IndianRupee, Layers, Percent, Share2, UserCheck, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, CopyButton, Field, Input, PageHeader, Spinner, Stat, Table, Tabs } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatINR } from '../../lib/format';

interface AdminDashboard {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  newUsersToday: number;
  packageWiseUsers: { package: string; level: number; users: number }[];
  totalSalesCount: number;
  verifiedPaymentAmount: number;
  newPackageSales: number;
  upgradeSales: number;
  salesToday: number;
  pendingPayments: number;
  directCommissions: number;
  generationCommissions: number;
  turnoverCommissions: number;
  pendingCommissions: number;
  skippedCommissions: number;
  pendingWithdrawalsCount: number;
  pendingWithdrawalsAmount: number;
  successfulPayouts: number;
  platformCharges: number;
  walletLiability: number;
  courseEnrolments: number;
  openFraudAlerts: number;
}

/** The admin's own code is the root of the referral tree: members who have no sponsor join with it. */
function AdminReferralCard() {
  const { me } = useAuth();
  if (!me?.referralCode) return null;
  return (
    <Card title={<span className="flex items-center gap-2"><Share2 className="h-4 w-4 text-brand-600" /> Admin referral code</span>}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-slate-600">A referral code is required to register. Give this code or link to members who don't have a sponsor.</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-brand-50 px-2 py-0.5 font-mono text-base font-semibold text-brand-700">{me.referralCode}</span>
            <span className="truncate text-xs text-slate-500">{me.referralLink}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <CopyButton text={me.referralCode} label="Copy code" />
          <CopyButton text={me.referralLink} label="Copy link" />
        </div>
      </div>
    </Card>
  );
}

export function AdminDashboard() {
  const { data: d, isLoading, error } = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => api.get<AdminDashboard>('/admin/dashboard'), refetchInterval: 60_000 });
  if (isLoading) return <Spinner />;
  if (error || !d) return <Alert>{(error as Error)?.message}</Alert>;
  const ic = 'h-4 w-4';
  return (
    <>
      <PageHeader title="Admin dashboard" subtitle="Live platform overview" />
      <div className="mb-6"><AdminReferralCard /></div>
      {d.openFraudAlerts > 0 && (
        <div className="mb-6">
          <Alert tone="amber">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {d.openFraudAlerts} open fraud / duplicate alert(s). <Link to="/admin/fraud" className="font-semibold underline">Review</Link></span>
          </Alert>
        </div>
      )}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Users</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total users" value={d.totalUsers} sub={`+${d.newUsersToday} today`} icon={<Users className={ic} />} tone="brand" />
        <Stat label="Active users" value={d.activeUsers} sub="with active package" icon={<UserCheck className={ic} />} tone="green" />
        <Stat label="Suspended" value={d.suspendedUsers} icon={<Users className={ic} />} tone="rose" />
        <Stat label="Course enrolments" value={d.courseEnrolments} icon={<GraduationCap className={ic} />} tone="sky" />
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Sales & payments</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total package sales" value={d.totalSalesCount} sub={`${formatINR(d.salesToday)} today`} icon={<CreditCard className={ic} />} tone="brand" />
        <Stat label="Verified payment amount" value={formatINR(d.verifiedPaymentAmount)} sub={`New ${formatINR(d.newPackageSales)} · Upgrades ${formatINR(d.upgradeSales)}`} icon={<IndianRupee className={ic} />} tone="green" />
        <Stat label="Pending payments" value={d.pendingPayments} icon={<CreditCard className={ic} />} tone="amber" />
        <Stat label="Wallet liability" value={formatINR(d.walletLiability)} sub="sum of all balances" icon={<Wallet className={ic} />} />
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Commissions & payouts</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Direct commissions" value={formatINR(d.directCommissions)} icon={<Layers className={ic} />} tone="sky" />
        <Stat label="Generation commissions (G1–G3)" value={formatINR(d.generationCommissions)} sub={`Pending ${formatINR(d.pendingCommissions)} · Skipped ${formatINR(d.skippedCommissions)}`} icon={<Layers className={ic} />} tone="sky" />
        <Stat label="Turnover commissions (G4+)" value={formatINR(d.turnoverCommissions)} icon={<Layers className={ic} />} tone="green" />
        <Stat label="Pending withdrawals" value={d.pendingWithdrawalsCount} sub={formatINR(d.pendingWithdrawalsAmount)} icon={<Banknote className={ic} />} tone="amber" />
        <Stat label="Successful payouts" value={formatINR(d.successfulPayouts)} sub={`Platform charges ${formatINR(d.platformCharges)}`} icon={<Percent className={ic} />} tone="green" />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card title="Package-wise users">
          <div className="space-y-3">
            {d.packageWiseUsers.map((p) => {
              const max = Math.max(1, ...d.packageWiseUsers.map((x) => x.users));
              return (
                <div key={p.package}>
                  <div className="flex justify-between text-sm"><span className="font-medium">{p.package}</span><span className="tabular-nums text-slate-600">{p.users}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(p.users / max) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Quick actions">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['/admin/withdrawals', 'Process withdrawals'],
              ['/admin/payments', 'Reconcile payments'],
              ['/admin/users', 'Manage users'],
              ['/admin/settings', 'Withdrawal schedule'],
              ['/admin/packages', 'Packages & rates'],
              ['/admin/reports', 'Reports & exports'],
            ].map(([to, label]) => (
              <Link key={to} to={to} className="rounded-lg border border-slate-200 px-3 py-3 font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50">{label}</Link>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

interface ReportRow {
  bucket: string;
  signups: number;
  salesCount: number;
  salesAmount: string;
  directCommission: string;
  generationCommission: string;
  payouts: string;
  charges: string;
}

const EXPORTS: [string, string][] = [
  ['users', 'Users'],
  ['purchases', 'Purchases & payments'],
  ['commissions', 'Commissions'],
  ['withdrawals', 'Withdrawals'],
  ['ledger', 'Wallet ledger'],
];

export function AdminReports() {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['reports', period, from, to],
    queryFn: () => api.get<{ rows: ReportRow[]; from: string; to: string }>(`/admin/reports${qs({ period, from, to })}`),
  });
  const rows = data?.rows ?? [];
  const sum = (k: keyof ReportRow) => rows.reduce((a, r) => a + Number(r[k]), 0);

  return (
    <>
      <PageHeader title="Reports & exports" subtitle="Daily, weekly and monthly performance (IST)." />
      <Card padded={false}>
        <div className="px-4 pt-2">
          <Tabs value={period} onChange={setPeriod} tabs={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />
        </div>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {data && <span className="pb-2 text-xs text-slate-500">Showing {formatDate(data.from)} – {formatDate(data.to)}</span>}
        </div>
        {isLoading ? (
          <Spinner />
        ) : (
          <Table
            rows={[...rows].reverse()}
            rowKey={(r) => r.bucket}
            columns={[
              { key: 'b', header: period === 'day' ? 'Date' : period === 'week' ? 'Week of' : 'Month', render: (r) => (period === 'month' ? new Date(r.bucket).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : formatDate(r.bucket)) },
              { key: 'su', header: 'Signups', className: 'text-right', render: (r) => r.signups },
              { key: 'sc', header: 'Sales', className: 'text-right', render: (r) => r.salesCount },
              { key: 'sa', header: 'Sales amount', className: 'text-right', render: (r) => formatINR(r.salesAmount) },
              { key: 'dc', header: 'Direct comm.', className: 'text-right', render: (r) => formatINR(r.directCommission) },
              { key: 'gc', header: 'Gen + turnover comm.', className: 'text-right', render: (r) => formatINR(r.generationCommission) },
              { key: 'po', header: 'Payouts (net)', className: 'text-right', render: (r) => formatINR(r.payouts) },
              { key: 'ch', header: 'Platform charges', className: 'text-right', render: (r) => formatINR(r.charges) },
            ]}
          />
        )}
        {rows.length > 0 && (
          <div className="grid grid-cols-2 gap-4 border-t border-slate-100 p-4 text-sm md:grid-cols-4">
            <div><p className="text-slate-500">Total sales</p><p className="font-semibold">{formatINR(sum('salesAmount'))}</p></div>
            <div><p className="text-slate-500">Total commissions</p><p className="font-semibold">{formatINR(sum('directCommission') + sum('generationCommission'))}</p></div>
            <div><p className="text-slate-500">Total payouts</p><p className="font-semibold">{formatINR(sum('payouts'))}</p></div>
            <div><p className="text-slate-500">Platform charges</p><p className="font-semibold">{formatINR(sum('charges'))}</p></div>
          </div>
        )}
      </Card>

      <Card title="Export data (CSV — opens in Excel)" className="mt-6">
        <p className="mb-4 text-sm text-slate-500">Uses the From/To dates above when set. Every export is recorded in the audit log.</p>
        <div className="flex flex-wrap gap-2">
          {EXPORTS.map(([key, label]) => (
            <Button key={key} variant="secondary" onClick={() => api.download(`/admin/export/${key}${qs({ from, to })}`, `skillsearn-${key}.csv`)}>
              <Download className="h-4 w-4" /> {label}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => window.print()}>Print this report / Save as PDF</Button>
        </div>
      </Card>
    </>
  );
}

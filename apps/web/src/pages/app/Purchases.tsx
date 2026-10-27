import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Card, PageHeader, Spinner, StatusBadge, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, formatDateTime, formatINR, packageColor } from '../../lib/format';
import type { CheckoutPayload, Package, Purchase } from '../../lib/types';
import { PackageCards } from '../public/Home';
import { usePay } from './Checkout';

export function Purchases() {
  const { data } = useQuery({ queryKey: ['purchases'], queryFn: () => api.get<Purchase[]>('/me/purchases') });
  return (
    <>
      <PageHeader title="Purchases" subtitle="Purchase and upgrade history." />
      <Card padded={false}>
        <Table
          rows={data}
          empty="No purchases yet"
          columns={[
            { key: 'date', header: 'Date', render: (p) => formatDateTime(p.createdAt) },
            { key: 'type', header: 'Type', render: (p) => (p.type === 'upgrade' ? `Upgrade ${p.fromPackage?.name} → ${p.package?.name}` : `${p.package?.name} package`) },
            { key: 'amount', header: 'Amount', className: 'text-right', render: (p) => formatINR(p.amount) },
            { key: 'status', header: 'Payment', render: (p) => <StatusBadge status={p.status} /> },
            { key: 'ref', header: 'Payment ref', render: (p) => <span className="font-mono text-xs">{p.providerPaymentId ?? '—'}</span> },
            { key: 'paid', header: 'Verified', render: (p) => formatDate(p.paidAt) },
            {
              key: 'action', header: '', render: (p) =>
                ['pending', 'failed'].includes(p.status) ? <Link to={`/app/checkout/${p.id}`} className="text-sm font-semibold text-brand-600">Pay now</Link> : null,
            },
          ]}
        />
      </Card>
    </>
  );
}

interface UpgradeOptions {
  current: { id: string; name: string; level: number; price: number };
  deadline: string | null;
  windowOpen: boolean;
  commissionable: boolean;
  options: { id: string; name: string; level: number; price: number; maxGenerations: number; payable: number }[];
}

export function Upgrade() {
  const navigate = useNavigate();
  const opts = useQuery({ queryKey: ['upgrade-options'], queryFn: () => api.get<UpgradeOptions>('/payments/upgrade-options'), retry: false });
  const packages = useQuery({ queryKey: ['packages'], queryFn: () => api.get<Package[]>('/packages') });
  const { pay, paying, error: payError } = usePay(() => navigate('/app/purchases'));
  const start = useMutation({
    mutationFn: (packageId: string) => api.post<CheckoutPayload>('/payments/upgrade', { packageId }),
    onSuccess: (payload) => pay(payload),
  });
  const buy = useMutation({
    mutationFn: (packageId: string) => api.post<CheckoutPayload>('/payments/checkout', { packageId }),
    onSuccess: (p) => navigate(`/app/checkout/${p.purchaseId}`),
  });

  if (opts.isLoading) return <Spinner />;

  // No active package yet → let the user pick one.
  if (opts.error) {
    return (
      <>
        <PageHeader title="Choose a package" subtitle="Activate a package to unlock courses and start earning." />
        {buy.error && <div className="mb-4"><Alert>{(buy.error as Error).message}</Alert></div>}
        {packages.data && <PackageCards packages={packages.data} cta={false} />}
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {packages.data?.map((p) => (
            <Button key={p.id} loading={buy.isPending && buy.variables === p.id} onClick={() => buy.mutate(p.id)}>
              Buy {p.name} · {formatINR(p.price, true)}
            </Button>
          ))}
        </div>
      </>
    );
  }

  const o = opts.data!;
  const err = start.error ?? (payError ? new Error(payError) : null);
  return (
    <>
      <PageHeader title="Upgrade package" subtitle="Pay only the price difference. Course access and generation eligibility update instantly." />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className={`rounded-xl bg-gradient-to-br ${packageColor(o.current.level)} p-5 text-white`}>
          <p className="text-xs uppercase tracking-wide opacity-80">Current package</p>
          <p className="text-2xl font-bold">{o.current.name}</p>
          <p className="text-sm opacity-90">{formatINR(o.current.price, true)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 md:col-span-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Upgrade deadline</p>
          <p className="mt-1 text-lg font-semibold">{o.deadline ? formatDateTime(o.deadline) : 'No deadline'}</p>
          {!o.windowOpen && <p className="mt-1 text-sm text-rose-600">The upgrade period has ended. Contact support for help.</p>}
        </div>
      </div>
      {err && <div className="mb-4"><Alert>{err.message}</Alert></div>}
      {o.options.length === 0 ? (
        <Card>
          <p className="flex items-center gap-2 text-sm text-slate-600"><CheckCircle2 className="h-5 w-5 text-emerald-500" /> You already have the highest package.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {o.options.map((p) => (
            <Card key={p.id}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">{o.current.name} <ArrowRight className="inline h-3 w-3" /> <b className="text-slate-900">{p.name}</b></p>
                  <p className="mt-1 text-3xl font-bold">{formatINR(p.payable, true)}</p>
                  <p className="text-xs text-slate-500">New price {formatINR(p.price, true)} − current {formatINR(o.current.price, true)}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-1 text-sm text-slate-600">
                <li>✓ {p.name} courses unlocked</li>
                <li>✓ Generation income up to Generation {p.maxGenerations}</li>
                <li>✓ Turnover income from Generation 4 onwards</li>
              </ul>
              <Button className="mt-5 w-full" disabled={!o.windowOpen} loading={(start.isPending && start.variables === p.id) || paying} onClick={() => start.mutate(p.id)}>
                Upgrade to {p.name}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

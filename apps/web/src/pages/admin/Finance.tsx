import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Send } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Field, FilterBar, Input, KV, Modal, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Tabs, Textarea } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useDebounced, useGenerations, usePaged } from '../../lib/hooks';
import { formatDateTime, formatINR, humanize, LEDGER_TYPES, levelLabel } from '../../lib/format';
import type { Commission, LedgerEntry, PayoutGatewayStatus, Purchase, Withdrawal } from '../../lib/types';
import { commissionColumns, ledgerColumns } from '../app/Income';
import { Breakdown } from '../app/Withdrawals';

const userCell = (u?: { userCode: string; fullName: string; mobile?: string }) =>
  u ? <div><p className="font-medium text-slate-900">{u.fullName}</p><p className="text-xs text-slate-500">{u.userCode}{u.mobile ? ` · ${u.mobile}` : ''}</p></div> : '—';

// ───────────────────────── Payments ─────────────────────────
export function AdminPayments() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const list = usePaged<Purchase>('admin-payments', '/admin/payments', { status: status === 'all' ? '' : status, type, search: useDebounced(search) });
  const detail = useQuery({
    queryKey: ['admin-payment', selected],
    queryFn: () => api.get<{ purchase: Purchase; events: { id: number; event: string; provider: string; createdAt: string; payload: unknown }[]; commissions: Commission[] }>(`/admin/payments/${selected}`),
    enabled: !!selected,
  });
  const done = () => { setReference(''); setNote(''); qc.invalidateQueries(); };
  const verify = useMutation({ mutationFn: () => api.post(`/admin/payments/${selected}/verify`, { reference, note: note || undefined }), onSuccess: done });
  const fail = useMutation({ mutationFn: () => api.post(`/admin/payments/${selected}/fail`, { note: note || undefined }), onSuccess: done });
  const p = detail.data?.purchase;

  return (
    <>
      <PageHeader title="Payments" subtitle="Purchase history, gateway transactions, pending/failed payments and reconciliation." />
      <Card padded={false}>
        <div className="px-4 pt-2">
          <Tabs value={status} onChange={setStatus} tabs={['pending', 'paid', 'failed', 'cancelled', 'all'].map((s) => ({ value: s, label: humanize(s) }))} />
        </div>
        <FilterBar>
          <Field label="Search user"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="User ID, name, mobile" /></Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option><option value="new">New purchase</option><option value="upgrade">Upgrade</option></Select>
          </Field>
        </FilterBar>
        <Table
          rows={list.data?.items}
          onRowClick={(r) => setSelected(r.id)}
          columns={[
            { key: 'd', header: 'Created', render: (r) => formatDateTime(r.createdAt) },
            { key: 'u', header: 'User', render: (r) => userCell(r.user) },
            { key: 't', header: 'Package', render: (r) => (r.type === 'upgrade' ? `${r.fromPackage?.name} → ${r.package?.name}` : r.package?.name) },
            { key: 'a', header: 'Amount', className: 'text-right', render: (r) => formatINR(r.amount) },
            { key: 'pr', header: 'Provider', render: (r) => r.provider ?? '—' },
            { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'c', header: 'Commission', render: (r) => <StatusBadge status={r.commissionStatus} /> },
          ]}
        />
        {list.data && <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>

      <Modal open={!!selected} onClose={() => { setSelected(null); verify.reset(); fail.reset(); }} title="Payment details" wide>
        {!p ? <Spinner /> : (
          <div className="space-y-5">
            <KV items={[
              ['User', p.user ? <Link className="text-brand-600" to={`/admin/users/${p.user.id}`}>{p.user.fullName} ({p.user.userCode})</Link> : '—'],
              ['Package', p.type === 'upgrade' ? `Upgrade ${p.fromPackage?.name} → ${p.package?.name}` : p.package?.name],
              ['Amount', formatINR(p.amount)], ['Commission base', formatINR(p.commissionBase)],
              ['Status', <StatusBadge status={p.status} />], ['Provider / ref', `${p.provider ?? '—'} · ${p.providerPaymentId ?? '—'}`],
              ['Paid at', formatDateTime(p.paidAt)], ['Notes', p.notes ?? '—'],
            ]} />
            {detail.data!.commissions.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold">Commission breakdown</h4>
                <Table rows={detail.data!.commissions} columns={[
                  { key: 'l', header: 'Level', render: (c) => levelLabel(c.level) },
                  { key: 'b', header: 'Beneficiary', render: (c) => `${c.beneficiary?.fullName} (${c.beneficiary?.userCode})` },
                  { key: 'c', header: 'Calculation', render: (c) => <span className="font-mono text-xs">{c.calculation}</span> },
                  { key: 'a', header: 'Amount', render: (c) => formatINR(c.amount) },
                  { key: 's', header: 'Status', render: (c) => <span title={c.skipReason ?? ''}><StatusBadge status={c.status} /></span> },
                ]} />
              </div>
            )}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Gateway events</h4>
              {detail.data!.events.length === 0 ? <p className="text-sm text-slate-500">No events.</p> : (
                <ul className="space-y-1 text-xs">
                  {detail.data!.events.map((e) => (
                    <li key={e.id} className="flex justify-between rounded bg-slate-50 px-3 py-1.5"><span className="font-mono">{e.provider} · {e.event}</span><span className="text-slate-500">{formatDateTime(e.createdAt)}</span></li>
                  ))}
                </ul>
              )}
            </div>
            {['pending', 'failed'].includes(p.status) && (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
                <h4 className="text-sm font-semibold">Manual reconciliation</h4>
                <p className="text-xs text-slate-600">Verify only after confirming the money was received (bank statement / gateway dashboard). This activates the package and processes commissions.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Payment reference (UTR / gateway ID)"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
                  <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                </div>
                {(verify.error || fail.error) && <Alert>{((verify.error || fail.error) as Error).message}</Alert>}
                <div className="flex gap-2">
                  <Button variant="success" disabled={reference.length < 3} loading={verify.isPending} onClick={() => verify.mutate()}>Mark verified & activate</Button>
                  {p.status === 'pending' && <Button variant="danger" loading={fail.isPending} onClick={() => fail.mutate()}>Mark failed</Button>}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

// ───────────────────────── Commissions ─────────────────────────
export function AdminCommissions() {
  const qc = useQueryClient();
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const generations = useGenerations();
  const list = usePaged<Commission>('admin-commissions', '/admin/commissions', { level, status, search: useDebounced(search) });
  const release = useMutation({ mutationFn: () => api.post<{ released: number }>('/admin/commissions/release'), onSuccess: () => qc.invalidateQueries() });
  return (
    <>
      <PageHeader
        title="Commissions"
        subtitle="Purchase-wise direct and generation commission breakdown with processing status."
        actions={
          <>
            <Button variant="secondary" loading={release.isPending} onClick={() => release.mutate()}><RefreshCw className="h-4 w-4" /> Release matured pending</Button>
            <Button variant="secondary" onClick={() => api.download('/admin/export/commissions', 'skillsearn-commissions.csv')}><Download className="h-4 w-4" /> Export</Button>
          </>
        }
      />
      {release.data && <div className="mb-4"><Alert tone="green">Released {release.data.released} pending commission(s).</Alert></div>}
      <Card padded={false}>
        <FilterBar>
          <Field label="Beneficiary"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="User ID, name, mobile" /></Field>
          <Field label="Level">
            <Select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">All</option><option value="0">Direct</option>
              {generations.map((g) => <option key={g} value={g}>Generation {g}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="credited">Credited</option><option value="pending">Pending</option><option value="skipped">Skipped</option>
            </Select>
          </Field>
        </FilterBar>
        <Table rows={list.data?.items} columns={commissionColumns(true)} />
        {list.data && <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
    </>
  );
}

// ───────────────────────── Withdrawals ─────────────────────────
type WStatus = Withdrawal['status'];
const NEXT: Record<WStatus, { to: WStatus; label: string; variant: 'primary' | 'secondary' | 'danger' | 'success' }[]> = {
  requested: [{ to: 'under_review', label: 'Start review', variant: 'secondary' }, { to: 'approved', label: 'Approve', variant: 'primary' }, { to: 'rejected', label: 'Reject', variant: 'danger' }],
  under_review: [{ to: 'approved', label: 'Approve', variant: 'primary' }, { to: 'rejected', label: 'Reject', variant: 'danger' }],
  approved: [{ to: 'processing', label: 'Mark processing', variant: 'secondary' }, { to: 'paid', label: 'Mark paid', variant: 'success' }, { to: 'rejected', label: 'Reject', variant: 'danger' }],
  processing: [{ to: 'paid', label: 'Mark paid', variant: 'success' }, { to: 'failed', label: 'Payout failed', variant: 'danger' }],
  paid: [], rejected: [], failed: [],
};

export function AdminWithdrawals() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const list = usePaged<Withdrawal>('admin-withdrawals', '/admin/withdrawals', { status: status === 'all' ? '' : status, search: useDebounced(search) });
  const detail = useQuery({
    queryKey: ['admin-withdrawal', selected],
    queryFn: () => api.get<{ withdrawal: Withdrawal; events: { id: number; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string; actor: { userCode: string } | null }[]; ledger: LedgerEntry[]; wallet: { availableBalance: number } }>(`/admin/withdrawals/${selected}`),
    enabled: !!selected,
  });
  const act = useMutation({
    mutationFn: (to: WStatus) => api.patch(`/admin/withdrawals/${selected}`, { status: to, note: note || undefined, paymentReference: reference || undefined }),
    onSuccess: () => { setNote(''); setReference(''); qc.invalidateQueries(); },
  });
  const gateway = useQuery({ queryKey: ['payout-gateway'], queryFn: () => api.get<PayoutGatewayStatus>('/admin/payouts/status'), staleTime: 5 * 60_000 });
  const payout = useMutation({
    mutationFn: () => api.post(`/admin/withdrawals/${selected}/payout`),
    onSuccess: () => qc.invalidateQueries(),
  });
  const syncPayout = useMutation({
    mutationFn: () => api.post(`/admin/withdrawals/${selected}/payout/sync`),
    onSuccess: () => qc.invalidateQueries(),
  });
  const w = detail.data?.withdrawal;
  const busy = payout.isPending || act.isPending;

  return (
    <>
      <PageHeader title="Withdrawals" subtitle="Approve, pay and reconcile withdrawal requests."
        actions={<Button variant="secondary" onClick={() => api.download(`/admin/export/withdrawals${qs({ status: ['open', 'all'].includes(status) ? '' : status })}`, 'skillsearn-withdrawals.csv')}><Download className="h-4 w-4" /> Export</Button>} />
      <Card padded={false}>
        <div className="px-4 pt-2">
          <Tabs value={status} onChange={setStatus} tabs={['open', 'requested', 'under_review', 'approved', 'processing', 'paid', 'rejected', 'failed', 'all'].map((s) => ({ value: s, label: s === 'open' ? 'All open' : humanize(s) }))} />
        </div>
        <FilterBar><Field label="Search user"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="User ID, name, mobile" /></Field></FilterBar>
        <Table
          rows={list.data?.items}
          onRowClick={(r) => setSelected(r.id)}
          columns={[
            { key: 'd', header: 'Requested', render: (r) => formatDateTime(r.requestedAt) },
            { key: 'u', header: 'User', render: (r) => userCell(r.user) },
            { key: 'g', header: 'Gross', className: 'text-right', render: (r) => formatINR(r.grossAmount) },
            { key: 'c', header: 'Platform charge', className: 'text-right', render: (r) => <span className="text-rose-600">{formatINR(r.chargeAmount)}</span> },
            { key: 'n', header: 'Net payable', className: 'text-right', render: (r) => <b>{formatINR(r.netAmount)}</b> },
            { key: 'm', header: 'Method', render: (r) => r.method.toUpperCase() },
            { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {list.data && <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>

      <Modal open={!!selected} onClose={() => { setSelected(null); act.reset(); payout.reset(); syncPayout.reset(); }} title="Withdrawal request" wide>
        {!w ? <Spinner /> : (
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <h4 className="mb-1 text-sm font-semibold">Amount breakdown</h4>
                <Breakdown gross={w.grossAmount} chargeBps={w.chargeBps} charge={w.chargeAmount} net={w.netAmount} />
              </div>
              <div>
                <h4 className="mb-1 text-sm font-semibold">Payout to</h4>
                <KV items={[
                  ['User', w.user ? <Link className="text-brand-600" to={`/admin/users/${w.user.id}`}>{w.user.fullName} ({w.user.userCode})</Link> : '—'],
                  ['Method', w.method.toUpperCase()],
                  ...(w.method === 'upi'
                    ? ([['UPI ID', w.payoutDetails.upiId], ['Name', w.payoutDetails.accountName ?? '—']] as [string, string | undefined][])
                    : ([['Account name', w.payoutDetails.accountName], ['Account no.', w.payoutDetails.accountNumber], ['IFSC', w.payoutDetails.ifsc], ['Bank', w.payoutDetails.bankName ?? '—']] as [string, string | undefined][])),
                  ['Status', <StatusBadge status={w.status} />],
                  ['Payment ref', w.paymentReference ?? '—'],
                  ['Current wallet balance', formatINR(detail.data!.wallet.availableBalance)],
                ]} />
              </div>
            </div>
            {w.payoutProvider === 'razorpayx' && (
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">RazorpayX payout</h4>
                  {w.payoutId && w.status === 'processing' && (
                    <Button size="sm" variant="secondary" loading={syncPayout.isPending} onClick={() => syncPayout.mutate()}>
                      <RefreshCw className="h-4 w-4" /> Refresh status
                    </Button>
                  )}
                </div>
                <KV items={[
                  ['Payout ID', w.payoutId ?? '—'],
                  ['Gateway status', w.payoutStatus ? humanize(w.payoutStatus) : '—'],
                  ['Mode', w.payoutMode ?? '—'],
                  ['UTR', w.payoutUtr ?? '—'],
                  ...(w.payoutError ? ([['Error', <span className="text-rose-600">{w.payoutError}</span>]] as [string, ReactNode][]) : []),
                ]} />
                {syncPayout.error && <div className="mt-2"><Alert>{(syncPayout.error as Error).message}</Alert></div>}
              </div>
            )}
            {w.status === 'approved' && w.payoutStatus !== 'initiating' && (
              <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Pay automatically with RazorpayX</p>
                    <p className="text-xs text-slate-600">
                      Sends {formatINR(w.netAmount)} by {w.method === 'upi' ? 'UPI' : 'IMPS'} to the details above. The request moves to Processing, then to Paid or Failed when Razorpay confirms.
                      {gateway.data?.testMode && ' Test mode: no real money moves.'}
                    </p>
                  </div>
                  <Button disabled={!gateway.data?.enabled || busy} loading={payout.isPending}
                    onClick={() => confirm(`Send ${formatINR(w.netAmount)} to ${w.user?.fullName ?? 'this user'} via RazorpayX?`) && payout.mutate()}>
                    <Send className="h-4 w-4" /> {w.payoutStatus === 'initiation_failed' ? 'Retry payout' : `Pay ${formatINR(w.netAmount)}`}
                  </Button>
                </div>
                {gateway.data && !gateway.data.enabled && <Alert tone="amber">RazorpayX payouts are off: {gateway.data.reason}. You can still pay manually and use Mark paid below.</Alert>}
                {payout.error && <Alert>{(payout.error as Error).message}</Alert>}
              </div>
            )}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Audit trail</h4>
              <ol className="space-y-1 text-xs">
                {detail.data!.events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3 rounded bg-slate-50 px-3 py-1.5">
                    <span>{e.fromStatus ? `${humanize(e.fromStatus)} → ` : ''}<b>{humanize(e.toStatus)}</b>{e.note ? ` · ${e.note}` : ''}{e.actor ? ` · by ${e.actor.userCode}` : ''}</span>
                    <span className="shrink-0 text-slate-500">{formatDateTime(e.createdAt)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-semibold">Ledger entries</h4>
              <Table rows={detail.data!.ledger} columns={ledgerColumns().filter((c) => c.key !== 'desc')} empty="No ledger entries" />
            </div>
            {NEXT[w.status].length > 0 && w.payoutStatus !== 'initiating' && !(w.payoutId && w.status === 'processing') && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Payment reference (required for Mark paid)"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / transaction ID" /></Field>
                  <Field label="Note to user (reason for reject/failure)"><Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                </div>
                {act.error && <Alert>{(act.error as Error).message}</Alert>}
                <div className="flex flex-wrap gap-2">
                  {NEXT[w.status].map((n) => (
                    <Button key={n.to} variant={n.variant} loading={act.isPending && act.variables === n.to} disabled={n.to === 'paid' && !reference.trim()} onClick={() => act.mutate(n.to)}>{n.label}</Button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">Manual payout: mark paid only after you have transferred {formatINR(w.netAmount)} to the user. Reject/failed returns {formatINR(w.grossAmount)} to their wallet.</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

// ───────────────────────── Ledger ─────────────────────────
export function AdminLedger() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = usePaged<LedgerEntry>('admin-ledger', '/admin/ledger', { search: useDebounced(search), type, from, to }, 50);
  return (
    <>
      <PageHeader title="Wallet ledger" subtitle="Append-only record of every wallet transaction."
        actions={<Button variant="secondary" onClick={() => api.download(`/admin/export/ledger${qs({ from, to })}`, 'skillsearn-ledger.csv')}><Download className="h-4 w-4" /> Export</Button>} />
      <Card padded={false}>
        <FilterBar>
          <Field label="User"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="User ID, name, mobile" /></Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All</option>
              {Object.entries(LEDGER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </FilterBar>
        <Table rows={list.data?.items} columns={ledgerColumns(true)} />
        {list.data && <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
    </>
  );
}

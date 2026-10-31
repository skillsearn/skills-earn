import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, CopyButton, Field, FilterBar, Input, KV, Modal, PageHeader, Pagination, Select, Spinner, Stat, StatusBadge, Table, Tabs, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { useDebounced, usePaged } from '../../lib/hooks';
import { formatDate, formatDateTime, formatINR } from '../../lib/format';
import type { PayoutDetails, Commission, DownlineMember, LedgerEntry, Package, Purchase, TeamSummary, WalletSummary, Withdrawal } from '../../lib/types';
import { commissionColumns, ledgerColumns } from '../app/Income';

interface AdminUserRow {
  id: string;
  userCode: string;
  fullName: string;
  email: string;
  mobile: string;
  referralCode: string;
  role: string;
  status: string;
  createdAt: string;
  activePackage: { name: string; level: number } | null;
  sponsor: { userCode: string; fullName: string } | null;
  payoutDetails: PayoutDetails | null;
}

export function AdminUsers() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [packageId, setPackageId] = useState('');
  const q = useDebounced(search);
  const packages = useQuery({ queryKey: ['admin-packages'], queryFn: () => api.get<Package[]>('/admin/packages') });
  const list = usePaged<AdminUserRow>('admin-users', '/admin/users', { search: q, status, packageId });
  return (
    <>
      <PageHeader title="Users" subtitle="Search users, view complete profiles, bank / UPI details, hierarchy and statements."
        actions={<Button variant="secondary" onClick={() => api.download('/admin/export/users', 'skillsearn-users.csv')}><Download className="h-4 w-4" /> Export (with bank details)</Button>} />
      <Card padded={false}>
        <FilterBar>
          <Field label="Search"><Input placeholder="User ID, name, mobile, email" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option>
            </Select>
          </Field>
          <Field label="Package">
            <Select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">All</option><option value="none">No package</option>
              {packages.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </FilterBar>
        <Table
          rows={list.data?.items}
          onRowClick={(u) => navigate(`/admin/users/${u.id}`)}
          columns={[
            { key: 'u', header: 'User', render: (u) => <div><p className="font-medium text-slate-900">{u.fullName} {u.role === 'admin' && <Badge tone="brand">admin</Badge>}</p><p className="text-xs text-slate-500">{u.userCode} · {u.mobile}</p></div> },
            { key: 'code', header: 'Referral code', render: (u) => <span className="font-mono text-xs">{u.referralCode}</span> },
            { key: 'sp', header: 'Direct referrer', render: (u) => (u.sponsor ? `${u.sponsor.userCode}` : '—') },
            { key: 'pay', header: 'Bank / UPI', render: (u) => {
              const d = u.payoutDetails;
              if (!d || (!d.upiId && !d.accountNumber)) return <span className="text-xs text-slate-400">Not added</span>;
              return <div className="text-xs">{d.upiId && <p className="font-mono">{d.upiId}</p>}{d.accountNumber && <p className="text-slate-500">{d.bankName ?? 'Bank'} · {d.accountNumber}</p>}{d.upiQrPath && <p className="text-emerald-600">QR uploaded</p>}</div>;
            } },
            { key: 'pkg', header: 'Package', render: (u) => u.activePackage?.name ?? <span className="text-slate-400">None</span> },
            { key: 'st', header: 'Status', render: (u) => <StatusBadge status={u.status} /> },
            { key: 'j', header: 'Joined', render: (u) => formatDate(u.createdAt) },
          ]}
        />
        {list.data && <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
    </>
  );
}

interface UserDetailData {
  profile: AdminUserRow & {
    packageActivatedAt: string | null; registrationIp: string | null; upiQrUrl: string | null; termsAcceptedAt: string | null;
    updatedAt: string | null; lastSignInAt: string | null; emailConfirmedAt: string | null; activePackage: { name: string; maxGenerations: number } | null; sponsor: { id: string; userCode: string; fullName: string } | null };
  wallet: WalletSummary;
  team: TeamSummary;
  purchases: Purchase[];
  withdrawals: Withdrawal[];
}

interface Hierarchy {
  upline: { id: string; userCode: string; fullName: string; status: string; position: number; role: string; activePackage: { name: string; maxGenerations: number } | null }[];
  team: TeamSummary;
}

export function AdminUserDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'hierarchy' | 'purchases' | 'commissions' | 'ledger' | 'withdrawals'>('hierarchy');
  const [depth, setDepth] = useState('1');
  const [statusModal, setStatusModal] = useState(false);
  const [adjustModal, setAdjustModal] = useState(false);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');

  const detail = useQuery({ queryKey: ['admin-user', id], queryFn: () => api.get<UserDetailData>(`/admin/users/${id}`) });
  const hierarchy = useQuery({ queryKey: ['admin-hierarchy', id], queryFn: () => api.get<Hierarchy>(`/admin/users/${id}/hierarchy`), enabled: tab === 'hierarchy' });
  const downline = usePaged<DownlineMember>('admin-downline', `/admin/users/${id}/downline`, { depth });
  const commissions = usePaged<Commission>('admin-user-comm', '/admin/commissions', { userId: id });
  const ledger = usePaged<LedgerEntry>('admin-user-ledger', '/admin/ledger', { userId: id });

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/admin/users/${id}/status`, { status, reason }),
    onSuccess: () => { setStatusModal(false); setReason(''); qc.invalidateQueries({ queryKey: ['admin-user', id] }); },
  });
  const adjust = useMutation({
    mutationFn: () => api.post(`/admin/users/${id}/adjust`, { amount: Number(amount), reason }),
    onSuccess: () => { setAdjustModal(false); setReason(''); setAmount(''); qc.invalidateQueries(); },
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !detail.data) return <Alert>{(detail.error as Error)?.message}</Alert>;
  const { profile: p, wallet: w, team, purchases, withdrawals } = detail.data;
  const suspended = p.status === 'suspended';

  return (
    <>
      <Link to="/admin/users" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Users</Link>
      <PageHeader
        title={p.fullName}
        subtitle={<>{p.userCode} · <StatusBadge status={p.status} /></>}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAdjustModal(true)}>Wallet adjustment</Button>
            <Button variant={suspended ? 'success' : 'danger'} onClick={() => setStatusModal(true)}>{suspended ? 'Reactivate' : 'Suspend'}</Button>
          </>
        }
      />
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Profile & registration">
          <KV
            items={[
              ['Full name', p.fullName], ['User ID', <span className="font-mono">{p.userCode}</span>],
              ['Email', <span className="break-all">{p.email}</span>], ['Mobile', p.mobile],
              ['Role', p.role], ['Account status', <StatusBadge status={p.status} />],
              ['Referral code', <span className="font-mono">{p.referralCode}</span>],
              ['Direct referrer', p.sponsor ? <Link className="text-brand-600" to={`/admin/users/${p.sponsor.id}`}>{p.sponsor.fullName} ({p.sponsor.userCode})</Link> : '—'],
              ['Registered on', formatDateTime(p.createdAt)], ['Terms accepted', formatDateTime(p.termsAcceptedAt)],
              ['Registration IP', p.registrationIp ?? '—'], ['Last login', formatDateTime(p.lastSignInAt)],
              ['Profile updated', formatDateTime(p.updatedAt)],
            ]}
          />
        </Card>
        <Card title="Package & payment">
          <KV
            items={[
              ['Package', p.activePackage ? `${p.activePackage.name} (G1–G${p.activePackage.maxGenerations} + turnover G4+)` : 'None'],
              ['Activated', formatDateTime(p.packageActivatedAt)],
              ['Purchases', `${purchases.filter((x) => x.status === 'paid').length} paid · ${purchases.filter((x) => x.status === 'pending').length} pending`],
              ['Last payment ref', purchases.find((x) => x.status === 'paid')?.providerPaymentId ?? '—'],
            ]}
          />
          {purchases.filter((x) => x.proofUrl).slice(0, 4).map((x) => (
            <div key={x.id} className="mt-3 rounded-lg border border-slate-200 p-2">
              <p className="mb-1 text-xs text-slate-500">Payment screenshot · {x.package?.name} · {formatINR(x.amount)} · UTR <span className="font-mono">{x.manualUtr}</span> · <StatusBadge status={x.status} /></p>
              <a href={x.proofUrl!} target="_blank" rel="noreferrer" title="Open full size"><img src={x.proofUrl!} alt="Payment screenshot" className="max-h-56 w-full rounded object-contain" /></a>
            </div>
          ))}
          {!purchases.some((x) => x.proofUrl) && <p className="mt-3 text-xs text-slate-500">No manual payment screenshot uploaded.</p>}
        </Card>
        <Card title="Bank & UPI details">
          <KV
            items={[
              ['Account holder', p.payoutDetails?.accountName ?? '—'],
              ['Account number', p.payoutDetails?.accountNumber ? <span className="flex items-center justify-end gap-2 font-mono">{p.payoutDetails.accountNumber}<CopyButton text={p.payoutDetails.accountNumber} label="" /></span> : '—'],
              ['IFSC', p.payoutDetails?.ifsc ? <span className="flex items-center justify-end gap-2 font-mono">{p.payoutDetails.ifsc}<CopyButton text={p.payoutDetails.ifsc} label="" /></span> : '—'],
              ['Bank name', p.payoutDetails?.bankName ?? '—'],
              ['UPI ID', p.payoutDetails?.upiId ? <span className="flex items-center justify-end gap-2 font-mono">{p.payoutDetails.upiId}<CopyButton text={p.payoutDetails.upiId} label="" /></span> : '—'],
            ]}
          />
          <p className="mt-3 text-sm text-slate-500">UPI QR code</p>
          {p.upiQrUrl
            ? <a href={p.upiQrUrl} target="_blank" rel="noreferrer" title="Open full size"><img src={p.upiQrUrl} alt="UPI QR" className="mt-1 h-44 w-44 rounded-lg border border-slate-200 object-contain" /></a>
            : <p className="text-xs text-slate-400">Not uploaded</p>}
        </Card>
      </div>
      <div className="grid gap-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Available balance" value={formatINR(w.availableBalance)} tone="brand" />
          <Stat label="On hold" value={formatINR(w.onHold)} tone="amber" />
          <Stat label="Total income" value={formatINR(w.totalIncome)} sub={`Direct ${formatINR(w.directIncome)}`} />
          <Stat label="Generation income (G1–G3)" value={formatINR(w.gen1Income + w.gen2Income + w.gen3Income)} sub={`G1 ${formatINR(w.gen1Income)} · G2 ${formatINR(w.gen2Income)} · G3 ${formatINR(w.gen3Income)}`} />
          <Stat label="Turnover income (G4+)" value={formatINR(w.turnoverIncome)} sub={`Team business ${formatINR(w.teamTurnover)} · own ${formatINR(w.ownTurnover)}`} />
          <Stat label="Withdrawn (net)" value={formatINR(w.totalWithdrawn)} sub={`Charges ${formatINR(w.totalCharges)}`} />
          <Stat label="Team" value={`${team.directReferrals} direct`} sub={`${team.totalDownline} total · ${team.active} active`} />
        </div>
      </div>

      <Card padded={false} className="mt-6">
        <div className="px-4 pt-2">
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'hierarchy', label: 'Upline & downline' }, { value: 'purchases', label: `Purchases (${purchases.length})` },
            { value: 'commissions', label: 'Commissions' }, { value: 'ledger', label: 'Wallet ledger' }, { value: 'withdrawals', label: 'Withdrawals' },
          ]} />
        </div>
        {tab === 'hierarchy' && (
          <div className="grid gap-6 p-4 lg:grid-cols-3">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Upline chain</h3>
              {hierarchy.data?.upline.length === 0 && <p className="text-sm text-slate-500">No upline (top-level user).</p>}
              <ol className="space-y-2">
                {hierarchy.data?.upline.slice(0, 8).map((u) => (
                  <li key={u.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <p className="text-xs font-semibold uppercase text-brand-600">{u.role}</p>
                    <Link to={`/admin/users/${u.id}`} className="font-medium text-slate-900 hover:text-brand-700">{u.fullName}</Link>
                    <p className="text-xs text-slate-500">{u.userCode} · {u.activePackage?.name ?? 'no package'} · {u.status}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="lg:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Downline</h3>
                <Select value={depth} onChange={(e) => setDepth(e.target.value)} className="w-auto">
                  {Object.keys(team.byDepth).length === 0 && <option value="1">Level 1</option>}
                  {Object.entries(team.byDepth).map(([d, n]) => <option key={d} value={d}>Level {d} ({n})</option>)}
                </Select>
              </div>
              <Table
                rows={downline.data?.items}
                empty="No downline at this level"
                columns={[
                  { key: 'm', header: 'Member', render: (m) => <Link to={`/admin/users/${m.id}`} className="font-medium text-brand-700">{m.fullName} <span className="text-xs text-slate-500">{m.userCode}</span></Link> },
                  { key: 's', header: 'Sponsor', render: (m) => m.sponsorCode },
                  { key: 'p', header: 'Package', render: (m) => m.packageName ?? '—' },
                  { key: 'a', header: 'Active', render: (m) => (m.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Inactive</Badge>) },
                  { key: 'j', header: 'Joined', render: (m) => formatDate(m.joinedAt) },
                ]}
              />
              {downline.data && <Pagination page={downline.page} pageSize={downline.pageSize} total={downline.data.total} onPage={downline.setPage} />}
            </div>
          </div>
        )}
        {tab === 'purchases' && (
          <Table rows={purchases} columns={[
            { key: 'd', header: 'Date', render: (r) => formatDateTime(r.createdAt) },
            { key: 't', header: 'Type', render: (r) => (r.type === 'upgrade' ? `Upgrade ${r.fromPackage?.name} → ${r.package?.name}` : r.package?.name) },
            { key: 'a', header: 'Amount', className: 'text-right', render: (r) => formatINR(r.amount) },
            { key: 's', header: 'Payment', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'c', header: 'Commission', render: (r) => <StatusBadge status={r.commissionStatus} /> },
            { key: 'r', header: 'Ref', render: (r) => <span className="font-mono text-xs">{r.providerPaymentId ?? r.manualUtr ?? '—'}</span> },
            { key: 'sc', header: 'Screenshot', render: (r) => (r.proofUrl ? <a href={r.proofUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-600">View</a> : '—') },
          ]} />
        )}
        {tab === 'commissions' && (
          <>
            <Table rows={commissions.data?.items} columns={commissionColumns()} />
            {commissions.data && <Pagination page={commissions.page} pageSize={commissions.pageSize} total={commissions.data.total} onPage={commissions.setPage} />}
          </>
        )}
        {tab === 'ledger' && (
          <>
            <Table rows={ledger.data?.items} columns={ledgerColumns()} />
            {ledger.data && <Pagination page={ledger.page} pageSize={ledger.pageSize} total={ledger.data.total} onPage={ledger.setPage} />}
          </>
        )}
        {tab === 'withdrawals' && (
          <Table rows={withdrawals} columns={[
            { key: 'd', header: 'Requested', render: (r) => formatDateTime(r.requestedAt) },
            { key: 'g', header: 'Gross', className: 'text-right', render: (r) => formatINR(r.grossAmount) },
            { key: 'c', header: 'Charge', className: 'text-right', render: (r) => formatINR(r.chargeAmount) },
            { key: 'n', header: 'Net', className: 'text-right', render: (r) => formatINR(r.netAmount) },
            { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        )}
      </Card>

      <Modal open={statusModal} onClose={() => setStatusModal(false)} title={suspended ? 'Reactivate account' : 'Suspend account'}
        footer={<><Button variant="secondary" onClick={() => setStatusModal(false)}>Cancel</Button><Button variant={suspended ? 'success' : 'danger'} loading={setStatus.isPending} onClick={() => setStatus.mutate(suspended ? 'active' : 'suspended')}>{suspended ? 'Reactivate' : 'Suspend'}</Button></>}>
        <p className="mb-3 text-sm text-slate-600">{suspended ? 'The user will be able to log in again and receive new commissions.' : 'The user will be logged out, blocked from the dashboard and skipped for new commissions.'}</p>
        <Field label="Reason (recorded in audit log)"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {setStatus.error && <div className="mt-3"><Alert>{(setStatus.error as Error).message}</Alert></div>}
      </Modal>

      <Modal open={adjustModal} onClose={() => setAdjustModal(false)} title="Authorized wallet adjustment"
        footer={<><Button variant="secondary" onClick={() => setAdjustModal(false)}>Cancel</Button><Button loading={adjust.isPending} disabled={!amount || !reason} onClick={() => adjust.mutate()}>Post adjustment</Button></>}>
        <div className="space-y-4">
          <Alert tone="amber">Adjustments are permanent ledger entries and are audited. Use a negative amount to debit.</Alert>
          <Field label="Amount (₹)"><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 100 or -50" /></Field>
          <Field label="Reason"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {adjust.error && <Alert>{(adjust.error as Error).message}</Alert>}
        </div>
      </Modal>
    </>
  );
}

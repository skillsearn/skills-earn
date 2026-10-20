import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Field, FilterBar, Input, KV, Modal, PageHeader, Pagination, Select, Spinner, Stat, StatusBadge, Table, Tabs, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { useDebounced, usePaged } from '../../lib/hooks';
import { formatDate, formatDateTime, formatINR } from '../../lib/format';
import type { Commission, DownlineMember, LedgerEntry, Package, Purchase, TeamSummary, WalletSummary, Withdrawal } from '../../lib/types';
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
      <PageHeader title="Users" subtitle="Search users, view hierarchy, statements and manage accounts." />
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
  profile: AdminUserRow & { packageActivatedAt: string | null; payoutDetails: Record<string, string> | null; registrationIp: string | null; activePackage: { name: string; maxGenerations: number } | null; sponsor: { id: string; userCode: string; fullName: string } | null };
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
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Profile">
          <KV
            items={[
              ['Email', p.email], ['Mobile', p.mobile], ['Referral code', p.referralCode],
              ['Direct referrer', p.sponsor ? <Link className="text-brand-600" to={`/admin/users/${p.sponsor.id}`}>{p.sponsor.fullName} ({p.sponsor.userCode})</Link> : '—'],
              ['Package', p.activePackage ? `${p.activePackage.name} (G1–G${p.activePackage.maxGenerations})` : 'None'],
              ['Activated', formatDate(p.packageActivatedAt)], ['Joined', formatDateTime(p.createdAt)], ['Registration IP', p.registrationIp ?? '—'],
              ['Payout', p.payoutDetails?.upiId ?? p.payoutDetails?.accountNumber ?? '—'],
            ]}
          />
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <Stat label="Available balance" value={formatINR(w.availableBalance)} tone="brand" />
          <Stat label="On hold" value={formatINR(w.onHold)} tone="amber" />
          <Stat label="Total income" value={formatINR(w.totalIncome)} sub={`Direct ${formatINR(w.directIncome)}`} />
          <Stat label="Generation income" value={formatINR(w.gen1Income + w.gen2Income + w.gen3Income)} sub={`G1 ${formatINR(w.gen1Income)} · G2 ${formatINR(w.gen2Income)} · G3 ${formatINR(w.gen3Income)}`} />
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
            { key: 'r', header: 'Ref', render: (r) => <span className="font-mono text-xs">{r.providerPaymentId ?? '—'}</span> },
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

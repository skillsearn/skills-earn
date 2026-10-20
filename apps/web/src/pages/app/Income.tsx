import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Column, FilterBar, Field, Input, PageHeader, Pagination, Select, Stat, StatusBadge, Table, Tabs } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { usePaged } from '../../lib/hooks';
import { formatDateTime, formatINR, LEDGER_TYPES, levelLabel } from '../../lib/format';
import type { Commission, LedgerEntry, WalletSummary } from '../../lib/types';

export const commissionColumns = (showBeneficiary = false): Column<Commission>[] => [
  { key: 'date', header: 'Date', render: (c) => formatDateTime(c.createdAt) },
  ...(showBeneficiary
    ? [{ key: 'ben', header: 'Beneficiary', render: (c: Commission) => <div><p className="font-medium">{c.beneficiary?.fullName}</p><p className="text-xs text-slate-500">{c.beneficiary?.userCode}</p></div> }]
    : []),
  { key: 'source', header: 'From purchase by', render: (c) => <div><p className="font-medium">{c.source?.fullName}</p><p className="text-xs text-slate-500">{c.source?.userCode} · {c.purchase?.package?.name} {c.purchase?.type === 'upgrade' ? '(upgrade)' : ''}</p></div> },
  { key: 'level', header: 'Type', render: (c) => <Badge tone={c.level === 0 ? 'brand' : 'sky'}>{levelLabel(c.level)}</Badge> },
  { key: 'calc', header: 'Calculation', render: (c) => <span className="font-mono text-xs text-slate-600">{c.calculation}</span> },
  { key: 'amount', header: 'Amount', className: 'text-right', render: (c) => <span className={c.status === 'skipped' ? 'text-slate-400 line-through' : 'font-semibold text-emerald-700'}>{formatINR(c.amount)}</span> },
  { key: 'status', header: 'Status', render: (c) => <div><StatusBadge status={c.status} />{c.skipReason && <p className="mt-0.5 text-[11px] text-slate-500">{c.skipReason}</p>}</div> },
];

export const ledgerColumns = (showUser = false): Column<LedgerEntry>[] => [
  { key: 'txn', header: 'Txn ID', render: (l) => <span className="font-mono text-xs">{l.txnId}</span> },
  { key: 'date', header: 'Date', render: (l) => formatDateTime(l.createdAt) },
  ...(showUser ? [{ key: 'user', header: 'User', render: (l: LedgerEntry) => l.user?.userCode }] : []),
  { key: 'type', header: 'Type', render: (l) => LEDGER_TYPES[l.type] ?? l.type },
  { key: 'desc', header: 'Description', render: (l) => <span className="text-slate-600">{l.description}</span> },
  { key: 'amount', header: 'Amount', className: 'text-right', render: (l) => <span className={Number(l.amount) >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-600'}>{Number(l.amount) >= 0 ? '+' : ''}{formatINR(l.amount)}</span> },
  { key: 'bal', header: 'Balance', className: 'text-right', render: (l) => formatINR(l.balanceAfter) },
];

export default function Income() {
  const [tab, setTab] = useState<'commissions' | 'ledger'>('commissions');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const summary = useQuery({ queryKey: ['wallet-summary'], queryFn: () => api.get<WalletSummary>('/me/wallet/summary') });
  const commissions = usePaged<Commission>('commissions', '/me/commissions', { level, status });
  const ledger = usePaged<LedgerEntry>('ledger', '/me/wallet/ledger', { type, from, to });
  const w = summary.data;

  return (
    <>
      <PageHeader
        title="Income & Wallet"
        subtitle="Commission breakdown, income statement and wallet transactions."
        actions={
          <>
            <Button variant="secondary" onClick={() => api.download(`/me/statement.csv${qs({ from, to })}`, 'skillsearn-statement.csv')}>
              <Download className="h-4 w-4" /> Download statement (CSV)
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Available balance" value={w ? formatINR(w.availableBalance) : '—'} tone="brand" />
        <Stat label="Total income" value={w ? formatINR(w.totalIncome) : '—'} />
        <Stat label="Pending commission" value={w ? formatINR(w.pendingCommission) : '—'} tone="amber" />
        <Stat label="Platform charges paid" value={w ? formatINR(w.totalCharges) : '—'} />
        <Stat label="Direct" value={w ? formatINR(w.directIncome) : '—'} tone="sky" />
        <Stat label="Generation 1" value={w ? formatINR(w.gen1Income) : '—'} tone="sky" />
        <Stat label="Generation 2" value={w ? formatINR(w.gen2Income) : '—'} tone="sky" />
        <Stat label="Generation 3" value={w ? formatINR(w.gen3Income) : '—'} tone="sky" />
      </div>
      <Card padded={false}>
        <div className="px-4 pt-2">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'commissions', label: 'Commission breakdown' }, { value: 'ledger', label: 'Wallet transactions' }]} />
        </div>
        {tab === 'commissions' ? (
          <>
            <FilterBar>
              <Field label="Type">
                <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option value="">All</option>
                  <option value="0">Direct</option>
                  <option value="1">Generation 1</option>
                  <option value="2">Generation 2</option>
                  <option value="3">Generation 3</option>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  <option value="credited">Credited</option>
                  <option value="pending">Pending</option>
                  <option value="skipped">Skipped (not eligible)</option>
                </Select>
              </Field>
            </FilterBar>
            <Table rows={commissions.data?.items} columns={commissionColumns()} empty="No commissions yet" />
            {commissions.data && <Pagination page={commissions.page} pageSize={commissions.pageSize} total={commissions.data.total} onPage={commissions.setPage} />}
          </>
        ) : (
          <>
            <FilterBar>
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">All</option>
                  {Object.entries(LEDGER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </FilterBar>
            <Table rows={ledger.data?.items} columns={ledgerColumns()} empty="No wallet transactions yet" />
            {ledger.data && <Pagination page={ledger.page} pageSize={ledger.pageSize} total={ledger.data.total} onPage={ledger.setPage} />}
          </>
        )}
      </Card>
    </>
  );
}

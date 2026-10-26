import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, Field, FilterBar, Input, PageHeader, Pagination, Select, Spinner, Table, Tabs, Textarea, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import { useDebounced, usePaged } from '../../lib/hooks';
import { formatDateTime, humanize, scheduleText, WEEKDAYS } from '../../lib/format';

interface Settings {
  withdrawal: { mode: 'weekly' | 'monthly'; weeklyDay: number; monthlyDay: number; windowDays: number; minAmount: number; chargeBps: number; processingEnabled: boolean; manualPayoutConfirmation: boolean };
  upgrade: { windowDays: number; commissionable: boolean; commissionBaseBps: number };
  commission: { holdDays: number; directRequiresActivePackage: boolean; maxGenerations: number };
  registration: { referralRequired: boolean };
}

function useSave(key: keyof Settings) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: unknown) => api.put(`/admin/settings/${key}`, value),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-settings'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

function SaveRow({ m }: { m: ReturnType<typeof useSave> }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <Button type="submit" loading={m.isPending}>Save</Button>
      {m.isSuccess && <span className="text-sm text-emerald-600">Saved · recorded in audit log</span>}
      {m.error && <span className="text-sm text-rose-600">{(m.error as Error).message}</span>}
    </div>
  );
}

export function AdminSettings() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<Settings>('/admin/settings') });
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (data) setS(structuredClone(data)); }, [data]);
  const saveW = useSave('withdrawal');
  const saveU = useSave('upgrade');
  const saveC = useSave('commission');
  const saveR = useSave('registration');
  if (isLoading || !s) return <Spinner />;
  const w = s.withdrawal;
  const setW = (patch: Partial<Settings['withdrawal']>) => setS({ ...s, withdrawal: { ...w, ...patch } });

  return (
    <>
      <PageHeader title="Settings" subtitle="All schedule and charge changes are recorded in audit logs." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Withdrawal schedule & platform charge" className="lg:row-span-2">
          <form onSubmit={(e) => { e.preventDefault(); saveW.mutate(w); }} className="space-y-4">
            <Field label="Withdrawal schedule">
              <div className="grid grid-cols-2 gap-2">
                {(['weekly', 'monthly'] as const).map((m) => (
                  <button type="button" key={m} onClick={() => setW({ mode: m })}
                    className={`rounded-lg border p-3 text-sm font-medium ${w.mode === m ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-300'}`}>
                    {m === 'weekly' ? 'Weekly withdrawal' : 'Monthly withdrawal'}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {w.mode === 'weekly' ? (
                <Field label="Weekly processing day">
                  <Select value={w.weeklyDay} onChange={(e) => setW({ weeklyDay: Number(e.target.value) })}>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </Select>
                </Field>
              ) : (
                <Field label="Monthly processing date" hint="1–28 so it exists in every month">
                  <Input type="number" min={1} max={28} value={w.monthlyDay} onChange={(e) => setW({ monthlyDay: Number(e.target.value) })} />
                </Field>
              )}
              <Field label="Request submission window (days)" hint="How many days requests stay open from the start day">
                <Input type="number" min={1} max={28} value={w.windowDays} onChange={(e) => setW({ windowDays: Number(e.target.value) })} />
              </Field>
              <Field label="Minimum withdrawal (₹, gross)"><Input type="number" min={0} value={w.minAmount} onChange={(e) => setW({ minAmount: Number(e.target.value) })} /></Field>
              <Field label="Platform charge (%)" hint="Default 5%"><Input type="number" step="0.01" min={0} max={50} value={w.chargeBps / 100} onChange={(e) => setW({ chargeBps: Math.round(Number(e.target.value) * 100) })} /></Field>
            </div>
            <Toggle checked={w.processingEnabled} onChange={(v) => setW({ processingEnabled: v })} label="Withdrawal processing enabled" />
            <Toggle checked={w.manualPayoutConfirmation} onChange={(v) => setW({ manualPayoutConfirmation: v })} label="Manual payout confirmation (admin records payment reference)" />
            <Alert tone="sky">Users will see: <b>{scheduleText(w)}</b></Alert>
            <SaveRow m={saveW} />
          </form>
        </Card>
        <Card title="Package upgrades">
          <form onSubmit={(e) => { e.preventDefault(); saveU.mutate(s.upgrade); }} className="space-y-4">
            <Field label="Upgrade eligibility period (days after activation)" hint="0 = no deadline">
              <Input type="number" min={0} value={s.upgrade.windowDays} onChange={(e) => setS({ ...s, upgrade: { ...s.upgrade, windowDays: Number(e.target.value) } })} />
            </Field>
            <Toggle checked={s.upgrade.commissionable} onChange={(v) => setS({ ...s, upgrade: { ...s.upgrade, commissionable: v } })} label="Upgrade payments are commissionable" />
            {s.upgrade.commissionable && (
              <Field label="Commission base (% of the price difference)">
                <Input type="number" step="0.01" min={0} max={100} value={s.upgrade.commissionBaseBps / 100} onChange={(e) => setS({ ...s, upgrade: { ...s.upgrade, commissionBaseBps: Math.round(Number(e.target.value) * 100) } })} />
              </Field>
            )}
            <SaveRow m={saveU} />
          </form>
        </Card>
        <Card title="Commission processing">
          <form onSubmit={(e) => { e.preventDefault(); saveC.mutate(s.commission); }} className="space-y-4">
            <Field label="Pending hold period (days)" hint="0 = credit to wallet immediately after verified payment">
              <Input type="number" min={0} value={s.commission.holdDays} onChange={(e) => setS({ ...s, commission: { ...s.commission, holdDays: Number(e.target.value) } })} />
            </Field>
            <Field label="Generations calculated (maximum depth)" hint="Generations above the direct referrer. Each beneficiary still needs a package eligible for that generation.">
              <Input type="number" min={1} max={50} value={s.commission.maxGenerations ?? 3} onChange={(e) => setS({ ...s, commission: { ...s.commission, maxGenerations: Number(e.target.value) } })} />
            </Field>
            <Toggle checked={s.commission.directRequiresActivePackage} onChange={(v) => setS({ ...s, commission: { ...s.commission, directRequiresActivePackage: v } })} label="Direct referrer must have an active package" />
            <SaveRow m={saveC} />
          </form>
        </Card>
        <Card title="Registration">
          <form onSubmit={(e) => { e.preventDefault(); saveR.mutate(s.registration); }}>
            <Toggle checked={s.registration.referralRequired} onChange={(v) => setS({ ...s, registration: { referralRequired: v } })} label="Referral code is mandatory" />
            <p className="mt-2 text-xs text-slate-500">Members without a sponsor can join with the admin referral code shown on the dashboard.</p>
            <SaveRow m={saveR} />
          </form>
        </Card>
      </div>
    </>
  );
}

export function AdminAnnouncements() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const list = useQuery({ queryKey: ['announcements'], queryFn: () => api.get<{ id: string; title: string; body: string; createdAt: string }[]>('/admin/announcements') });
  const send = useMutation({
    mutationFn: () => api.post('/admin/announcements', { title, body }),
    onSuccess: () => { setTitle(''); setBody(''); qc.invalidateQueries({ queryKey: ['announcements'] }); },
  });
  return (
    <>
      <PageHeader title="Announcements" subtitle="Broadcast an in-app notification to all active users." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="New announcement">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} /></Field>
            <Field label="Message"><Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} required minLength={3} /></Field>
            {send.error && <Alert>{(send.error as Error).message}</Alert>}
            {send.isSuccess && <Alert tone="green">Announcement sent.</Alert>}
            <Button type="submit" loading={send.isPending}>Send to all users</Button>
          </form>
        </Card>
        <Card title="Sent" padded={false}>
          <ul className="divide-y divide-slate-100">
            {list.data?.map((a) => (
              <li key={a.id} className="px-5 py-3">
                <p className="text-sm font-medium">{a.title}</p>
                <p className="text-sm text-slate-600">{a.body}</p>
                <p className="text-xs text-slate-400">{formatDateTime(a.createdAt)}</p>
              </li>
            ))}
            {list.data?.length === 0 && <li className="p-5 text-sm text-slate-500">No announcements yet.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}

interface FraudAlert { id: string; type: string; severity: string; details: Record<string, unknown> | null; createdAt: string; resolvedAt: string | null; purchaseId: string | null; user: { id: string; userCode: string; fullName: string } | null }

export function AdminFraud() {
  const qc = useQueryClient();
  const [resolved, setResolved] = useState<'false' | 'true'>('false');
  const list = usePaged<FraudAlert>('fraud', '/admin/fraud-alerts', { resolved });
  const resolve = useMutation({ mutationFn: (id: string) => api.post(`/admin/fraud-alerts/${id}/resolve`), onSuccess: () => qc.invalidateQueries({ queryKey: ['fraud'] }) });
  return (
    <>
      <PageHeader title="Fraud monitoring" subtitle="Registration bursts, duplicate commission attempts, duplicate payments and amount mismatches." />
      <Card padded={false}>
        <div className="px-4 pt-2"><Tabs value={resolved} onChange={setResolved} tabs={[{ value: 'false', label: 'Open' }, { value: 'true', label: 'Resolved' }]} /></div>
        <Table rows={list.data?.items} empty="No alerts" columns={[
          { key: 'd', header: 'Detected', render: (a) => formatDateTime(a.createdAt) },
          { key: 't', header: 'Type', render: (a) => humanize(a.type) },
          { key: 's', header: 'Severity', render: (a) => <Badge tone={a.severity === 'high' ? 'rose' : a.severity === 'medium' ? 'amber' : 'slate'}>{a.severity}</Badge> },
          { key: 'u', header: 'User', render: (a) => (a.user ? <Link to={`/admin/users/${a.user.id}`} className="text-brand-600">{a.user.fullName} ({a.user.userCode})</Link> : '—') },
          { key: 'x', header: 'Details', render: (a) => <code className="block max-w-xs truncate text-xs text-slate-500" title={JSON.stringify(a.details)}>{JSON.stringify(a.details)}</code> },
          { key: 'r', header: '', render: (a) => (a.resolvedAt ? <span className="text-xs text-slate-500">Resolved {formatDateTime(a.resolvedAt)}</span> : <Button size="sm" variant="secondary" loading={resolve.isPending && resolve.variables === a.id} onClick={() => resolve.mutate(a.id)}>Resolve</Button>) },
        ]} />
        {list.data && <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
    </>
  );
}

interface AuditLog { id: number; action: string; entity: string | null; entityId: string | null; before: unknown; after: unknown; ip: string | null; createdAt: string; actor: { userCode: string; fullName: string } | null }

export function AdminAudit() {
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const list = usePaged<AuditLog>('audit', '/admin/audit-logs', { action, search: useDebounced(search) }, 50);
  return (
    <>
      <PageHeader title="Audit logs" subtitle="Commission configuration, suspensions, withdrawal decisions, adjustments, admin logins and security events." />
      <Card padded={false}>
        <FilterBar>
          <Field label="Action">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All</option>
              {['settings', 'commission_rule', 'package', 'user', 'withdrawal', 'wallet', 'payment', 'security', 'export', 'course', 'announcement', 'fraud_alert'].map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
            </Select>
          </Field>
          <Field label="Actor"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="User ID or name" /></Field>
        </FilterBar>
        <Table rows={list.data?.items} columns={[
          { key: 'd', header: 'Time', render: (l) => formatDateTime(l.createdAt) },
          { key: 'a', header: 'Action', render: (l) => <span className="font-mono text-xs">{l.action}</span> },
          { key: 'actor', header: 'Actor', render: (l) => (l.actor ? `${l.actor.fullName} (${l.actor.userCode})` : 'system') },
          { key: 'e', header: 'Entity', render: (l) => <span className="text-xs">{l.entity} {l.entityId?.slice(0, 8)}</span> },
          { key: 'ip', header: 'IP', render: (l) => <span className="text-xs">{l.ip ?? '—'}</span> },
          {
            key: 'x', header: 'Change', render: (l) =>
              l.before || l.after ? (
                <div>
                  <button className="text-xs font-medium text-brand-600" onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? 'Hide' : 'View'}</button>
                  {open === l.id && (
                    <div className="mt-2 grid max-w-xl gap-2 whitespace-pre-wrap text-[11px] md:grid-cols-2">
                      <pre className="overflow-auto rounded bg-rose-50 p-2">{JSON.stringify(l.before, null, 2)}</pre>
                      <pre className="overflow-auto rounded bg-emerald-50 p-2">{JSON.stringify(l.after, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ) : '—',
          },
        ]} />
        {list.data && <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
    </>
  );
}

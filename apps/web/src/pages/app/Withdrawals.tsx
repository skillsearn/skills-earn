import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Info } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Input, KV, Modal, PageHeader, Pagination, Select, StatusBadge, Table, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDebounced, usePaged } from '../../lib/hooks';
import { formatDateTime, formatINR, pct, scheduleText } from '../../lib/format';
import type { PayoutDetails, Withdrawal } from '../../lib/types';

interface Quote {
  gross: number;
  chargeBps: number;
  charge: number;
  net: number;
  available: number;
  minAmount: number;
  schedule: { mode: 'weekly' | 'monthly'; weeklyDay: number; monthlyDay: number; windowDays: number };
  windowOpen: boolean;
  nextWindowStart: string;
  canRequest: boolean;
  problems: string[];
}

export function Breakdown({ gross, chargeBps, charge, net }: { gross: number | string; chargeBps: number; charge: number | string; net: number | string }) {
  return (
    <KV
      items={[
        ['Gross withdrawal', formatINR(gross)],
        [`Platform charge (${pct(chargeBps)})`, <span className="text-rose-600">− {formatINR(charge)}</span>],
        ['Net amount payable', <span className="text-lg text-emerald-700">{formatINR(net)}</span>],
      ]}
    />
  );
}

export default function Withdrawals() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'upi' | 'bank'>('upi');
  const [details, setDetails] = useState<PayoutDetails>({});
  const [save, setSave] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [success, setSuccess] = useState('');
  const debounced = useDebounced(amount);

  useEffect(() => {
    if (me?.payoutDetails) {
      const { upiQrPath: _qr, ...editable } = me.payoutDetails;
      setDetails(editable);
      if (!me.payoutDetails.upiId && me.payoutDetails.accountNumber) setMethod('bank');
    }
  }, [me?.payoutDetails]);

  const quote = useQuery({
    queryKey: ['quote', debounced],
    queryFn: () => api.get<Quote>(`/me/withdrawals/quote?amount=${Number(debounced) || 0}`),
  });
  const history = usePaged<Withdrawal>('withdrawals', '/me/withdrawals', {});

  const submit = useMutation({
    mutationFn: () => api.post('/me/withdrawals', { amount: Number(amount), method, details, saveDetails: save }),
    onSuccess: () => {
      setConfirm(false);
      setSuccess('Withdrawal request submitted. You can track its status below.');
      setAmount('');
      qc.invalidateQueries();
    },
  });

  const q = quote.data;
  const set = (k: keyof PayoutDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDetails((d) => ({ ...d, [k]: k === 'ifsc' ? e.target.value.toUpperCase() : e.target.value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccess('');
    submit.reset();
    setConfirm(true);
  }

  return (
    <>
      <PageHeader title="Withdrawals" subtitle="Request payouts to your bank account or UPI." />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {success && <Alert tone="green">{success}</Alert>}
          <Card title="New withdrawal request">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Withdrawal amount (gross)" hint={q ? `Available ${formatINR(q.available)} · minimum ${formatINR(q.minAmount, true)}` : undefined}>
                  <Input type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1000" required />
                </Field>
                <Field label="Payout method">
                  <Select value={method} onChange={(e) => setMethod(e.target.value as 'upi' | 'bank')}>
                    <option value="upi">UPI</option>
                    <option value="bank">Bank transfer</option>
                  </Select>
                </Field>
              </div>
              {method === 'upi' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="UPI ID"><Input value={details.upiId ?? ''} onChange={set('upiId')} placeholder="name@bank" required /></Field>
                  <Field label="Account holder name"><Input value={details.accountName ?? ''} onChange={set('accountName')} /></Field>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Account holder name"><Input value={details.accountName ?? ''} onChange={set('accountName')} required /></Field>
                  <Field label="Account number"><Input value={details.accountNumber ?? ''} onChange={set('accountNumber')} inputMode="numeric" required /></Field>
                  <Field label="IFSC"><Input value={details.ifsc ?? ''} onChange={set('ifsc')} placeholder="SBIN0001234" required /></Field>
                  <Field label="Bank name"><Input value={details.bankName ?? ''} onChange={set('bankName')} /></Field>
                </div>
              )}
              <Toggle checked={save} onChange={setSave} label="Save these payout details to my profile" />

              {q && Number(amount) > 0 && (
                <div className="rounded-lg bg-slate-50 p-4">
                  <Breakdown gross={q.gross} chargeBps={q.chargeBps} charge={q.charge} net={q.net} />
                </div>
              )}
              {q && q.problems.length > 0 && Number(amount) > 0 && (
                <Alert tone="amber">
                  <ul className="list-inside list-disc">{q.problems.map((p) => <li key={p}>{p}</li>)}</ul>
                </Alert>
              )}
              <Button type="submit" disabled={!q?.canRequest} className="w-full sm:w-auto">Review request</Button>
            </form>
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <Card title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-brand-600" /> Withdrawal schedule</span>}>
            {q && (
              <KV
                items={[
                  ['Schedule', scheduleText(q.schedule)],
                  ['Status', q.windowOpen ? <span className="text-emerald-600">Open now</span> : <span className="text-amber-600">Closed · next {q.nextWindowStart}</span>],
                  ['Minimum amount', formatINR(q.minAmount, true)],
                  ['Platform charge', `${pct(q.chargeBps)} of gross`],
                ]}
              />
            )}
          </Card>
          <Card title={<span className="flex items-center gap-2"><Info className="h-4 w-4 text-slate-500" /> How the charge works</span>}>
            <p className="text-sm text-slate-600">
              Commissions are credited in full. A {q ? pct(q.chargeBps) : '5%'} platform charge is deducted only when a withdrawal is paid. Example: request ₹1,000 → charge ₹50 → you receive ₹950.
              If a payout fails or is rejected, the full amount returns to your wallet.
            </p>
          </Card>
        </div>
      </div>

      <Card title="Withdrawal history" padded={false} className="mt-6">
        <Table
          rows={history.data?.items}
          empty="No withdrawal requests yet"
          columns={[
            { key: 'date', header: 'Requested', render: (w) => formatDateTime(w.requestedAt) },
            { key: 'gross', header: 'Gross', className: 'text-right', render: (w) => formatINR(w.grossAmount) },
            { key: 'charge', header: 'Charge', className: 'text-right', render: (w) => <span className="text-rose-600">{formatINR(w.chargeAmount)}</span> },
            { key: 'net', header: 'Net payable', className: 'text-right', render: (w) => <b>{formatINR(w.netAmount)}</b> },
            { key: 'method', header: 'Method', render: (w) => (w.method === 'upi' ? `UPI · ${w.payoutDetails.upiId}` : `Bank · ****${w.payoutDetails.accountNumber?.slice(-4)}`) },
            { key: 'status', header: 'Status', render: (w) => <StatusBadge status={w.status} /> },
            { key: 'ref', header: 'Reference / note', render: (w) => <span className="text-xs text-slate-500">{w.paymentReference ?? w.adminNote ?? '—'}</span> },
          ]}
        />
        {history.data && <Pagination page={history.page} pageSize={history.pageSize} total={history.data.total} onPage={history.setPage} />}
      </Card>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Confirm withdrawal"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button loading={submit.isPending} onClick={() => submit.mutate()}>Confirm request</Button>
          </>
        }
      >
        {q && <Breakdown gross={q.gross} chargeBps={q.chargeBps} charge={q.charge} net={q.net} />}
        <p className="mt-3 text-sm text-slate-600">
          Payout to: <b>{method === 'upi' ? details.upiId : `${details.accountName} · ${details.accountNumber} · ${details.ifsc}`}</b>
        </p>
        <p className="mt-2 text-xs text-slate-500">The gross amount is held from your wallet until the request is paid, rejected or fails.</p>
        {submit.error && <div className="mt-3"><Alert>{(submit.error as Error).message}</Alert></div>}
      </Modal>
    </>
  );
}

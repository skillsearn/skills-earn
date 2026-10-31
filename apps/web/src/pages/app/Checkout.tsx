import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, CreditCard, FlaskConical, ImagePlus, QrCode, ShieldCheck, Smartphone } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, CopyButton, Field, Input, KV, PageHeader, Spinner, Tabs, Textarea } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, formatINR } from '../../lib/format';
import { imageToDataUrl } from '../../lib/image';
import { openRazorpay } from '../../lib/razorpay';
import type { CheckoutPayload, ManualPaymentInfo } from '../../lib/types';

/** Shared pay button used by checkout + upgrade. */
export function usePay(onDone: () => void) {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: async (payload: CheckoutPayload) => {
      setError('');
      if (payload.provider === 'mock') {
        return api.post(`/payments/mock/${payload.purchaseId}/confirm`);
      }
      const r = await openRazorpay(payload);
      return api.post('/payments/verify', {
        purchaseId: payload.purchaseId,
        razorpayOrderId: r.razorpay_order_id,
        razorpayPaymentId: r.razorpay_payment_id,
        razorpaySignature: r.razorpay_signature,
      });
    },
    onSuccess: async () => {
      await refresh();
      await qc.invalidateQueries();
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  return { pay: mutation.mutate, paying: mutation.isPending, error };
}

export default function Checkout() {
  const { purchaseId } = useParams();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [method, setMethod] = useState<'online' | 'manual' | ''>('');
  const [reupload, setReupload] = useState(false);
  const checkout = useQuery({
    queryKey: ['checkout', purchaseId],
    queryFn: () => api.post<CheckoutPayload>('/payments/checkout', { purchaseId }),
    retry: false,
  });
  const { pay, paying, error } = usePay(() => setDone(true));

  if (done) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-bold">Payment verified!</h1>
        <p className="mt-2 text-slate-600">Your {checkout.data?.packageName} package is now active.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={() => navigate('/app')}>Go to dashboard</Button>
          <Button variant="secondary" onClick={() => navigate('/app/courses')}>Start learning</Button>
        </div>
      </div>
    );
  }

  const c = checkout.data;
  const onlineAvailable = c && c.provider !== 'manual';
  const active = method || (onlineAvailable ? 'online' : 'manual');
  const underReview = c?.proof && c.status === 'pending' && !reupload;

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Complete your payment" subtitle="Pay online or by UPI / bank transfer. Your package is activated once the payment is verified." />
      {checkout.isLoading && <Spinner />}
      {checkout.error && (
        <Alert>
          {(checkout.error as Error).message} <Link to="/app" className="font-medium underline">Back to dashboard</Link>
        </Alert>
      )}
      {c && (
        <Card>
          <KV
            items={[
              ['Package', c.packageName],
              ['Type', c.type === 'upgrade' ? 'Upgrade (price difference)' : 'New purchase'],
              ['Amount payable', <span className="text-lg">{formatINR(c.amount)}</span>],
            ]}
          />

          {underReview ? (
            <div className="mt-5 space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-center">
              <Clock className="mx-auto h-10 w-10 text-sky-600" />
              <p className="font-semibold text-slate-900">Payment screenshot submitted</p>
              <p className="text-sm text-slate-600">
                UTR <span className="font-mono">{c.proof!.utr}</span> · {formatDateTime(c.proof!.submittedAt)}.<br />
                Admin will verify it and activate your package. You will get a notification.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <Button variant="secondary" onClick={() => navigate('/app')}>Go to dashboard</Button>
                <Button variant="secondary" onClick={() => { setReupload(true); setMethod('manual'); }}>Upload a different screenshot</Button>
              </div>
            </div>
          ) : (
            <>
              {c.status === 'failed' && c.proof && <div className="mt-4"><Alert tone="amber">Your previous screenshot could not be verified. Please pay again or upload a correct screenshot.</Alert></div>}
              {onlineAvailable && c.manual && (
                <div className="mt-4">
                  <Tabs value={active} onChange={setMethod} tabs={[
                    { value: 'online', label: <span className="flex items-center gap-1.5"><CreditCard className="h-4 w-4" /> Pay online</span> },
                    { value: 'manual', label: <span className="flex items-center gap-1.5"><QrCode className="h-4 w-4" /> UPI / Bank transfer</span> },
                  ]} />
                </div>
              )}

              {active === 'online' && onlineAvailable && (
                <>
                  {error && <div className="mt-4"><Alert>{error}</Alert></div>}
                  {c.provider === 'mock' && (
                    <div className="mt-4">
                      <Alert tone="amber">
                        <span className="flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Development mode: payments are simulated (PAYMENT_PROVIDER=mock).</span>
                      </Alert>
                    </div>
                  )}
                  <Button size="lg" className="mt-6 w-full" loading={paying} onClick={() => pay(c)}>
                    <CreditCard className="h-5 w-5" />
                    {c.provider === 'mock' ? 'Simulate successful payment' : `Pay ${formatINR(c.amount)}`}
                  </Button>
                  <p className="mt-3 flex items-center justify-center gap-1 text-xs text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5" /> Secured by Razorpay · UPI, cards, net banking · instant activation
                  </p>
                </>
              )}

              {active === 'manual' && c.manual && (
                <ManualPayment purchaseId={c.purchaseId} amount={c.amount} packageName={c.packageName} info={c.manual}
                  onSubmitted={() => { setReupload(false); checkout.refetch(); }} />
              )}
              {active === 'manual' && !c.manual && <div className="mt-4"><Alert tone="amber">Manual payment is not available right now. Please pay online.</Alert></div>}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function ManualPayment({ purchaseId, amount, packageName, info, onSubmitted }: { purchaseId: string; amount: number; packageName: string; info: ManualPaymentInfo; onSubmitted: () => void }) {
  const qc = useQueryClient();
  const [image, setImage] = useState('');
  const [fileErr, setFileErr] = useState('');
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const submit = useMutation({
    mutationFn: () => api.post(`/payments/${purchaseId}/manual-proof`, { image, utr: utr.trim(), note: note.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me-purchases'] }); onSubmitted(); },
  });
  const upiLink = info.upiId
    ? `upi://pay?${new URLSearchParams({ pa: info.upiId, pn: info.payeeName || 'SKILLSEARN', am: amount.toFixed(2), cu: 'INR', tn: `${packageName} package` }).toString()}`
    : '';
  const hasBank = !!(info.accountNumber && info.ifsc);

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-xl border border-slate-200 p-4">
        <p className="text-sm font-semibold text-slate-900">Step 1 · Pay {formatINR(amount)}</p>
        {info.qrUrl && (
          <div className="mt-3 flex justify-center">
            <img src={info.qrUrl} alt="UPI QR code" className="h-56 w-56 rounded-lg border border-slate-200 object-contain" />
          </div>
        )}
        {info.upiId && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs text-slate-500">UPI ID{info.payeeName ? ` · ${info.payeeName}` : ''}</p>
              <p className="truncate font-mono text-sm font-semibold">{info.upiId}</p>
            </div>
            <CopyButton text={info.upiId} />
          </div>
        )}
        {upiLink && (
          <a href={upiLink} className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white sm:hidden">
            <Smartphone className="h-4 w-4" /> Open UPI app (GPay / PhonePe / Paytm)
          </a>
        )}
        {hasBank && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Or bank transfer (IMPS / NEFT)</p>
            <KV items={[
              ['Account name', info.accountName || '—'],
              ['Account number', <span className="flex items-center justify-end gap-2 font-mono">{info.accountNumber} <CopyButton text={info.accountNumber!} label="" /></span>],
              ['IFSC', <span className="flex items-center justify-end gap-2 font-mono">{info.ifsc} <CopyButton text={info.ifsc!} label="" /></span>],
              ['Bank', info.bankName || '—'],
            ]} />
          </div>
        )}
        {!info.qrUrl && !info.upiId && !hasBank && <Alert tone="amber">Payment details are not set up yet. Please contact support.</Alert>}
        {info.instructions && <p className="mt-3 whitespace-pre-line text-xs text-slate-600">{info.instructions}</p>}
      </div>

      <form
        className="space-y-4 rounded-xl border border-slate-200 p-4"
        onSubmit={(e: FormEvent) => { e.preventDefault(); submit.mutate(); }}
      >
        <p className="text-sm font-semibold text-slate-900">Step 2 · Upload payment screenshot</p>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 p-4 text-center text-sm text-slate-600 hover:border-brand-400">
          {image ? <img src={image} alt="Payment screenshot" className="max-h-64 rounded object-contain" /> : <ImagePlus className="h-8 w-8 text-slate-400" />}
          <span className="font-medium text-brand-700">{image ? 'Change screenshot' : 'Choose screenshot'}</span>
          <span className="text-xs text-slate-500">PNG / JPG · must show amount, UTR and date</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setFileErr('');
            try { setImage(await imageToDataUrl(f)); } catch (err) { setFileErr((err as Error).message); }
          }} />
        </label>
        {fileErr && <Alert>{fileErr}</Alert>}
        <Field label="UTR / Transaction ID" hint="12-digit UPI reference number or bank UTR from your payment app">
          <Input value={utr} onChange={(e) => setUtr(e.target.value.replace(/\s/g, ''))} placeholder="e.g. 431234567890" required minLength={6} maxLength={40} />
        </Field>
        <Field label="Note (optional)"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid from father's account" /></Field>
        {submit.error && <Alert>{(submit.error as Error).message}</Alert>}
        <Button type="submit" size="lg" className="w-full" disabled={!image || utr.trim().length < 6} loading={submit.isPending}>Submit for verification</Button>
        <p className="text-center text-xs text-slate-500">Your package is activated after the admin verifies the payment (usually within a few hours).</p>
      </form>
    </div>
  );
}

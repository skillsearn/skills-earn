import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, FlaskConical, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, KV, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatINR } from '../../lib/format';
import { openRazorpay } from '../../lib/razorpay';
import type { CheckoutPayload } from '../../lib/types';

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

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Complete your payment" subtitle="Your package is activated as soon as the payment is verified." />
      {checkout.isLoading && <Spinner />}
      {checkout.error && (
        <Alert>
          {(checkout.error as Error).message} <Link to="/app" className="font-medium underline">Back to dashboard</Link>
        </Alert>
      )}
      {checkout.data && (
        <Card>
          <KV
            items={[
              ['Package', checkout.data.packageName],
              ['Type', checkout.data.type === 'upgrade' ? 'Upgrade (price difference)' : 'New purchase'],
              ['Amount payable', <span className="text-lg">{formatINR(checkout.data.amount)}</span>],
            ]}
          />
          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          {checkout.data.provider === 'mock' && (
            <div className="mt-4">
              <Alert tone="amber">
                <span className="flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Development mode: payments are simulated (PAYMENT_PROVIDER=mock).</span>
              </Alert>
            </div>
          )}
          <Button size="lg" className="mt-6 w-full" loading={paying} onClick={() => pay(checkout.data!)}>
            <CreditCard className="h-5 w-5" />
            {checkout.data.provider === 'mock' ? 'Simulate successful payment' : `Pay ${formatINR(checkout.data.amount)}`}
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" /> Secured by Razorpay · UPI, cards, net banking
          </p>
        </Card>
      )}
    </div>
  );
}

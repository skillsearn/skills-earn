import type { CheckoutPayload } from './types';

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay'));
    document.body.appendChild(s);
  });
}

export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

/** Opens Razorpay Checkout; resolves with the signed response, rejects on dismiss/failure. */
export async function openRazorpay(p: CheckoutPayload): Promise<RazorpaySuccess> {
  await loadScript();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: p.keyId,
      order_id: p.orderId,
      amount: p.amountPaise,
      currency: p.currency ?? 'INR',
      name: 'SKILLSEARN',
      description: `${p.packageName} package${p.type === 'upgrade' ? ' upgrade' : ''}`,
      prefill: p.prefill,
      theme: { color: '#d4a017' },
      handler: (res: RazorpaySuccess) => resolve(res),
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
    });
    rzp.on('payment.failed', (r) => reject(new Error((r as { error?: { description?: string } }).error?.description ?? 'Payment failed')));
    rzp.open();
  });
}

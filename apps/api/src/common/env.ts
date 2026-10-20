const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export interface Env {
  NODE_ENV: string;
  PORT: number;
  WEB_ORIGIN: string;
  SITE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  PAYMENT_PROVIDER: 'razorpay' | 'mock';
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  /** RazorpayX banking account number; withdrawal payouts are enabled only when set. */
  RAZORPAYX_ACCOUNT_NUMBER?: string;
}

/** Validates process env at boot; the app refuses to start on bad config. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const missing = REQUIRED.filter((k) => !raw[k]);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

  const nodeEnv = String(raw.NODE_ENV ?? 'development');
  const provider = String(raw.PAYMENT_PROVIDER ?? 'mock');
  if (provider !== 'razorpay' && provider !== 'mock') {
    throw new Error('PAYMENT_PROVIDER must be "razorpay" or "mock"');
  }
  if (provider === 'mock' && nodeEnv === 'production') {
    throw new Error('PAYMENT_PROVIDER=mock is not allowed in production');
  }
  if (provider === 'razorpay' && (!raw.RAZORPAY_KEY_ID || !raw.RAZORPAY_KEY_SECRET)) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required for razorpay');
  }

  return {
    ...(raw as object),
    NODE_ENV: nodeEnv,
    PORT: Number(raw.PORT ?? 4000),
    WEB_ORIGIN: String(raw.WEB_ORIGIN ?? 'http://localhost:5173'),
    SITE_URL: String(raw.SITE_URL ?? raw.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, ''),
    PAYMENT_PROVIDER: provider,
  } as Env;
}

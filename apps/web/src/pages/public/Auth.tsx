import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Field, Input, PasswordInput, Spinner } from '../../components/ui';
import { Logo } from '../../components/layouts';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDebounced, usePublicSettings } from '../../lib/hooks';
import { formatINR } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import type { Package } from '../../lib/types';

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center lg:hidden">
          <Logo />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resetDone = (useLocation().state as { resetDone?: boolean } | null)?.resetDone;
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const me = await login(identifier, password);
      const next = params.get('next');
      const home = me.role === 'admin' ? '/admin' : '/app';
      // Never send the admin into the member area (or a member into the admin panel) from a stale ?next=.
      const ok = next && next.startsWith('/') && !next.startsWith('//') && (me.role === 'admin' ? !next.startsWith('/app') : !next.startsWith('/admin'));
      navigate(ok ? next : home, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle={<>New here? <Link className="font-medium text-brand-600" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {resetDone && !error && <Alert tone="green">Password updated. Log in with your new password.</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field label="User ID, email or mobile">
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="SE100001 / you@email.com / 98765 43210" required autoComplete="username" />
        </Field>
        <Field label="Password">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600">Forgot password?</Link>
        </div>
        <Button type="submit" loading={loading} className="w-full" size="lg">Log in</Button>
      </form>
    </AuthCard>
  );
}

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const packages = useQuery({ queryKey: ['packages'], queryFn: () => api.get<Package[]>('/packages') });
  const referralRequired = usePublicSettings().data?.registration.referralRequired ?? true;
  const [form, setForm] = useState({
    fullName: '', email: '', mobile: '', password: '', confirm: '', packageId: '',
    referralCode: params.get('ref') ?? '', acceptTerms: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.packageId && packages.data?.length) {
      const wanted = packages.data.find((p) => p.slug === params.get('package')) ?? packages.data[0];
      setForm((f) => ({ ...f, packageId: wanted.id }));
    }
  }, [packages.data, form.packageId, params]);

  const code = useDebounced(form.referralCode.trim().toUpperCase());
  const referrer = useQuery({
    queryKey: ['ref', code],
    queryFn: () => api.get<{ valid: boolean; name?: string; userCode?: string }>(`/referrals/validate/${encodeURIComponent(code)}`),
    enabled: code.length >= 6,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Passwords do not match');
    if (referralRequired && !form.referralCode.trim()) return setError('Referral code is required. Ask the person who invited you for their code.');
    if (form.referralCode && referrer.data && !referrer.data.valid) return setError('Referral code is not valid');
    setLoading(true);
    try {
      const { confirm: _c, ...body } = form;
      const res = await register({ ...body, referralCode: body.referralCode.trim() || undefined });
      navigate(`/app/checkout/${res.purchaseId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Create your account" subtitle={<>Already a member? <Link className="font-medium text-brand-600" to="/login">Log in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Full name"><Input value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} required minLength={2} autoComplete="name" /></Field>
        <Field label="Email address"><Input type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} required autoComplete="email" /></Field>
        <Field label="Mobile number"><Input type="tel" value={form.mobile} onChange={(e) => set('mobile')(e.target.value)} required placeholder="10-digit mobile" autoComplete="tel" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" hint="At least 8 characters"><PasswordInput value={form.password} onChange={(e) => set('password')(e.target.value)} required minLength={8} autoComplete="new-password" /></Field>
          <Field label="Confirm password"><PasswordInput value={form.confirm} onChange={(e) => set('confirm')(e.target.value)} required autoComplete="new-password" /></Field>
        </div>
        <Field label="Select package">
          {packages.isLoading ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {packages.data?.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => set('packageId')(p.id)}
                  className={`rounded-lg border p-3 text-left text-sm transition ${form.packageId === p.id ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-200' : 'border-slate-300 hover:border-slate-400'}`}
                >
                  <span className="block font-semibold">{p.name}</span>
                  <span className="text-xs text-slate-600">{formatINR(p.price, true)}</span>
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field
          label={referralRequired ? 'Referral code' : 'Referral code (optional)'}
          hint={
            code.length >= 6 && referrer.data ? (
              referrer.data.valid ? (
                <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Referred by {referrer.data.name} ({referrer.data.userCode})</span>
              ) : (
                <span className="flex items-center gap-1 text-rose-600"><XCircle className="h-3.5 w-3.5" /> Code not found</span>
              )
            ) : undefined
          }
        >
          <Input value={form.referralCode} onChange={(e) => set('referralCode')(e.target.value.toUpperCase())} placeholder="e.g. AB12CD34" required={referralRequired} />
        </Field>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" className="mt-0.5" checked={form.acceptTerms} onChange={(e) => set('acceptTerms')(e.target.checked)} required />
          <span>I agree to the <Link to="/terms" target="_blank" className="font-medium text-brand-600">Terms & Conditions</Link></span>
        </label>
        <Button type="submit" loading={loading} className="w-full" size="lg">Create account & continue to payment</Button>
      </form>
    </AuthCard>
  );
}

function OtpBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 4 }, (_, i) => value[i] ?? '');
  const set = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join('').slice(0, 4));
  };
  return (
    <div className="flex justify-center gap-3">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={4}
          aria-label={`Digit ${i + 1}`}
          className="h-14 w-14 rounded-xl border border-slate-300 text-center text-2xl font-bold outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (v.length > 1) {
              // Pasted or autofilled the whole code.
              onChange(v.slice(0, 4));
              refs.current[Math.min(v.length, 4) - 1]?.focus();
              return;
            }
            set(i, v);
            if (v && i < 3) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

export function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    setLoading(true);
    setError('');
    try {
      const r = await api.post<{ message: string }>('/auth/forgot-password', { identifier });
      setMsg(r.message);
      setStep('verify');
      setCooldown(60);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (otp.length !== 4) return setError('Enter the 4-digit code from your email');
    if (password !== confirm) return setError('Passwords do not match');
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { identifier, otp, password });
      navigate('/login', { replace: true, state: { resetDone: true } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (step === 'request') {
    return (
      <AuthCard title="Reset your password" subtitle="We'll email a 4-digit code to your registered address.">
        <form onSubmit={(e) => { e.preventDefault(); sendCode(); }} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="User ID, email or mobile"><Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></Field>
          <Button type="submit" loading={loading} className="w-full">Send code</Button>
          <p className="text-center text-sm"><Link to="/login" className="text-brand-600">Back to login</Link></p>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Enter code & new password" subtitle={msg}>
      <form onSubmit={reset} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <div>
          <span className="mb-2 block text-sm font-medium text-slate-700">4-digit code</span>
          <OtpBoxes value={otp} onChange={setOtp} />
          <p className="mt-2 text-center text-xs text-slate-500">
            Didn't get it?{' '}
            {cooldown > 0 ? (
              <span>Resend in {cooldown}s</span>
            ) : (
              <button type="button" className="font-medium text-brand-600" onClick={sendCode} disabled={loading}>Resend code</button>
            )}
          </p>
        </div>
        <Field label="New password" hint="At least 8 characters">
          <PasswordInput minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" error={confirm && confirm !== password ? 'Passwords do not match' : undefined}>
          <PasswordInput minLength={8} maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <Button type="submit" loading={loading} className="w-full">Reset password</Button>
        <p className="text-center text-sm">
          <button type="button" className="text-brand-600" onClick={() => { setStep('request'); setOtp(''); setError(''); }}>Use a different account</button>
        </p>
      </form>
    </AuthCard>
  );
}

export function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // supabase-js reads the recovery token from the URL and creates a session.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => s.session && setReady(true));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <AuthCard title="Choose a new password">
      {!ready ? (
        <Alert tone="amber">Open this page from the reset link in your email. Links expire after a short time.</Alert>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            const { error: err } = await supabase.auth.updateUser({ password });
            setLoading(false);
            if (err) return setError(err.message);
            await supabase.auth.signOut();
            navigate('/login', { replace: true });
          }}
          className="space-y-4"
        >
          {error && <Alert>{error}</Alert>}
          <Field label="New password" hint="At least 8 characters"><PasswordInput minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <Button type="submit" loading={loading} className="w-full">Update password</Button>
        </form>
      )}
    </AuthCard>
  );
}

export function Suspended() {
  const { logout } = useAuth();
  return (
    <AuthCard title="Account suspended">
      <p className="text-sm text-slate-600">Your account has been suspended by the administrator. Please contact support for help.</p>
      <Button variant="secondary" className="mt-6" onClick={() => logout()}>Log out</Button>
    </AuthCard>
  );
}

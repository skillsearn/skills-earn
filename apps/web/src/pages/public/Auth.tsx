import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Field, Input, Spinner } from '../../components/ui';
import { Logo } from '../../components/layouts';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDebounced } from '../../lib/hooks';
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
      navigate(next && next.startsWith('/') ? next : me.role === 'admin' ? '/admin' : '/app', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle={<>New here? <Link className="font-medium text-brand-600" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="User ID, email or mobile">
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="SE100001 / you@email.com / 98765 43210" required autoComplete="username" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
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
          <Field label="Password" hint="At least 8 characters"><Input type="password" value={form.password} onChange={(e) => set('password')(e.target.value)} required minLength={8} autoComplete="new-password" /></Field>
          <Field label="Confirm password"><Input type="password" value={form.confirm} onChange={(e) => set('confirm')(e.target.value)} required autoComplete="new-password" /></Field>
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
          label="Referral code (optional)"
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
          <Input value={form.referralCode} onChange={(e) => set('referralCode')(e.target.value.toUpperCase())} placeholder="e.g. AB12CD34" />
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

export function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  return (
    <AuthCard title="Reset your password" subtitle="We'll email a reset link to your registered address.">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          setError('');
          try {
            const r = await api.post<{ message: string }>('/auth/forgot-password', { identifier });
            setMsg(r.message);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setLoading(false);
          }
        }}
        className="space-y-4"
      >
        {msg && <Alert tone="green">{msg}</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field label="User ID, email or mobile"><Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></Field>
        <Button type="submit" loading={loading} className="w-full">Send reset link</Button>
        <p className="text-center text-sm"><Link to="/login" className="text-brand-600">Back to login</Link></p>
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
          <Field label="New password" hint="At least 8 characters"><Input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
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

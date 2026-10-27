const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const formatINR = (v: number | string | null | undefined, whole = false) => {
  const n = Number(v ?? 0);
  return whole && Number.isInteger(n) ? inr0.format(n) : inr.format(n);
};

export const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

const tz = { timeZone: 'Asia/Kolkata' } as const;
export const formatDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-IN', { ...tz, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const formatDateTime = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { ...tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Direct (L0) · Generation income (G1–G3, uses D, package-gated) · Turnover income (G4+, any active package). */
export const levelLabel = (level: number) => (level === 0 ? 'Direct' : level <= 3 ? `Generation ${level}` : `Turnover · Gen ${level}`);

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function scheduleText(s: { mode: 'weekly' | 'monthly'; weeklyDay: number; monthlyDay: number; windowDays: number }) {
  if (s.mode === 'weekly') {
    const start = WEEKDAYS[s.weeklyDay];
    if (s.windowDays <= 1) return `Weekly — every ${start}`;
    return `Weekly — ${start} to ${WEEKDAYS[(s.weeklyDay + s.windowDays - 1) % 7]}`;
  }
  if (s.windowDays <= 1) return `Monthly — on the ${ordinal(s.monthlyDay)}`;
  return `Monthly — ${ordinal(s.monthlyDay)} to ${ordinal(s.monthlyDay + s.windowDays - 1)}`;
}

export const LEDGER_TYPES: Record<string, string> = {
  direct_commission: 'Direct Commission Credit',
  generation_commission: 'Generation / Turnover Income Credit',
  withdrawal_hold: 'Withdrawal Hold',
  withdrawal_hold_release: 'Withdrawal Hold Release',
  successful_withdrawal: 'Successful Withdrawal',
  platform_charge: 'Platform Charge',
  failed_withdrawal_release: 'Failed Withdrawal Release',
  admin_adjustment: 'Authorized Admin Adjustment',
};

export const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const packageColor = (level?: number | null) =>
  level === 1 ? 'from-amber-400 to-amber-600' : level === 2 ? 'from-slate-400 to-slate-600' : level === 3 ? 'from-neutral-700 via-neutral-900 to-ink' : 'from-slate-300 to-slate-400';

export const whatsappShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Deep snake_case → camelCase for API responses. */
export function toCamel<T = any>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => toCamel(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = toCamel(v);
    }
    return out as T;
  }
  return value as T;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageRange(page?: number | string, pageSize?: number | string) {
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
  return { page: p, pageSize: size, from: (p - 1) * size, to: p * size - 1 };
}

/** Normalises Indian mobile numbers to +91XXXXXXXXXX. Returns null if invalid. */
export function normalizeMobile(input: string): string | null {
  const digits = (input ?? '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
    : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Escapes and joins rows into CSV (Excel-friendly, with BOM). */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // guard against CSV formula injection
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c.key])).join(','));
  return '﻿' + lines.join('\n');
}

// ───────────── IST helpers (Asia/Kolkata has no DST: UTC+05:30) ─────────────
const IST_OFFSET_MS = 330 * 60 * 1000;

/** A Date whose UTC fields read as IST wall-clock time. */
export function istWall(at: Date = new Date()): Date {
  return new Date(at.getTime() + IST_OFFSET_MS);
}

export interface WithdrawalSettings {
  mode: 'weekly' | 'monthly';
  weeklyDay: number; // 0 = Sunday
  monthlyDay: number; // 1..28
  windowDays: number;
  minAmount: number;
  chargeBps: number;
  processingEnabled: boolean;
  manualPayoutConfirmation: boolean;
}

/** Mirrors SQL withdrawal_window_open(). */
export function isWindowOpen(s: WithdrawalSettings, at: Date = new Date()): boolean {
  const w = istWall(at);
  const days = Math.max(1, s.windowDays || 1);
  if (s.mode === 'weekly') return (w.getUTCDay() - s.weeklyDay + 7) % 7 < days;
  const dom = w.getUTCDate();
  return dom >= s.monthlyDay && dom < s.monthlyDay + days;
}

/** Next window start as an ISO date (IST calendar day), or today if open now. */
export function nextWindowStart(s: WithdrawalSettings, at: Date = new Date()): string {
  for (let i = 0; i < 62; i++) {
    const probe = new Date(at.getTime() + i * 86_400_000);
    const w = istWall(probe);
    const isStart = s.mode === 'weekly' ? w.getUTCDay() === s.weeklyDay : w.getUTCDate() === s.monthlyDay;
    if ((i === 0 && isWindowOpen(s, probe)) || isStart) return w.toISOString().slice(0, 10);
  }
  return istWall(at).toISOString().slice(0, 10);
}

export function withdrawalQuote(gross: number, chargeBps: number) {
  const g = round2(gross);
  const charge = round2((g * chargeBps) / 10000);
  return { gross: g, chargeBps, charge, net: round2(g - charge) };
}

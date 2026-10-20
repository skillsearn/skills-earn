import { Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, Loader2, X } from 'lucide-react';
import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useEffect,
  useState,
} from 'react';
import { humanize } from '../lib/format';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const variants: Record<Variant, string> = {
  primary: 'btn-gold font-semibold',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-6 py-3 text-base' : 'px-4 py-2 text-sm',
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

const inputCls =
  // text-base below sm: iOS Safari zooms into any focused input under 16px.
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100';

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export function PasswordInput(p: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...p} type={show ? 'text' : 'password'} className={cx(inputCls, 'pr-10', p.className)} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-600"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, p.className)} />;

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1">
      <span className="text-sm text-slate-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}
      >
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-5.5' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4 sm:p-5' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, icon, tone = 'slate' }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'slate' | 'brand' | 'green' | 'amber' | 'rose' | 'sky' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600', brand: 'bg-brand-50 text-brand-600', green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600', sky: 'bg-sky-50 text-sky-600',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {icon && <span className={cx('rounded-lg p-1.5', tones[tone])}>{icon}</span>}
      </div>
      <p className="mt-2 break-words text-lg font-bold text-slate-900 tabular-nums sm:text-xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export function Badge({ tone = 'slate', children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', badgeTones[tone])}>{children}</span>;
}

const statusTone: Record<string, keyof typeof badgeTones> = {
  paid: 'green', credited: 'green', active: 'green', approved: 'sky', processed: 'green',
  pending: 'amber', requested: 'amber', under_review: 'amber', processing: 'sky',
  failed: 'rose', rejected: 'rose', suspended: 'rose', cancelled: 'slate', skipped: 'slate', not_applicable: 'slate',
};
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={statusTone[status] ?? 'slate'}>{humanize(status)}</Badge>;

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" /> {label ?? 'Loading…'}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Alert({ tone = 'rose', children }: { tone?: 'rose' | 'amber' | 'green' | 'sky'; children: ReactNode }) {
  const t = { rose: 'border-rose-200 bg-rose-50 text-rose-800', amber: 'border-amber-200 bg-amber-50 text-amber-800', green: 'border-emerald-200 bg-emerald-50 text-emerald-800', sky: 'border-sky-200 bg-sky-50 text-sky-800' };
  return <div className={cx('rounded-lg border px-4 py-3 text-sm', t[tone])}>{children}</div>;
}

export const ErrorBox = ({ error }: { error: unknown }) =>
  error ? <Alert>{error instanceof Error ? error.message : 'Something went wrong'}</Alert> : null;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ columns, rows, empty = 'Nothing here yet', onRowClick, rowKey }: { columns: Column<T>[]; rows: T[] | undefined; empty?: string; onRowClick?: (row: T) => void; rowKey?: (row: T, i: number) => string }) {
  if (!rows) return <Spinner />;
  if (!rows.length) return <Empty title={empty} />;
  const key = (r: T, i: number) => (rowKey ? rowKey(r, i) : String((r as { id?: string | number }).id ?? i));
  return (
    <>
    {/* Phones: one card per row, header as label. Columns without a header (actions) span the card. */}
    <ul className="divide-y divide-slate-100 md:hidden">
      {rows.map((r, i) => (
        <li key={key(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx('space-y-1.5 px-4 py-3 text-sm', onRowClick && 'cursor-pointer active:bg-slate-50')}>
          {columns.map((c) =>
            c.header === '' ? (
              <div key={c.key} className="flex justify-end pt-1">{c.render(r)}</div>
            ) : (
              <div key={c.key} className="flex items-start justify-between gap-3">
                <span className="shrink-0 pt-0.5 text-xs font-medium uppercase tracking-wide text-slate-500">{c.header}</span>
                <span className="min-w-0 break-words text-right text-slate-700">{c.render(r)}</span>
              </div>
            ),
          )}
        </li>
      ))}
    </ul>
    <div className="hidden overflow-x-auto md:block">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cx('whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={key(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx(onRowClick && 'cursor-pointer hover:bg-slate-50')}>
              {columns.map((c) => (
                <td key={c.key} className={cx('whitespace-nowrap px-4 py-2.5 text-slate-700', c.className)}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="px-4 py-3 text-xs text-slate-500">{total} record(s)</p> : null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span>
        Page {page} of {pages} · {total} records
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="no-print -mb-px flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
            value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {done ? 'Copied' : label}
    </Button>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y divide-slate-100 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-4 py-2">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-right font-medium text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="no-print flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">{children}</div>;
}

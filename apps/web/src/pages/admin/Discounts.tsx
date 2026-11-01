import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Table, Textarea, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime, formatINR } from '../../lib/format';
import type { DiscountCode } from '../../lib/types';

interface Form {
  id?: string;
  code: string;
  discountType: 'percent' | 'flat';
  discountValue: string;
  maxUses: string;
  expiresAt: string; // datetime-local
  isActive: boolean;
  note: string;
}

const empty: Form = { code: '', discountType: 'percent', discountValue: '', maxUses: '', expiresAt: '', isActive: true, note: '' };

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const valueLabel = (c: Pick<DiscountCode, 'discountType' | 'discountValue'>) =>
  c.discountType === 'percent' ? `${c.discountValue}% off` : `${formatINR(c.discountValue)} off`;

export function AdminDiscounts() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin-discounts'], queryFn: () => api.get<DiscountCode[]>('/admin/discounts') });
  const [editing, setEditing] = useState<Form | null>(null);

  const save = useMutation({
    mutationFn: (f: Form) => {
      const body = {
        discountType: f.discountType,
        discountValue: Number(f.discountValue),
        maxUses: f.maxUses ? Number(f.maxUses) : null,
        expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
        isActive: f.isActive,
        note: f.note,
      };
      return f.id ? api.patch(`/admin/discounts/${f.id}`, body) : api.post('/admin/discounts', { ...body, code: f.code });
    },
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['admin-discounts'] }); qc.invalidateQueries({ queryKey: ['admin-dashboard'] }); },
  });
  const toggle = useMutation({
    mutationFn: (c: DiscountCode) => api.patch(`/admin/discounts/${c.id}`, { isActive: !c.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-discounts'] }),
  });

  const rows = list.data ?? [];
  const totals = rows.reduce((t, c) => ({ uses: t.uses + c.uses, discount: t.discount + c.discount, revenue: t.revenue + c.revenue }), { uses: 0, discount: 0, revenue: 0 });
  const preview = editing && Number(editing.discountValue) > 0 ? valueLabel({ discountType: editing.discountType, discountValue: Number(editing.discountValue) }) : null;

  return (
    <>
      <PageHeader
        title="Discount codes"
        subtitle="Admin-only codes members enter at checkout. Income is counted after the discount; a 100% code activates the package for ₹0."
        actions={<Button onClick={() => setEditing({ ...empty })}><Plus className="h-4 w-4" /> New code</Button>}
      />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Paid uses" value={totals.uses} tone="brand" />
        <Stat label="Discount given" value={formatINR(totals.discount)} sub="income not received" tone="amber" />
        <Stat label="Income from discounted sales" value={formatINR(totals.revenue)} sub="what members actually paid" tone="green" />
      </div>
      {list.error && <Alert>{(list.error as Error).message}</Alert>}
      <Card padded={false}>
        <Table
          rows={list.data}
          empty="No discount codes yet"
          columns={[
            { key: 'c', header: 'Code', render: (c) => <div><p className="font-mono font-semibold">{c.code}</p>{c.note && <p className="text-xs text-slate-500">{c.note}</p>}</div> },
            { key: 'v', header: 'Discount', render: (c) => valueLabel(c) },
            { key: 'u', header: 'Uses', render: (c) => `${c.uses}${c.maxUses ? ` / ${c.maxUses}` : ''}` },
            { key: 'd', header: 'Discount given', className: 'text-right', render: (c) => formatINR(c.discount) },
            { key: 'r', header: 'Income', className: 'text-right', render: (c) => formatINR(c.revenue) },
            { key: 'e', header: 'Expires', render: (c) => (c.expiresAt ? formatDateTime(c.expiresAt) : 'Never') },
            {
              key: 's', header: 'Status', render: (c) => {
                if (!c.isActive) return <Badge>Off</Badge>;
                if (c.expiresAt && new Date(c.expiresAt) <= new Date()) return <Badge tone="amber">Expired</Badge>;
                if (c.maxUses && c.uses >= c.maxUses) return <Badge tone="amber">Used up</Badge>;
                return <Badge tone="green">Active</Badge>;
              },
            },
            {
              key: 'a', header: '', render: (c) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === c.id} onClick={() => toggle.mutate(c)}>{c.isActive ? 'Turn off' : 'Turn on'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({
                    id: c.id, code: c.code, discountType: c.discountType, discountValue: String(c.discountValue),
                    maxUses: c.maxUses ? String(c.maxUses) : '', expiresAt: toLocalInput(c.expiresAt), isActive: c.isActive, note: c.note ?? '',
                  })}><Pencil className="h-4 w-4" /> Edit</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Modal open={!!editing} onClose={() => { setEditing(null); save.reset(); }} title={editing?.id ? `Edit ${editing.code}` : 'New discount code'}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => editing && save.mutate(editing)}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <Field label="Code" hint="Members type this at checkout. 3–30 letters, digits, - or _">
              <Input value={editing.code} disabled={!!editing.id} className="font-mono" maxLength={30}
                onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="e.g. FREE100" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Discount type">
                <Select value={editing.discountType} onChange={(e) => setEditing({ ...editing, discountType: e.target.value as Form['discountType'] })}>
                  <option value="percent">Percentage (%)</option>
                  <option value="flat">Fixed amount (₹)</option>
                </Select>
              </Field>
              <Field label={editing.discountType === 'percent' ? 'Discount (%)' : 'Discount (₹)'} hint={editing.discountType === 'percent' ? '100 = fully free' : 'Capped at the package price'}>
                <Input type="number" min={0.01} step="0.01" max={editing.discountType === 'percent' ? 100 : undefined} value={editing.discountValue}
                  onChange={(e) => setEditing({ ...editing, discountValue: e.target.value })} />
              </Field>
              <Field label="Max uses (optional)" hint="Blank = unlimited">
                <Input type="number" min={1} step={1} value={editing.maxUses} onChange={(e) => setEditing({ ...editing, maxUses: e.target.value })} />
              </Field>
              <Field label="Expires at (optional)">
                <Input type="datetime-local" value={editing.expiresAt} onChange={(e) => setEditing({ ...editing, expiresAt: e.target.value })} />
              </Field>
            </div>
            <Field label="Note (admin only)"><Textarea rows={2} value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder="e.g. for staff / launch offer" /></Field>
            <Toggle checked={editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} label="Active" />
            {preview && (
              <Alert tone="sky">
                {preview}. Commissions are paid only on the amount the member actually pays{editing.discountType === 'percent' && Number(editing.discountValue) >= 100 ? ', so a 100% code pays no commissions and your income from it is ₹0' : ''}.
              </Alert>
            )}
            {save.error && <Alert>{(save.error as Error).message}</Alert>}
          </div>
        )}
      </Modal>
    </>
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Field, Input, PasswordInput, KV, PageHeader, Pagination } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { usePaged } from '../../lib/hooks';
import { formatDate, formatDateTime } from '../../lib/format';
import { imageToDataUrl } from '../../lib/image';
import type { Notification, PayoutDetails } from '../../lib/types';

export function Notifications() {
  const qc = useQueryClient();
  const list = usePaged<Notification>('notifications', '/me/notifications', {});
  const readAll = useMutation({ mutationFn: () => api.post('/me/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readOne = useMutation({ mutationFn: (id: string) => api.post(`/me/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <>
      <PageHeader title="Notifications" actions={<Button variant="secondary" loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all as read</Button>} />
      <Card padded={false}>
        {list.data?.items.length === 0 && <p className="p-6 text-center text-sm text-slate-500">You're all caught up.</p>}
        <ul className="divide-y divide-slate-100">
          {list.data?.items.map((n) => (
            <li key={n.id} className={`flex gap-3 px-5 py-4 ${n.readAt ? '' : 'bg-brand-50/50'}`} onClick={() => !n.readAt && readOne.mutate(n.id)}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-brand-600'}`} />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">{n.title}</p>
                {n.body && <p className="text-sm text-slate-600">{n.body}</p>}
                <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(n.createdAt)} · {n.type}</p>
              </div>
              {n.link && <Link to={n.link} className="self-center text-sm font-medium text-brand-600">View</Link>}
            </li>
          ))}
        </ul>
        {list.data && <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
    </>
  );
}

export function Profile() {
  const { me, refresh } = useAuth();
  const [fullName, setFullName] = useState(me?.fullName ?? '');
  const [payout, setPayout] = useState<PayoutDetails>(me?.payoutDetails ?? {});
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');

  const saveProfile = useMutation({
    mutationFn: () => {
      const clean = Object.fromEntries(Object.entries(payout).filter(([k, v]) => v && k !== 'upiQrPath'));
      return api.patch('/me/profile', { fullName, payoutDetails: clean });
    },
    onSuccess: () => refresh(),
  });
  const [qrErr, setQrErr] = useState('');
  const uploadQr = useMutation({
    mutationFn: async (file: File) => api.post('/me/payout-qr', { image: await imageToDataUrl(file, 1200, 0.9) }),
    onSuccess: () => refresh(),
    onError: (e: Error) => setQrErr(e.message),
  });
  const changePw = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      setPwMsg('Password changed successfully.');
    },
  });

  if (!me) return null;
  const set = (k: keyof PayoutDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPayout((p) => ({ ...p, [k]: k === 'ifsc' ? e.target.value.toUpperCase() : e.target.value }));

  return (
    <>
      <PageHeader title="Profile" subtitle="Account, package and payout details." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Account">
          <KV
            items={[
              ['User ID', me.userCode],
              ['Email', me.email],
              ['Mobile', me.mobile],
              ['Referral code', me.referralCode],
              ['Direct referrer', me.sponsor ? `${me.sponsor.fullName} (${me.sponsor.userCode})` : '—'],
              ['Member since', formatDate(me.createdAt)],
            ]}
          />
        </Card>
        <Card title="Package details" actions={<Link to="/app/upgrade" className="text-sm font-medium text-brand-600">Upgrade</Link>}>
          <KV
            items={[
              ['Active package', me.activePackage?.name ?? 'None'],
              ['Income eligibility', me.activePackage ? `Generation 1–${me.activePackage.maxGenerations} · Turnover Gen 4+` : '—'],
              ['Activated on', formatDate(me.packageActivatedAt)],
              ['Course access', <Link to="/app/courses" className="text-brand-600">View courses</Link>],
            ]}
          />
        </Card>
        <Card title="Edit profile & payout details">
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              saveProfile.mutate();
            }}
          >
            {saveProfile.isSuccess && <Alert tone="green">Saved.</Alert>}
            {saveProfile.error && <Alert>{(saveProfile.error as Error).message}</Alert>}
            <Field label="Full name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
            <Field label="UPI ID"><Input value={payout.upiId ?? ''} onChange={set('upiId')} placeholder="name@bank" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Account holder"><Input value={payout.accountName ?? ''} onChange={set('accountName')} /></Field>
              <Field label="Account number"><Input value={payout.accountNumber ?? ''} onChange={set('accountNumber')} /></Field>
              <Field label="IFSC"><Input value={payout.ifsc ?? ''} onChange={set('ifsc')} /></Field>
              <Field label="Bank name"><Input value={payout.bankName ?? ''} onChange={set('bankName')} /></Field>
            </div>
            <Button type="submit" loading={saveProfile.isPending}>Save changes</Button>
          </form>
          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="text-sm font-medium text-slate-700">UPI QR code</p>
            <p className="mb-3 text-xs text-slate-500">Upload the QR from your UPI app so withdrawals can be paid by scanning it.</p>
            <div className="flex items-center gap-4">
              {me.upiQrUrl
                ? <a href={me.upiQrUrl} target="_blank" rel="noreferrer"><img src={me.upiQrUrl} alt="Your UPI QR" className="h-28 w-28 rounded-lg border border-slate-200 object-contain" /></a>
                : <div className="flex h-28 w-28 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 text-xs text-slate-400">No QR</div>}
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {uploadQr.isPending ? 'Uploading…' : me.upiQrUrl ? 'Replace QR' : 'Upload QR'}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploadQr.isPending}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; setQrErr(''); if (f) uploadQr.mutate(f); }} />
              </label>
            </div>
            {uploadQr.isSuccess && <p className="mt-2 text-sm text-emerald-600">QR code saved.</p>}
            {qrErr && <div className="mt-2"><Alert>{qrErr}</Alert></div>}
          </div>
        </Card>
        <Card title="Change password">
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setPwMsg('');
              if (pw.newPassword !== pw.confirm) return setPwMsg('New passwords do not match');
              changePw.mutate();
            }}
          >
            {pwMsg && <Alert tone={pwMsg.includes('success') ? 'green' : 'rose'}>{pwMsg}</Alert>}
            {changePw.error && <Alert>{(changePw.error as Error).message}</Alert>}
            <Field label="Current password"><PasswordInput value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></Field>
            <Field label="New password"><PasswordInput minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required /></Field>
            <Field label="Confirm new password"><PasswordInput value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
            <Button type="submit" loading={changePw.isPending}>Update password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}

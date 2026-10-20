import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Card, FilterBar, Input, PageHeader, Pagination, Stat, Table, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { useDebounced, usePaged } from '../../lib/hooks';
import { formatDate } from '../../lib/format';
import type { DownlineMember, TeamSummary } from '../../lib/types';
import { ReferralCard } from './Dashboard';

/** From the viewer's point of view: L1 purchases pay direct, L2 pays G1, L3 pays G2, L4 pays G3. */
export const DEPTH_LABEL: Record<number, string> = {
  1: 'Direct referrals',
  2: 'Level 2 · earns you Gen 1',
  3: 'Level 3 · earns you Gen 2',
  4: 'Level 4 · earns you Gen 3',
};

export default function Team() {
  const summary = useQuery({ queryKey: ['team-summary'], queryFn: () => api.get<TeamSummary>('/me/team/summary') });
  const [depth, setDepth] = useState<'all' | '1' | '2' | '3' | '4'>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = usePaged<DownlineMember>('team', '/me/team', { depth: depth === 'all' ? undefined : depth, search: q });
  const s = summary.data;

  return (
    <>
      <PageHeader title="My Team" subtitle="Members registered directly or indirectly below you." />
      {s?.referralLink && (
        <div className="mb-6">
          <ReferralCard link={s.referralLink} code={s.referralCode!} />
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Direct referrals" value={s?.directReferrals ?? '—'} />
        <Stat label="Total downline" value={s?.totalDownline ?? '—'} />
        <Stat label="Active members" value={s?.active ?? '—'} tone="green" />
        <Stat label="Inactive members" value={s?.inactive ?? '—'} tone="amber" />
      </div>
      <Card padded={false}>
        <div className="px-4 pt-2">
          <Tabs
            value={depth}
            onChange={setDepth}
            tabs={[
              { value: 'all', label: 'All (4 levels)' },
              ...[1, 2, 3, 4].map((d) => ({
                value: String(d) as '1',
                label: `${DEPTH_LABEL[d].split(' · ')[0]} (${s?.byDepth?.[d] ?? 0})`,
              })),
            ]}
          />
        </div>
        <FilterBar>
          <Input placeholder="Search name or user ID" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          {depth !== 'all' && <span className="text-sm text-slate-500">{DEPTH_LABEL[Number(depth)]}</span>}
        </FilterBar>
        <Table
          rows={list.data?.items}
          empty="No members at this level yet. Share your referral link to grow your team."
          columns={[
            { key: 'member', header: 'Member', render: (m) => <div><p className="font-medium text-slate-900">{m.fullName}</p><p className="text-xs text-slate-500">{m.userCode}</p></div> },
            { key: 'level', header: 'Level', render: (m) => <Badge tone="brand">L{m.depth}</Badge> },
            { key: 'sponsor', header: 'Sponsor', render: (m) => m.sponsorCode ?? '—' },
            { key: 'package', header: 'Package', render: (m) => m.packageName ?? <span className="text-slate-400">None</span> },
            { key: 'status', header: 'Status', render: (m) => (m.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Inactive</Badge>) },
            { key: 'joined', header: 'Joined', render: (m) => formatDate(m.joinedAt) },
          ]}
        />
        {list.data && <Pagination page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </Card>
    </>
  );
}

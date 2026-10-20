import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Table, Textarea, Toggle } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime, formatINR, pct } from '../../lib/format';
import type { Lesson, Package } from '../../lib/types';

// ───────────────────────── Packages & commission rules ─────────────────────────
const emptyPkg = { name: '', slug: '', level: 1, price: 0, directRatePct: 40, maxGenerations: 1, description: '', features: '', isActive: true };

export function AdminPackages() {
  const qc = useQueryClient();
  const packages = useQuery({ queryKey: ['admin-packages'], queryFn: () => api.get<Package[]>('/admin/packages') });
  const rules = useQuery({ queryKey: ['rules'], queryFn: () => api.get<{ id: number; generationRatesBps: number[]; note: string | null; createdAt: string }[]>('/admin/commission-rules') });
  const [editing, setEditing] = useState<(typeof emptyPkg & { id?: string }) | null>(null);
  const [rates, setRates] = useState<string[] | null>(null);
  const [ruleNote, setRuleNote] = useState('');

  const save = useMutation({
    mutationFn: (p: typeof emptyPkg & { id?: string }) => {
      const body = {
        name: p.name, slug: p.slug, level: Number(p.level), price: Number(p.price), directRateBps: Math.round(Number(p.directRatePct) * 100),
        maxGenerations: Number(p.maxGenerations), description: p.description || undefined,
        features: p.features.split('\n').map((s) => s.trim()).filter(Boolean), isActive: p.isActive,
      };
      return p.id ? api.patch(`/admin/packages/${p.id}`, body) : api.post('/admin/packages', body);
    },
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['admin-packages'] }); qc.invalidateQueries({ queryKey: ['packages'] }); },
  });
  const addRule = useMutation({
    mutationFn: () => api.post('/admin/commission-rules', { generationRatesBps: rates!.map((r) => Math.round(Number(r) * 100)), note: ruleNote || undefined }),
    onSuccess: () => { setRates(null); setRuleNote(''); qc.invalidateQueries(); },
  });
  const current = rules.data?.[0];

  return (
    <>
      <PageHeader title="Packages & commission rules" subtitle="Prices, direct commission, generation eligibility and generation rates are fully configurable."
        actions={<Button onClick={() => setEditing({ ...emptyPkg, level: (packages.data?.length ?? 0) + 1 })}><Plus className="h-4 w-4" /> New package</Button>} />
      <Card padded={false} title="Packages">
        <Table
          rows={packages.data}
          columns={[
            { key: 'l', header: 'Level', render: (p) => p.level },
            { key: 'n', header: 'Package', render: (p) => <div><p className="font-medium">{p.name}</p><p className="text-xs text-slate-500">/{p.slug}</p></div> },
            { key: 'p', header: 'Price', className: 'text-right', render: (p) => formatINR(p.price, true) },
            { key: 'd', header: 'Direct', render: (p) => pct(p.directRateBps) },
            { key: 'g', header: 'Generation eligibility', render: (p) => (p.maxGenerations ? `G1–G${p.maxGenerations} (${p.generationRatesBps.map(pct).join(' / ')})` : 'None') },
            { key: 'c', header: 'Course access', render: (p) => `Level ≤ ${p.level}` },
            { key: 's', header: 'Status', render: (p) => (p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
            {
              key: 'e', header: '', render: (p) => (
                <Button size="sm" variant="ghost" onClick={() => setEditing({ id: p.id, name: p.name, slug: p.slug, level: p.level, price: p.price, directRatePct: p.directRateBps / 100, maxGenerations: p.maxGenerations, description: p.description ?? '', features: p.features.join('\n'), isActive: p.isActive })}>
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Generation commission rates" actions={!rates && current && <Button size="sm" variant="secondary" onClick={() => setRates(current.generationRatesBps.map((b) => String(b / 100)))}>Change rates</Button>}>
          {current && !rates && (
            <div className="grid grid-cols-3 gap-3 text-center">
              {current.generationRatesBps.map((b, i) => (
                <div key={i} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Generation {i + 1}</p><p className="text-xl font-bold">{pct(b)}</p></div>
              ))}
            </div>
          )}
          {rates && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {rates.map((r, i) => (
                  <Field key={i} label={`Gen ${i + 1} (%)`}><Input type="number" step="0.01" min={0} max={100} value={r} onChange={(e) => setRates(rates.map((x, j) => (j === i ? e.target.value : x)))} /></Field>
                ))}
              </div>
              <Field label="Reason for change"><Input value={ruleNote} onChange={(e) => setRuleNote(e.target.value)} /></Field>
              <Alert tone="amber">New rates apply to purchases verified after saving. Past commissions are unchanged.</Alert>
              {addRule.error && <Alert>{(addRule.error as Error).message}</Alert>}
              <div className="flex gap-2"><Button loading={addRule.isPending} onClick={() => addRule.mutate()}>Save new version</Button><Button variant="secondary" onClick={() => setRates(null)}>Cancel</Button></div>
            </div>
          )}
          <p className="mt-4 text-xs text-slate-500">Formula: G1 = D×r1 · G2 = D×r2 + G1×r1 · G3 = D×r3 + G1×r2 + G2×r1, where D = direct commission.</p>
        </Card>
        <Card title="Commission rule change history" padded={false}>
          <Table rows={rules.data} columns={[
            { key: 'v', header: 'Version', render: (r) => `v${r.id}` },
            { key: 'r', header: 'Rates', render: (r) => r.generationRatesBps.map(pct).join(' / ') },
            { key: 'n', header: 'Note', render: (r) => <span className="text-xs">{r.note ?? '—'}</span> },
            { key: 'd', header: 'Created', render: (r) => formatDateTime(r.createdAt) },
          ]} />
        </Card>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : 'New package'}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => editing && save.mutate(editing)}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Slug"><Input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></Field>
              <Field label="Level (higher = better)"><Input type="number" min={1} value={editing.level} onChange={(e) => setEditing({ ...editing, level: Number(e.target.value) })} /></Field>
              <Field label="Price (₹)"><Input type="number" min={1} value={editing.price} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></Field>
              <Field label="Direct commission (%)"><Input type="number" step="0.01" min={0} max={100} value={editing.directRatePct} onChange={(e) => setEditing({ ...editing, directRatePct: Number(e.target.value) })} /></Field>
              <Field label="Generation eligibility">
                <Select value={editing.maxGenerations} onChange={(e) => setEditing({ ...editing, maxGenerations: Number(e.target.value) })}>
                  <option value={0}>None</option><option value={1}>Generation 1</option><option value={2}>Generations 1–2</option><option value={3}>Generations 1–3</option>
                </Select>
              </Field>
            </div>
            <Field label="Description"><Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <Field label="Features (one per line)"><Textarea rows={3} value={editing.features} onChange={(e) => setEditing({ ...editing, features: e.target.value })} /></Field>
            <Toggle checked={editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} label="Active (available for purchase)" />
            {save.error && <Alert>{(save.error as Error).message}</Alert>}
          </div>
        )}
      </Modal>
    </>
  );
}

// ───────────────────────── Courses ─────────────────────────
interface AdminCourse {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  thumbnailUrl: string | null;
  minPackageLevel: number;
  isPublished: boolean;
  sort: number;
  lessons: { count: number }[] | Lesson[];
  enrolments?: { count: number }[];
}
const emptyCourse = { title: '', slug: '', description: '', thumbnailUrl: '', minPackageLevel: 1, isPublished: false, sort: 0 };

function CourseForm({ initial, onDone }: { initial: typeof emptyCourse & { id?: string }; onDone: () => void }) {
  const qc = useQueryClient();
  const [c, setC] = useState(initial);
  const packages = useQuery({ queryKey: ['admin-packages'], queryFn: () => api.get<Package[]>('/admin/packages') });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...c, description: c.description || undefined, thumbnailUrl: c.thumbnailUrl || undefined, minPackageLevel: Number(c.minPackageLevel), sort: Number(c.sort) };
      delete (body as { id?: string }).id;
      return c.id ? api.patch(`/admin/courses/${c.id}`, body) : api.post('/admin/courses', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-courses'] }); qc.invalidateQueries({ queryKey: ['admin-course'] }); onDone(); },
  });
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title"><Input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value, slug: c.id ? c.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} required /></Field>
        <Field label="Slug"><Input value={c.slug} onChange={(e) => setC({ ...c, slug: e.target.value })} required /></Field>
        <Field label="Minimum package">
          <Select value={c.minPackageLevel} onChange={(e) => setC({ ...c, minPackageLevel: Number(e.target.value) })}>
            {packages.data?.map((p) => <option key={p.id} value={p.level}>{p.name} (level {p.level})</option>)}
          </Select>
        </Field>
        <Field label="Sort order"><Input type="number" value={c.sort} onChange={(e) => setC({ ...c, sort: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Thumbnail URL"><Input value={c.thumbnailUrl} onChange={(e) => setC({ ...c, thumbnailUrl: e.target.value })} placeholder="https://…" /></Field>
      <Field label="Description"><Textarea rows={3} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field>
      <Toggle checked={c.isPublished} onChange={(v) => setC({ ...c, isPublished: v })} label="Published" />
      {save.error && <Alert>{(save.error as Error).message}</Alert>}
      <Button type="submit" loading={save.isPending}>Save course</Button>
    </form>
  );
}

export function AdminCourses() {
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: () => api.get<AdminCourse[]>('/admin/courses') });
  const packages = useQuery({ queryKey: ['admin-packages'], queryFn: () => api.get<Package[]>('/admin/packages') });
  const [creating, setCreating] = useState(false);
  const pkgName = (lvl: number) => packages.data?.find((p) => p.level === lvl)?.name ?? `Level ${lvl}`;
  return (
    <>
      <PageHeader title="Courses" subtitle="Manage course access by package." actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New course</Button>} />
      <Card padded={false}>
        <Table
          rows={courses.data}
          columns={[
            { key: 't', header: 'Course', render: (c) => <Link to={`/admin/courses/${c.id}`} className="font-medium text-brand-700">{c.title}</Link> },
            { key: 'a', header: 'Access', render: (c) => `${pkgName(c.minPackageLevel)}+` },
            { key: 'l', header: 'Lessons', render: (c) => (c.lessons as { count: number }[])[0]?.count ?? 0 },
            { key: 'e', header: 'Enrolments', render: (c) => c.enrolments?.[0]?.count ?? 0 },
            { key: 'p', header: 'Status', render: (c) => (c.isPublished ? <Badge tone="green">Published</Badge> : <Badge>Draft</Badge>) },
          ]}
        />
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New course">
        <CourseForm initial={emptyCourse} onDone={() => setCreating(false)} />
      </Modal>
    </>
  );
}

const emptyLesson = { title: '', videoUrl: '', content: '', durationMinutes: 10, sort: 0, isPreview: false };

export function AdminCourseEdit() {
  const { id } = useParams();
  const qc = useQueryClient();
  const course = useQuery({ queryKey: ['admin-course', id], queryFn: () => api.get<AdminCourse & { lessons: Lesson[] }>(`/admin/courses/${id}`) });
  const [lesson, setLesson] = useState<(typeof emptyLesson & { id?: string }) | null>(null);
  const saveLesson = useMutation({
    mutationFn: (l: typeof emptyLesson & { id?: string }) => {
      const body = { title: l.title, videoUrl: l.videoUrl || undefined, content: l.content || undefined, durationMinutes: Number(l.durationMinutes) || undefined, sort: Number(l.sort), isPreview: l.isPreview };
      return l.id ? api.patch(`/admin/lessons/${l.id}`, body) : api.post(`/admin/courses/${id}/lessons`, body);
    },
    onSuccess: () => { setLesson(null); qc.invalidateQueries({ queryKey: ['admin-course', id] }); },
  });
  const removeLesson = useMutation({ mutationFn: (lid: string) => api.del(`/admin/lessons/${lid}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-course', id] }) });

  if (course.isLoading) return <Spinner />;
  const c = course.data!;
  return (
    <>
      <Link to="/admin/courses" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Courses</Link>
      <PageHeader title={c.title} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Course details">
          <CourseForm key={c.id} initial={{ id: c.id, title: c.title, slug: c.slug, description: c.description ?? '', thumbnailUrl: c.thumbnailUrl ?? '', minPackageLevel: c.minPackageLevel, isPublished: c.isPublished, sort: c.sort }} onDone={() => undefined} />
        </Card>
        <Card title="Lessons" padded={false} actions={<Button size="sm" onClick={() => setLesson({ ...emptyLesson, sort: c.lessons.length + 1 })}><Plus className="h-4 w-4" /> Add lesson</Button>}>
          <Table rows={c.lessons} columns={[
            { key: 's', header: '#', render: (l) => l.sort },
            { key: 't', header: 'Title', render: (l) => <div><p className="font-medium">{l.title}</p><p className="text-xs text-slate-500">{l.videoUrl ? 'Video' : 'Text'}{l.isPreview ? ' · preview' : ''}</p></div> },
            { key: 'd', header: 'Min', render: (l) => l.durationMinutes ?? '—' },
            {
              key: 'a', header: '', render: (l) => (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setLesson({ id: l.id, title: l.title, videoUrl: l.videoUrl ?? '', content: l.content ?? '', durationMinutes: l.durationMinutes ?? 0, sort: l.sort, isPreview: l.isPreview })}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => confirm(`Delete "${l.title}"?`) && removeLesson.mutate(l.id)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                </div>
              ),
            },
          ]} />
        </Card>
      </div>
      <Modal open={!!lesson} onClose={() => setLesson(null)} title={lesson?.id ? 'Edit lesson' : 'Add lesson'}
        footer={<><Button variant="secondary" onClick={() => setLesson(null)}>Cancel</Button><Button loading={saveLesson.isPending} onClick={() => lesson && saveLesson.mutate(lesson)}>Save</Button></>}>
        {lesson && (
          <div className="space-y-4">
            <Field label="Title"><Input value={lesson.title} onChange={(e) => setLesson({ ...lesson, title: e.target.value })} /></Field>
            <Field label="Video URL" hint="YouTube, Vimeo or a direct .mp4 link"><Input value={lesson.videoUrl} onChange={(e) => setLesson({ ...lesson, videoUrl: e.target.value })} /></Field>
            <Field label="Content / notes"><Textarea rows={5} value={lesson.content} onChange={(e) => setLesson({ ...lesson, content: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Duration (min)"><Input type="number" value={lesson.durationMinutes} onChange={(e) => setLesson({ ...lesson, durationMinutes: Number(e.target.value) })} /></Field>
              <Field label="Sort"><Input type="number" value={lesson.sort} onChange={(e) => setLesson({ ...lesson, sort: Number(e.target.value) })} /></Field>
            </div>
            <Toggle checked={lesson.isPreview} onChange={(v) => setLesson({ ...lesson, isPreview: v })} label="Free preview (visible to all members)" />
            {saveLesson.error && <Alert>{(saveLesson.error as Error).message}</Alert>}
          </div>
        )}
      </Modal>
    </>
  );
}

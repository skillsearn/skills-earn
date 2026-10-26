import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, EyeOff, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Field, FilterBar, Input, Modal, PageHeader, Select, Spinner, Table, Textarea, Toggle } from '../../components/ui';
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
            { key: 'g', header: 'Generation eligibility', render: (p) => (p.maxGenerations ? `G1–G${p.maxGenerations} (${p.generationRatesBps.slice(0, 3).map(pct).join(' / ')}${p.maxGenerations > 3 ? ' …' : ''})` : 'None') },
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
          <p className="mt-4 text-xs text-slate-500">
            Formula: G1 = D×r1 · G2 = D×r2 + G1×r1 · G3 = D×r3 + G1×r2 + G2×r1, where D = direct commission.
            From generation 4 the rates repeat on the previous three generations: Gn = G(n−3)×r3 + G(n−2)×r2 + G(n−1)×r1.
            How many generations are calculated is set under Settings → Commission processing.
          </p>
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
              <Field label="Generation eligibility (up to generation)" hint="0 = none. Raise above 3 only after the business defines eligibility for deeper generations.">
                <Input type="number" min={0} max={50} value={editing.maxGenerations} onChange={(e) => setEditing({ ...editing, maxGenerations: Number(e.target.value) })} />
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
type CourseStatus = 'draft' | 'published' | 'unpublished' | 'archived';
interface AdminCourse {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  thumbnailUrl: string | null;
  category: string | null;
  duration: string | null;
  minPackageLevel: number;
  status: CourseStatus;
  sort: number;
  publishedAt: string | null;
  updatedAt: string;
  lessons: { count: number }[] | Lesson[];
  enrolments?: { count: number }[];
}
const emptyCourse = { title: '', slug: '', description: '', thumbnailUrl: '', category: '', duration: '', minPackageLevel: 1, sort: 0 };
type CourseFormValue = typeof emptyCourse & { id?: string; status?: CourseStatus };

const STATUS_BADGE: Record<CourseStatus, ReactNode> = {
  draft: <Badge>Draft</Badge>,
  published: <Badge tone="green">Published</Badge>,
  unpublished: <Badge tone="amber">Unpublished</Badge>,
  archived: <Badge tone="rose">Archived</Badge>,
};

function useCourseActions(onDeleted?: () => void) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-courses'] }); qc.invalidateQueries({ queryKey: ['admin-course'] }); };
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Exclude<CourseStatus, 'archived'> }) => api.patch(`/admin/courses/${id}/status`, { status }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del<{ result: 'deleted' | 'archived'; enrolments: number }>(`/admin/courses/${id}`),
    onSuccess: (r) => {
      refresh();
      alert(r.result === 'archived'
        ? `This course has student records (${r.enrolments} enrolment${r.enrolments === 1 ? '' : 's'}), so it was archived instead of deleted. It is hidden from members and the records are kept.`
        : 'Course deleted.');
      onDeleted?.();
    },
  });
  const confirmDelete = (c: { id: string; title: string }) =>
    confirm(`Delete "${c.title}"?\n\nIf members have enrolled in it, the course will be archived (hidden, records kept) instead of permanently deleted.`) && remove.mutate(c.id);
  return { setStatus, remove, confirmDelete };
}

function CourseForm({ initial, onDone }: { initial: CourseFormValue; onDone: () => void }) {
  const qc = useQueryClient();
  const [c, setC] = useState(initial);
  const packages = useQuery({ queryKey: ['admin-packages'], queryFn: () => api.get<Package[]>('/admin/packages') });
  const save = useMutation({
    mutationFn: (status?: Exclude<CourseStatus, 'archived'>) => {
      const body = {
        title: c.title, slug: c.slug, description: c.description || undefined, thumbnailUrl: c.thumbnailUrl || undefined,
        category: c.category.trim() || undefined, duration: c.duration.trim() || undefined,
        minPackageLevel: Number(c.minPackageLevel), sort: Number(c.sort), status,
      };
      return c.id ? api.patch(`/admin/courses/${c.id}`, body) : api.post('/admin/courses', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-courses'] }); qc.invalidateQueries({ queryKey: ['admin-course'] }); onDone(); },
  });
  const isNew = !c.id;
  const live = c.status === 'published';
  return (
    <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(isNew ? 'draft' : undefined); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title"><Input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value, slug: c.id ? c.slug : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} required /></Field>
        <Field label="Slug"><Input value={c.slug} onChange={(e) => setC({ ...c, slug: e.target.value })} required /></Field>
        <Field label="Category"><Input value={c.category} onChange={(e) => setC({ ...c, category: e.target.value })} placeholder="e.g. Marketing" list="course-categories" /></Field>
        <Field label="Duration" hint="Shown to members"><Input value={c.duration} onChange={(e) => setC({ ...c, duration: e.target.value })} placeholder="e.g. 4 weeks or 6 hours" /></Field>
        <Field label="Minimum package" hint="Access is included in the package fee">
          <Select value={c.minPackageLevel} onChange={(e) => setC({ ...c, minPackageLevel: Number(e.target.value) })}>
            {packages.data?.map((p) => <option key={p.id} value={p.level}>{p.name} ({formatINR(p.price, true)})</option>)}
          </Select>
        </Field>
        <Field label="Sort order"><Input type="number" value={c.sort} onChange={(e) => setC({ ...c, sort: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Thumbnail URL"><Input value={c.thumbnailUrl} onChange={(e) => setC({ ...c, thumbnailUrl: e.target.value })} placeholder="https://…" /></Field>
      <Field label="Description"><Textarea rows={3} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field>
      {save.error && <Alert>{(save.error as Error).message}</Alert>}
      <div className="flex flex-wrap gap-2">
        {isNew ? (
          <>
            <Button type="submit" variant="secondary" loading={save.isPending && save.variables === 'draft'}>Save as draft</Button>
            <Button type="button" loading={save.isPending && save.variables === 'published'} onClick={() => save.mutate('published')}>Save & publish</Button>
          </>
        ) : (
          <Button type="submit" loading={save.isPending}>{live ? 'Save changes (live)' : 'Save changes'}</Button>
        )}
      </div>
      {isNew && <p className="text-xs text-slate-500">Drafts are never shown to members. Add lessons, then publish when the course is ready.</p>}
    </form>
  );
}

export function AdminCourses() {
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: () => api.get<AdminCourse[]>('/admin/courses') });
  const packages = useQuery({ queryKey: ['admin-packages'], queryFn: () => api.get<Package[]>('/admin/packages') });
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'' | CourseStatus>('');
  const actions = useCourseActions();
  const pkgName = (lvl: number) => packages.data?.find((p) => p.level === lvl)?.name ?? `Level ${lvl}`;
  const categories = [...new Set((courses.data ?? []).map((c) => c.category).filter((x): x is string => !!x))].sort();
  const q = search.trim().toLowerCase();
  const rows = courses.data?.filter((c) =>
    (status ? c.status === status : c.status !== 'archived')
    && (!category || c.category === category)
    && (!q || c.title.toLowerCase().includes(q) || c.slug.includes(q) || (c.category ?? '').toLowerCase().includes(q)));
  const count = (s: CourseStatus) => courses.data?.filter((c) => c.status === s).length ?? 0;

  return (
    <>
      <PageHeader title="Courses" subtitle="Add, edit, publish and archive courses. Drafts and unpublished courses are hidden from members."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New course</Button>} />
      <Card padded={false}>
        <FilterBar>
          <Field label="Search"><Input placeholder="Course name or category" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" /></Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as '' | CourseStatus)}>
              <option value="">All active ({(courses.data?.length ?? 0) - count('archived')})</option>
              <option value="draft">Draft ({count('draft')})</option>
              <option value="published">Published ({count('published')})</option>
              <option value="unpublished">Unpublished ({count('unpublished')})</option>
              <option value="archived">Archived ({count('archived')})</option>
            </Select>
          </Field>
        </FilterBar>
        <Table
          rows={rows}
          empty={q || category || status ? 'No courses match these filters' : 'No courses yet'}
          columns={[
            { key: 't', header: 'Course', render: (c) => <div><Link to={`/admin/courses/${c.id}`} className="font-medium text-brand-700">{c.title}</Link><p className="text-xs text-slate-500">{[c.category, c.duration].filter(Boolean).join(' · ') || '—'}</p></div> },
            { key: 'a', header: 'Access', render: (c) => `${pkgName(c.minPackageLevel)}+` },
            { key: 'l', header: 'Lessons', render: (c) => (c.lessons as { count: number }[])[0]?.count ?? 0 },
            { key: 'e', header: 'Enrolments', render: (c) => c.enrolments?.[0]?.count ?? 0 },
            { key: 'p', header: 'Status', render: (c) => STATUS_BADGE[c.status] },
            {
              key: 'x', header: '', render: (c) => (
                <div className="flex justify-end gap-1">
                  {c.status === 'published' ? (
                    <Button size="sm" variant="ghost" onClick={() => actions.setStatus.mutate({ id: c.id, status: 'unpublished' })}><EyeOff className="h-4 w-4" /> Unpublish</Button>
                  ) : c.status === 'archived' ? (
                    <Button size="sm" variant="ghost" onClick={() => actions.setStatus.mutate({ id: c.id, status: 'draft' })}><RotateCcw className="h-4 w-4" /> Restore</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => actions.setStatus.mutate({ id: c.id, status: 'published' })}><Eye className="h-4 w-4" /> Publish</Button>
                  )}
                  {c.status !== 'archived' && (
                    <>
                      <Link to={`/admin/courses/${c.id}`} className="inline-flex items-center rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-100" aria-label="Edit"><Pencil className="h-4 w-4" /></Link>
                      <Button size="sm" variant="ghost" onClick={() => actions.confirmDelete(c)} aria-label="Delete"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
        {(actions.setStatus.error || actions.remove.error) && <div className="p-4"><Alert>{((actions.setStatus.error || actions.remove.error) as Error).message}</Alert></div>}
      </Card>
      <datalist id="course-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
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
  const navigate = useNavigate();
  const actions = useCourseActions(() => navigate('/admin/courses'));
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
  if (course.error || !course.data) return <Alert>{(course.error as Error)?.message ?? 'Course not found'}</Alert>;
  const c = course.data;
  const archived = c.status === 'archived';
  return (
    <>
      <Link to="/admin/courses" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Courses</Link>
      <PageHeader
        title={c.title}
        subtitle={<span className="flex items-center gap-2">{STATUS_BADGE[c.status]} {c.status === 'published' ? 'Visible to members' : archived ? 'Archived: hidden from members, student records kept' : 'Hidden from members'}</span>}
        actions={
          <>
            {c.status === 'published' && <Button variant="secondary" loading={actions.setStatus.isPending} onClick={() => actions.setStatus.mutate({ id: c.id, status: 'unpublished' })}><EyeOff className="h-4 w-4" /> Unpublish</Button>}
            {(c.status === 'draft' || c.status === 'unpublished') && <Button loading={actions.setStatus.isPending} onClick={() => actions.setStatus.mutate({ id: c.id, status: 'published' })}><Eye className="h-4 w-4" /> Publish</Button>}
            {c.status === 'unpublished' && <Button variant="secondary" onClick={() => actions.setStatus.mutate({ id: c.id, status: 'draft' })}>Move to draft</Button>}
            {archived && <Button loading={actions.setStatus.isPending} onClick={() => actions.setStatus.mutate({ id: c.id, status: 'draft' })}><RotateCcw className="h-4 w-4" /> Restore as draft</Button>}
            {!archived && <Button variant="secondary" loading={actions.remove.isPending} onClick={() => actions.confirmDelete(c)}><Trash2 className="h-4 w-4 text-rose-600" /> Delete</Button>}
          </>
        }
      />
      {(actions.setStatus.error || actions.remove.error) && <div className="mb-4"><Alert>{((actions.setStatus.error || actions.remove.error) as Error).message}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Course details">
          {archived ? (
            <p className="text-sm text-slate-500">Restore this course to edit it.</p>
          ) : (
            <CourseForm key={`${c.id}-${c.updatedAt}`} initial={{ id: c.id, status: c.status, title: c.title, slug: c.slug, description: c.description ?? '', thumbnailUrl: c.thumbnailUrl ?? '', category: c.category ?? '', duration: c.duration ?? '', minPackageLevel: c.minPackageLevel, sort: c.sort }} onDone={() => undefined} />
          )}
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

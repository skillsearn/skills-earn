import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Circle, Lock, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Empty, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import type { CourseSummary, Lesson } from '../../lib/types';

export function Courses() {
  const { data, isLoading } = useQuery({ queryKey: ['courses'], queryFn: () => api.get<CourseSummary[]>('/courses') });
  if (isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="My Courses" subtitle="Courses included with your package. Upgrade to unlock more." />
      {!data?.length ? (
        <Empty title="No courses published yet" />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => {
            const progress = c.lessonCount ? Math.round((c.completedCount / c.lessonCount) * 100) : 0;
            return (
              <Link key={c.id} to={`/app/courses/${c.slug}`} className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
                <div className="relative flex h-32 items-center justify-center bg-gradient-to-br from-neutral-900 via-ink to-brand-900">
                  {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <PlayCircle className="h-12 w-12 text-brand-300" />}
                  {c.locked && (
                    <span className="absolute inset-0 flex items-center justify-center bg-slate-900/50 text-sm font-semibold text-white">
                      <Lock className="mr-1 h-4 w-4" /> Locked
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="font-semibold text-slate-900 group-hover:text-brand-700">{c.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">{c.description}</p>
                  <div className="mt-auto pt-4">
                    {c.locked ? (
                      <Badge tone="amber">Requires a higher package</Badge>
                    ) : (
                      <>
                        <div className="h-1.5 rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{c.completedCount}/{c.lessonCount} lessons · {progress}%</p>
                      </>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function embedUrl(url: string) {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vimeo = /vimeo\.com\/(\d+)/.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

export function CourseDetail() {
  const { slug } = useParams();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['course', slug],
    queryFn: () => api.get<{ title: string; description: string; locked: boolean; lessons: Lesson[] }>(`/courses/${slug}`),
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const complete = useMutation({
    mutationFn: (id: string) => api.post(`/courses/lessons/${id}/complete`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['course', slug] }),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <Alert>{(error as Error)?.message}</Alert>;
  const active = data.lessons.find((l) => l.id === activeId) ?? data.lessons.find((l) => !l.locked) ?? data.lessons[0];
  const embed = active?.videoUrl ? embedUrl(active.videoUrl) : null;

  return (
    <>
      <Link to="/app/courses" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> All courses</Link>
      <PageHeader title={data.title} subtitle={data.description} />
      {data.locked && (
        <div className="mb-6">
          <Alert tone="amber">This course needs a higher package. Preview lessons are open. <Link to="/app/upgrade" className="font-semibold underline">Upgrade →</Link></Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {active && !active.locked ? (
            <Card>
              {embed ? (
                <div className="aspect-video overflow-hidden rounded-lg bg-black">
                  <iframe src={embed} title={active.title} className="h-full w-full" allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen />
                </div>
              ) : active.videoUrl ? (
                <video src={active.videoUrl} controls className="aspect-video w-full rounded-lg bg-black" />
              ) : null}
              <h2 className="mt-4 text-lg font-semibold">{active.title}</h2>
              {active.content && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{active.content}</p>}
              <div className="mt-6">
                {active.completed ? (
                  <Badge tone="green">Completed</Badge>
                ) : (
                  <Button loading={complete.isPending} onClick={() => complete.mutate(active.id)}>
                    <CheckCircle2 className="h-4 w-4" /> Mark as complete
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <Empty title="Lesson locked"><Link to="/app/upgrade" className="text-brand-600">Upgrade your package</Link> to watch this lesson.</Empty>
            </Card>
          )}
        </div>
        <Card title={`Lessons (${data.lessons.length})`} padded={false}>
          <ul className="divide-y divide-slate-100">
            {data.lessons.map((l, i) => (
              <li key={l.id}>
                <button
                  onClick={() => setActiveId(l.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50 ${active?.id === l.id ? 'bg-brand-50' : ''}`}
                >
                  {l.locked ? <Lock className="h-4 w-4 text-slate-400" /> : l.completed ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-slate-300" />}
                  <span className="flex-1">
                    <span className="font-medium text-slate-800">{i + 1}. {l.title}</span>
                    {l.durationMinutes ? <span className="block text-xs text-slate-500">{l.durationMinutes} min{l.isPreview ? ' · preview' : ''}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

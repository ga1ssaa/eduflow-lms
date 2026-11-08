import '../pages.css';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { BookOpen, ChevronDown } from 'lucide-react';
import { SelectControl } from '../components/SelectControl';
import { CourseActions } from '../components/CourseActions';
import type { Status } from '../lib/types';
import {
  Badge,
  Empty,
  ErrorPanel,
  Loading,
  PageHeading,
  Pagination,
  safeVideo,
  usePage,
} from '../components/ui';
import type { FormEvent } from 'react';
export function WorkspacePage({
  admin = false,
  dashboard = false,
}: {
  admin?: boolean;
  dashboard?: boolean;
}) {
  const { user } = useAuth();
  const { params, page, setPage, setParams } = usePage();
  const status = ['draft', 'published'].includes(params.get('status') ?? '')
    ? (params.get('status') as Status)
    : undefined;
  const filters = {
    page,
    page_size: 12,
    status,
    ...(admin ? { search: params.get('search') || undefined } : {}),
  };
  const query = useQuery({
    queryKey: [admin ? 'admin' : 'author', user!.id, 'courses', filters],
    queryFn: ({ signal }) =>
      admin
        ? api.adminCourses(filters, signal)
        : api.instructorCourses(filters, signal),
  });
  const filter = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const key of ['status', 'search']) {
      const value = String(data.get(key) ?? '').trim();
      if (value) next.set(key, value);
    }
    setParams(next);
  };
  return (
    <>
      {!dashboard && (
        <PageHeading
          eyebrow={admin ? 'ADMINISTRATION' : 'INSTRUCTOR WORKSPACE'}
          title={admin ? 'Course moderation' : 'Your courses'}
        >
          <p>
            {admin
              ? 'Review course content and manage publication across EduFlow.'
              : 'Review your curriculum and understand your learners’ progress.'}
          </p>
        </PageHeading>
      )}
      {!admin && !dashboard && (
        <div className="actions workspace-create">
          <Link className="button primary" to="/instructor/courses/new">
            Create course
          </Link>
        </div>
      )}
      <form className="filter-bar compact surface" onSubmit={filter}>
        {admin && (
          <label>
            <span>Search courses</span>
            <input
              name="search"
              maxLength={200}
              defaultValue={params.get('search') ?? ''}
            />
          </label>
        )}
        <label>
          <span>Publication status</span>
          <SelectControl name="status" defaultValue={status ?? ''}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </SelectControl>
        </label>
        <button className="button primary">Apply filters</button>
      </form>
      {query.isPending ? (
        <Loading label="Loading courses…" />
      ) : query.isError ? (
        <ErrorPanel error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {!query.data.items.length ? (
            <Empty title="No courses to show">
              <p>
                {admin
                  ? 'No courses match these filters.'
                  : 'Courses you own will appear here.'}
              </p>
            </Empty>
          ) : (
            <div className="course-list workspace-course-grid">
              {query.data.items.map((c, index) => (
                <article
                  className="course-row surface"
                  key={c.id}
                  data-reveal
                  data-reveal-index={index}
                >
                  <div className="workspace-course-art" aria-hidden="true">
                    <span>{c.category || 'Course'}</span>
                    <BookOpen size={40} strokeWidth={1} />
                  </div>
                  <div className="workspace-course-copy">
                    <Badge success={c.status === 'published'}>{c.status}</Badge>
                    <h2>
                      <Link
                        to={`/${admin ? 'admin' : 'instructor'}/courses/${c.id}`}
                      >
                        {c.title}
                      </Link>
                    </h2>
                    <p className="workspace-course-description">
                      {c.description ||
                        'Add your course description when you are ready to shape the learning path.'}
                    </p>
                    <p className="muted">
                      {c.instructor_name} · {c.module_count} modules ·{' '}
                      {c.lesson_count} lessons
                    </p>
                  </div>
                  <div className="actions">
                    <Link
                      className="button secondary"
                      to={`/instructor/courses/${c.id}/students`}
                    >
                      Student statistics
                    </Link>
                    <Link
                      className="button secondary"
                      to={`/${admin ? 'admin' : 'instructor'}/courses/${c.id}`}
                    >
                      Review course
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
          <Pagination
            page={page}
            total={query.data.total}
            size={query.data.page_size}
            onChange={setPage}
          />
        </>
      )}
    </>
  );
}
export function ManagementPage({
  admin = false,
  studentsOnly = false,
}: {
  admin?: boolean;
  studentsOnly?: boolean;
}) {
  const { courseId = '' } = useParams();
  const { user } = useAuth();
  const { page, setPage } = usePage();
  const base = admin ? 'admin' : 'author';
  const course = useQuery({
    queryKey: [base, user!.id, 'course', courseId],
    queryFn: ({ signal }) => api.managementCourse(courseId, admin, signal),
  });
  const stats = useQuery({
    queryKey: [base, user!.id, 'stats', courseId],
    queryFn: ({ signal }) => api.courseStats(courseId, signal),
    enabled: course.isSuccess,
  });
  const students = useQuery({
    queryKey: [base, user!.id, 'students', courseId, page],
    queryFn: ({ signal }) =>
      api.courseStudents(courseId, { page, page_size: 20 }, signal),
    enabled: course.isSuccess,
  });
  if (course.isPending) return <Loading label="Loading course review…" />;
  if (course.isError)
    return (
      <ErrorPanel error={course.error} retry={() => void course.refetch()} />
    );
  const c = course.data;
  return (
    <>
      <Link
        className="back-link"
        to={`/${admin ? 'admin' : 'instructor'}/courses`}
      >
        ← Back to courses
      </Link>
      <PageHeading
        eyebrow={admin ? 'COURSE MODERATION' : 'COURSE OVERVIEW'}
        title={studentsOnly ? `Student progress · ${c.title}` : c.title}
      >
        <p>{c.description || 'No description provided.'}</p>
      </PageHeading>
      <div className="course-metadata">
        <Badge success={c.status === 'published'}>{c.status}</Badge>
        <span>By {c.instructor_name}</span>
        <span>{c.category || 'No category'}</span>
        <span>{c.level}</span>
      </div>
      {!studentsOnly && <CourseActions course={c} admin={admin} />}
      {studentsOnly && (
        <div className="actions">
          <Link className="button secondary" to={`/instructor/courses/${c.id}`}>
            Course overview
          </Link>
          <Link
            className="button secondary"
            to={`/instructor/courses/${c.id}/curriculum`}
          >
            Edit curriculum
          </Link>
        </div>
      )}
      {stats.isPending ? (
        <Loading label="Loading course statistics…" />
      ) : stats.isError ? (
        <ErrorPanel error={stats.error} retry={() => void stats.refetch()} />
      ) : (
        <div className="stats-grid">
          <div className="stat surface" data-reveal data-reveal-index={0}>
            <span>Enrolled learners</span>
            <strong>{stats.data.total_students}</strong>
          </div>
          <div className="stat surface" data-reveal data-reveal-index={1}>
            <span>Completed learners</span>
            <strong>{stats.data.completed_students}</strong>
          </div>
          <div className="stat surface" data-reveal data-reveal-index={2}>
            <span>Average progress</span>
            <strong>{stats.data.average_progress_percentage}%</strong>
          </div>
        </div>
      )}
      {!studentsOnly && (
        <section className="curriculum surface">
          <h2 data-reveal>Curriculum preview</h2>
          {c.modules.length === 0 ? (
            <p>No modules have been added.</p>
          ) : (
            c.modules.map((m) => (
              <details key={m.id}>
                <summary>
                  {m.position}. {m.title}
                  <span>{m.lessons.length} lessons</span>
                  <ChevronDown
                    className="curriculum-chevron"
                    size={18}
                    aria-hidden="true"
                  />
                </summary>
                {m.lessons.map((l) => (
                  <article className="preview-lesson" key={l.id}>
                    <h3>
                      {l.position}. {l.title}
                    </h3>
                    <p className="lesson-text">
                      {l.content || 'No text content.'}
                    </p>
                    {safeVideo(l.video_url) && (
                      <a
                        className="text-link"
                        href={safeVideo(l.video_url)!}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open video (new tab)
                      </a>
                    )}
                  </article>
                ))}
              </details>
            ))
          )}
        </section>
      )}
      <div className="section-heading roster-heading" data-reveal>
        <div>
          <p className="eyebrow">LEARNER ACTIVITY</p>
          <h2>Enrolled learners</h2>
        </div>
      </div>
      {students.isPending ? (
        <Loading label="Loading learners…" />
      ) : students.isError ? (
        <ErrorPanel
          error={students.error}
          retry={() => void students.refetch()}
        />
      ) : (
        <>
          {students.data.items.length === 0 ? (
            <Empty title="No learners to show">
              <p>Student enrollments will appear here.</p>
            </Empty>
          ) : (
            <div
              className="roster surface product-roster"
              role="region"
              aria-label="Learner progress table"
              tabIndex={0}
            >
              <table>
                <caption className="sr-only">
                  Learner progress for {c.title}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Learner</th>
                    <th scope="col">Enrolled</th>
                    <th scope="col">Lessons complete</th>
                    <th scope="col">Progress</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {students.data.items.map((s) => (
                    <tr key={s.enrollment_id}>
                      <th scope="row">{s.full_name}</th>
                      <td>{new Date(s.enrolled_at).toLocaleDateString()}</td>
                      <td>
                        {s.completed_lessons} / {s.total_lessons}
                      </td>
                      <td>
                        {s.progress_percentage}%
                        {s.is_completed && (
                          <span className="sr-only"> Complete</span>
                        )}
                      </td>
                      <td>{s.is_completed ? 'Completed' : 'In progress'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={page}
            total={students.data.total}
            size={students.data.page_size}
            onChange={setPage}
          />
        </>
      )}
    </>
  );
}

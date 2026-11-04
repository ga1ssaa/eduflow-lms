import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Layers3, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import type { Level } from '../lib/types';
import {
  Badge,
  Empty,
  ErrorPanel,
  Loading,
  PageHeading,
  Pagination,
  usePage,
} from '../components/ui';
import type { FormEvent } from 'react';

export function CatalogPage() {
  const { params, setParams, page, setPage } = usePage();
  const rawLevel = params.get('level');
  const level = ['beginner', 'intermediate', 'advanced'].includes(
    rawLevel ?? '',
  )
    ? (rawLevel as Level)
    : undefined;
  const filters = {
    page,
    page_size: 12,
    search: params.get('search') || undefined,
    category: params.get('category') || undefined,
    level,
  };
  const query = useQuery({
    queryKey: ['catalog', filters],
    queryFn: ({ signal }) => api.catalog(filters, signal),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const key of ['search', 'category', 'level']) {
      const value = String(data.get(key) ?? '').trim();
      if (value) next.set(key, value);
    }
    setParams(next);
  };
  return (
    <>
      <PageHeading
        eyebrow="THE COURSE CATALOG"
        title="Make room for what’s next."
      >
        <p>Explore courses, build your skills, and learn at your own pace.</p>
      </PageHeading>
      <form
        className="filter-bar surface"
        onSubmit={submit}
        key={`${filters.search}-${filters.category}-${level}`}
      >
        <label className="search-field">
          <span>Search courses</span>
          <div className="input-icon">
            <Search size={18} aria-hidden="true" />
            <input
              name="search"
              maxLength={200}
              defaultValue={filters.search}
              placeholder="What would you like to learn?"
            />
          </div>
        </label>
        <label>
          <span>Category</span>
          <input
            name="category"
            maxLength={100}
            defaultValue={filters.category}
            placeholder="Any category"
          />
        </label>
        <label>
          <span>Level</span>
          <select name="level" defaultValue={level ?? ''}>
            <option value="">All levels</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <button className="button primary" type="submit">
          Find courses
        </button>
      </form>
      <div className="section-heading">
        <h2>Explore courses</h2>
        {query.data && (
          <span className="result-count">
            {query.data.total} courses available
          </span>
        )}
      </div>
      {query.isPending ? (
        <Loading label="Finding courses…" />
      ) : query.isError ? (
        <ErrorPanel error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.items.length === 0 ? (
            <Empty title="No courses found">
              <p>Try a different search or clear your filters.</p>
              <Link to="/courses" className="text-link">
                Clear filters
              </Link>
            </Empty>
          ) : (
            <div className="course-grid">
              {query.data.items.map((course) => (
                <article className="course-card surface" key={course.id}>
                  <div className="course-card-top">
                    <span className="course-icon">
                      <BookOpen size={24} aria-hidden="true" />
                    </span>
                    <Badge>{course.level}</Badge>
                  </div>
                  <p className="category-label">
                    {course.category || 'Course'}
                  </p>
                  <h3>
                    <Link to={`/courses/${course.slug}`}>{course.title}</Link>
                  </h3>
                  <p className="course-description">
                    {course.description ||
                      'Explore the course outline to see what you’ll learn.'}
                  </p>
                  <p className="instructor">By {course.instructor_name}</p>
                  <div className="course-card-bottom">
                    <span>
                      <Layers3 size={16} aria-hidden="true" />
                      {course.module_count} modules · {course.lesson_count}{' '}
                      lessons
                    </span>
                    <Link
                      to={`/courses/${course.slug}`}
                      aria-label={`View ${course.title}`}
                    >
                      <ArrowRight size={20} aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
          <Pagination
            page={page}
            size={query.data.page_size}
            total={query.data.total}
            onChange={setPage}
          />
        </>
      )}
    </>
  );
}
export function CoursePage() {
  const { slug = '' } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['public-course', slug],
    queryFn: ({ signal }) => api.publicCourse(slug, signal),
  });
  const enrollment = useMutation({
    mutationFn: (id: string) => api.enroll(id),
    onSuccess: async (_, id) => {
      await client.invalidateQueries({ queryKey: ['student', auth.user?.id] });
      navigate(`/learn/${id}`);
    },
  });
  if (query.isPending) return <Loading label="Loading course…" />;
  if (query.isError)
    return (
      <ErrorPanel error={query.error} retry={() => void query.refetch()} />
    );
  const c = query.data;
  return (
    <>
      <Link className="back-link" to="/courses">
        ← Back to catalog
      </Link>
      <div className="course-detail-layout">
        <section>
          <PageHeading eyebrow={c.category || 'COURSE'} title={c.title}>
            <p>{c.description || 'Review the curriculum below.'}</p>
          </PageHeading>
          <div className="course-metadata">
            <Badge>{c.level}</Badge>
            <span>By {c.instructor_name}</span>
            <span>{c.module_count} modules</span>
            <span>{c.lesson_count} lessons</span>
          </div>
          <section className="curriculum surface">
            <h2>What you’ll learn</h2>
            {c.modules.length ? (
              c.modules.map((module) => (
                <details key={module.id} open>
                  <summary>
                    {module.position}. {module.title}
                    <span>{module.lessons.length} lessons</span>
                  </summary>
                  <ol>
                    {module.lessons.map((lesson) => (
                      <li key={lesson.id}>
                        <BookOpen size={16} aria-hidden="true" />
                        <span>{lesson.title}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              ))
            ) : (
              <p>The curriculum is currently unavailable.</p>
            )}
          </section>
        </section>
        <aside className="enroll-card surface">
          <span className="course-icon large">
            <GraduationIcon />
          </span>
          <h2>Your next step starts here</h2>
          <p>Enroll to access the lessons and keep track of your progress.</p>
          {auth.status === 'loading' ? (
            <Loading label="Checking your session…" />
          ) : auth.error ? (
            <ErrorPanel
              error={auth.error}
              retry={() => void auth.retry().catch(() => undefined)}
            />
          ) : !auth.user ? (
            <>
              <Link
                className="button primary full-width"
                to={`/login?returnTo=${encodeURIComponent(`/courses/${slug}`)}`}
              >
                Sign in to enroll
              </Link>
              <Link
                className="text-link"
                to={`/register?returnTo=${encodeURIComponent(`/courses/${slug}`)}`}
              >
                Create an account
              </Link>
            </>
          ) : auth.user.role === 'student' ? (
            <button
              className="button primary full-width"
              disabled={enrollment.isPending}
              onClick={() => enrollment.mutate(c.id)}
            >
              {enrollment.isPending
                ? 'Opening your course…'
                : 'Enroll and start learning'}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : (
            <>
              <p className="small">
                Learning enrollment is available to student accounts.
              </p>
              <Link
                className="button secondary"
                to={
                  auth.user.role === 'admin'
                    ? '/admin/courses'
                    : '/instructor/courses'
                }
              >
                Go to workspace
              </Link>
            </>
          )}
          {enrollment.isError && (
            <ErrorPanel
              error={enrollment.error}
              retry={() => enrollment.mutate(c.id)}
            />
          )}
          <p className="small muted">
            Your progress is saved as you complete each lesson.
          </p>
        </aside>
      </div>
    </>
  );
}
function GraduationIcon() {
  return <BookOpen size={32} aria-hidden="true" />;
}

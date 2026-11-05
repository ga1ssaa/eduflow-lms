import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDown,
  BookOpen,
  ChevronDown,
  Search,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import type { Level } from '../lib/types';
import {
  Badge,
  Empty,
  ErrorPanel,
  Loading,
  PageHeading,
  usePage,
} from '../components/ui';
import type { FormEvent } from 'react';
import { useCatalogFeed, useCatalogSentinel } from '../hooks/useCatalogFeed';
import {
  CatalogHero,
  CatalogCourseCard,
  CatalogSkeletons,
  CatalogSections,
} from '../components/catalog/CatalogVisuals';
import '../catalog.css';
import { SelectControl } from '../components/SelectControl';
import { CatalogAnchor } from '../components/catalog/CatalogAnchor';

export function CatalogPage() {
  const { params, setParams } = usePage();
  const rawLevel = params.get('level');
  const level = ['beginner', 'intermediate', 'advanced'].includes(
    rawLevel ?? '',
  )
    ? (rawLevel as Level)
    : undefined;
  const filters = {
    search: params.get('search') || undefined,
    category: params.get('category') || undefined,
    level,
  };
  const {
    query,
    courses,
    total,
    hasCurrentCount,
    hasPreviousResults,
    loadMore,
  } = useCatalogFeed(filters);
  const sentinel = useCatalogSentinel({
    enabled: !!query.hasNextPage && !query.isError,
    isFetching: query.isFetching,
    isFetchNextPageError: query.isFetchNextPageError,
    fetchNextPage: loadMore,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ['search', 'category', 'level']) {
      const value = String(data.get(key) ?? '').trim();
      if (value) next.set(key, value);
    }
    setParams(next);
  };
  return (
    <div className="catalog-experience">
      <CatalogHero
        action={
          <CatalogAnchor className="button primary" hash="#courses">
            Explore courses <ArrowUpRight size={19} aria-hidden="true" />
          </CatalogAnchor>
        }
        secondaryAction={
          <CatalogAnchor className="button secondary" hash="#how-it-works">
            See how it works <ArrowRight size={18} aria-hidden="true" />
          </CatalogAnchor>
        }
      />
      <section
        id="courses"
        className="catalog-listing"
        aria-labelledby="catalog-heading"
      >
        <div className="catalog-results-heading" data-reveal>
          <div>
            <p className="catalog-kicker">FIND YOUR NEXT CHAPTER</p>
            <h2 id="catalog-heading">Curiosity looks good on you.</h2>
          </div>
          <p role="status" className="catalog-result-count">
            {hasCurrentCount
              ? `${total} courses available`
              : query.isPaused
                ? 'Waiting for connection…'
                : query.isFetching
                  ? 'Updating courses…'
                  : query.isError
                    ? 'Course total unavailable'
                    : ''}
          </p>
        </div>
        <form
          className="catalog-filter"
          onSubmit={submit}
          key={`${filters.search}-${filters.category}-${level}`}
          aria-label="Filter courses"
        >
          <label className="catalog-search">
            <span>Search courses</span>
            <div className="catalog-input-icon">
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
            <SelectControl
              name="level"
              aria-label="Level"
              defaultValue={level ?? ''}
            >
              <option value="">All levels</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </SelectControl>
          </label>
          <button className="button primary" type="submit">
            Find courses <Search size={16} aria-hidden="true" />
          </button>
        </form>
        {query.isPending ? (
          <div aria-label="Loading courses" role="status">
            <span className="sr-only">Finding courses…</span>
            <CatalogSkeletons count={6} />
          </div>
        ) : (
          <>
            {query.isError && (
              <div className="catalog-feedback">
                <ErrorPanel
                  error={query.error}
                  retry={
                    query.isFetchNextPageError
                      ? undefined
                      : () => void query.refetch()
                  }
                />
                {hasPreviousResults && (
                  <p className="catalog-previous-results">
                    Previously loaded results are shown below. The course total
                    could not be verified.
                  </p>
                )}
              </div>
            )}
            {courses.length > 0 ? (
              <div className="catalog-grid">
                {courses.map((course, index) => (
                  <CatalogCourseCard
                    key={course.id}
                    course={course}
                    index={index}
                  />
                ))}
              </div>
            ) : (
              !query.isError && (
                <div className="catalog-feedback">
                  <Empty title="No courses found">
                    <p>
                      {filters.search || filters.category || level
                        ? 'A different search might open a new door. Try another topic or clear your filters.'
                        : 'A new chapter is on its way. Published courses will appear here when they’re ready.'}
                    </p>
                    {(filters.search || filters.category || level) && (
                      <Link to="/courses#courses" className="text-link">
                        Clear filters
                      </Link>
                    )}
                  </Empty>
                </div>
              )
            )}
            {query.isFetchingNextPage && (
              <div role="status" aria-label="Loading more courses">
                <span className="sr-only">Loading more courses…</span>
                <CatalogSkeletons count={3} />
              </div>
            )}
            <div
              ref={sentinel}
              className="catalog-sentinel"
              aria-hidden="true"
            />
            {(query.hasNextPage || query.isFetchNextPageError) && (
              <div className="catalog-loadmore">
                <button
                  className="button secondary"
                  disabled={query.isFetching || query.isPaused}
                  onClick={() => void loadMore()}
                >
                  {query.isPaused
                    ? 'Waiting for connection…'
                    : query.isFetchingNextPage
                      ? 'Loading courses…'
                      : query.isFetchNextPageError
                        ? 'Retry loading more'
                        : 'Load more courses'}
                  <ArrowDown size={17} aria-hidden="true" />
                </button>
                <p>Keep exploring. Learn at your own pace.</p>
              </div>
            )}
            {!query.hasNextPage && courses.length > 0 && !query.isError && (
              <p className="catalog-end" role="status">
                You’re all caught up. A new skill starts with a little
                curiosity.
              </p>
            )}
          </>
        )}
      </section>
      <CatalogSections />
    </div>
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
      <header className="course-detail-hero">
        <div>
          <PageHeading eyebrow={c.category || 'COURSE'} title={c.title}>
            <p>{c.description || 'Review the curriculum below.'}</p>
          </PageHeading>
          <div className="course-metadata">
            <Badge>{c.level}</Badge>
            <span>By {c.instructor_name}</span>
            <span>{c.module_count} modules</span>
            <span>{c.lesson_count} lessons</span>
          </div>
        </div>
        <div className="course-detail-art" aria-hidden="true">
          <BookOpen size={88} strokeWidth={1} />
        </div>
      </header>
      <div className="course-detail-layout">
        <section
          className="curriculum surface"
          aria-labelledby="course-curriculum-title"
        >
          <h2 id="course-curriculum-title" data-reveal>
            What you’ll learn
          </h2>
          {c.modules.length ? (
            c.modules.map((module) => (
              <details key={module.id} open>
                <summary>
                  {module.position}. {module.title}
                  <span>{module.lessons.length} lessons</span>
                  <ChevronDown
                    className="curriculum-chevron"
                    size={18}
                    aria-hidden="true"
                  />
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
        <aside className="enroll-card surface">
          <span className="course-icon large">
            <GraduationIcon />
          </span>
          <h2 data-reveal>Your next step starts here</h2>
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

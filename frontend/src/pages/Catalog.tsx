import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDown,
  BookOpen,
  ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import type { Level, PublicCourseDetail } from '../lib/types';
import { isApiError } from '../lib/client';
import {
  Badge,
  Empty,
  ErrorPanel,
  Loading,
  PageHeading,
  usePage,
} from '../components/ui';
import { useCatalogFeed, useCatalogSentinel } from '../hooks/useCatalogFeed';
import { useCatalogAnchorRestoration } from '../hooks/useCatalogAnchorRestoration';
import {
  CatalogHero,
  CatalogCourseCard,
  CatalogSkeletons,
  CatalogSections,
} from '../components/catalog/CatalogVisuals';
import '../catalog.css';
import { CatalogFilters } from '../components/catalog/CatalogFilters';
import { CatalogAnchor } from '../components/catalog/CatalogAnchor';
import { Atmosphere } from '../components/Atmosphere';

export function CatalogPage() {
  const { params } = usePage();
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
  useCatalogAnchorRestoration(
    [
      courses.length,
      query.isPending,
      query.isFetchingNextPage,
      query.isError,
      query.isPaused,
      query.hasNextPage,
      hasPreviousResults,
      total,
    ].join(':'),
    query.isFetching && !query.isPaused,
    {
      pageCount: query.data?.pages.length ?? 0,
      hasNextPage: !!query.hasNextPage,
      fetchingNextPage: query.isFetchingNextPage,
      blocked: query.isError || query.isPaused,
    },
  );
  const sentinel = useCatalogSentinel({
    enabled: !!query.hasNextPage && !query.isError,
    isFetching: query.isFetching,
    isFetchNextPageError: query.isFetchNextPageError,
    fetchNextPage: loadMore,
  });
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
        <div className="catalog-results-heading" data-reveal="from-top">
          <div>
            <p className="catalog-kicker">FIND YOUR NEXT CHAPTER</p>
            <h2 id="catalog-heading">Curiosity looks good on you.</h2>
          </div>
          <p role="status" className="catalog-result-count">
            {hasCurrentCount
              ? `${total} ${total === 1 ? 'course' : 'courses'}${filters.search || filters.category || level ? (total === 1 ? ' matches your filters' : ' match your filters') : ' available'}`
              : query.isPaused
                ? 'Waiting for connection…'
                : query.isFetching
                  ? 'Updating courses…'
                  : query.isError
                    ? 'Course total unavailable'
                    : ''}
          </p>
        </div>
        <CatalogFilters />
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
  const query = useQuery({
    queryKey: ['public-course', slug],
    queryFn: ({ signal }) => api.publicCourse(slug, signal),
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
        <Atmosphere />
        <div className="course-detail-introduction">
          <PageHeading eyebrow={c.category || 'COURSE'} title={c.title}>
            <p>{c.description || 'Review the curriculum below.'}</p>
          </PageHeading>
          <div className="course-metadata">
            <Badge>{c.level}</Badge>
            <span className="course-detail-instructor">
              By {c.instructor_name}
            </span>
            <span>
              <BookOpen size={16} aria-hidden="true" />
              {c.module_count} modules · {c.lesson_count} lessons
            </span>
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
          <div className="course-curriculum-heading" data-reveal>
            <p className="eyebrow">THE LEARNING PATH</p>
            <h2 id="course-curriculum-title">What you’ll learn</h2>
            <p className="muted">
              {c.module_count} modules · {c.lesson_count} lessons, one step at a
              time.
            </p>
          </div>
          {c.modules.length ? (
            c.modules.map((module) => (
              <details key={module.id} open>
                <summary>
                  <span
                    className="course-module-number"
                    aria-label={`Module ${module.position}`}
                  >
                    {String(module.position).padStart(2, '0')}
                  </span>
                  <span className="course-module-title">{module.title}</span>
                  <span className="course-module-count">
                    {module.lessons.length} lessons
                  </span>
                  <ChevronDown
                    className="curriculum-chevron"
                    size={18}
                    aria-hidden="true"
                  />
                </summary>
                <ol>
                  {module.lessons.map((lesson, index) => (
                    <li key={lesson.id}>
                      <span className="course-lesson-number" aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span>{lesson.title}</span>
                      <BookOpen size={16} aria-hidden="true" />
                    </li>
                  ))}
                </ol>
              </details>
            ))
          ) : (
            <p>The curriculum is currently unavailable.</p>
          )}
        </section>
        <aside
          className="enroll-card surface"
          aria-labelledby="course-enrollment-title"
        >
          <span className="course-icon large">
            <GraduationIcon />
          </span>
          <p className="course-enrollment-kicker">MAKE ROOM FOR CURIOSITY</p>
          <h2 id="course-enrollment-title" data-reveal>
            Your next step starts here
          </h2>
          <p>Explore the course curriculum and choose your next step.</p>
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
            <StudentCourseAction
              key={`${auth.user.id}:${auth.epoch}:${c.id}`}
              course={c}
              userId={auth.user.id}
            />
          ) : auth.user.role === 'admin' ? (
            <Link
              className="button secondary full-width"
              to={`/admin/courses/${c.id}`}
            >
              Manage Course
            </Link>
          ) : (
            <InstructorCourseAction
              key={`${auth.user.id}:${auth.epoch}:${c.id}`}
              courseId={c.id}
              userId={auth.user.id}
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
function StudentCourseAction({
  course,
  userId,
}: {
  course: PublicCourseDetail;
  userId: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const active = useRef(true);
  const enrollmentPending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const access = useQuery({
    queryKey: ['student', userId, 'dashboard'],
    queryFn: ({ signal }) => api.dashboard(signal),
    enabled: !!userId && !!course.id,
    retry: false,
  });
  const enrollment = useMutation({
    mutationFn: () => api.enroll(course.id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['student', userId] });
      if (active.current) navigate(`/learn/${course.id}`);
    },
    onSettled: () => {
      enrollmentPending.current = false;
    },
  });
  const enroll = () => {
    if (enrollmentPending.current || enrollment.isPending) return;
    enrollmentPending.current = true;
    enrollment.mutate();
  };
  if (access.isPending) return <Loading label="Checking your enrollment…" />;
  if (access.isError)
    return (
      <ErrorPanel error={access.error} retry={() => void access.refetch()} />
    );
  const enrolledCourse = access.data.courses.find(
    (entry) => entry.course_id === course.id,
  );
  if (enrolledCourse) {
    const completed =
      enrolledCourse.is_completed ||
      (enrolledCourse.total_lessons > 0 &&
        enrolledCourse.completed_lessons >= enrolledCourse.total_lessons);
    const label = completed
      ? 'Review Course'
      : enrolledCourse.completed_lessons > 0
        ? 'Continue Learning'
        : 'Start Learning';
    return (
      <Link className="button primary full-width" to={`/learn/${course.id}`}>
        {label}
        <ArrowRight size={18} aria-hidden="true" />
      </Link>
    );
  }
  return (
    <>
      <button
        className="button primary full-width"
        disabled={enrollment.isPending}
        onClick={enroll}
      >
        {enrollment.isPending
          ? 'Opening your course…'
          : 'Enroll and Start Learning'}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      {enrollment.isError && (
        <ErrorPanel error={enrollment.error} retry={enroll} />
      )}
    </>
  );
}
function InstructorCourseAction({
  courseId,
  userId,
}: {
  courseId: string;
  userId: string;
}) {
  const access = useQuery({
    queryKey: ['author', userId, 'course', courseId],
    queryFn: ({ signal }) => api.managementCourse(courseId, false, signal),
    enabled: !!userId && !!courseId,
    retry: false,
  });
  if (access.isPending) return <Loading label="Checking course access…" />;
  if (
    access.isError &&
    !(isApiError(access.error) && [403, 404].includes(access.error.status))
  )
    return (
      <ErrorPanel error={access.error} retry={() => void access.refetch()} />
    );
  if (access.data?.instructor_id === userId && !access.isError)
    return (
      <Link
        className="button secondary full-width"
        to={`/instructor/courses/${courseId}`}
      >
        Manage Course
      </Link>
    );
  return (
    <>
      <p className="small">
        Learning enrollment is available to student accounts.
      </p>
      <Link className="button secondary" to="/instructor/courses">
        Go to workspace
      </Link>
    </>
  );
}
function GraduationIcon() {
  return <BookOpen size={32} aria-hidden="true" />;
}

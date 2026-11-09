import '../pages.css';
import '../learning.css';
import { Atmosphere } from '../components/Atmosphere';
import { LessonVideo } from '../components/LessonVideo';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Layers3,
  Check,
  CheckCircle2,
  LockKeyhole,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import type { StudentLessonRead } from '../lib/types';
import {
  Badge,
  Empty,
  ErrorPanel,
  Loading,
  PageHeading,
  Pagination,
  Progress,
  safeVideo,
  usePage,
} from '../components/ui';
export function LearningPage() {
  const { user } = useAuth();
  const { page, setPage } = usePage();
  const dashboard = useQuery({
    queryKey: ['student', user!.id, 'dashboard'],
    queryFn: ({ signal }) => api.dashboard(signal),
  });
  const courses = useQuery({
    queryKey: ['student', user!.id, 'courses', page],
    queryFn: ({ signal }) =>
      api.studentCourses({ page, page_size: 12 }, signal),
  });
  return (
    <div className="learning-page">
      <section className="learning-hero" data-reveal>
        <Atmosphere />
        <div className="learning-hero-copy">
          <PageHeading
            eyebrow="MY LEARNING"
            title={`Keep moving forward, ${user!.full_name.split(' ')[0]}.`}
          >
            <p>Every lesson is a step toward something new.</p>
          </PageHeading>
          <Link className="button learning-hero-action" to="/courses">
            Find a course
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <div className="learning-hero-art" aria-hidden="true">
          <span className="learning-art-orbit" />
          <span className="learning-art-sheet sheet-back" />
          <span className="learning-art-sheet sheet-front" />
          <div className="learning-art-book">
            <BookOpen size={86} strokeWidth={1} />
          </div>
          <span className="learning-art-square" />
        </div>
      </section>
      {dashboard.isPending ? (
        <Loading label="Loading your overview…" />
      ) : dashboard.isError ? (
        <ErrorPanel
          error={dashboard.error}
          retry={() => void dashboard.refetch()}
        />
      ) : (
        <div
          className="stats-grid learning-summary"
          aria-label="Your learning overview"
        >
          <div
            className="stat surface learning-stat"
            data-reveal
            data-reveal-index={0}
          >
            <div className="learning-stat-top">
              <span>Enrolled courses</span>
              <BookOpen className="stat-symbol" size={22} aria-hidden="true" />
            </div>
            <strong>{dashboard.data.total_enrolled_courses}</strong>
            <p className="learning-stat-caption">
              All courses in your personal library.
            </p>
          </div>
          <div
            className="stat surface learning-stat"
            data-reveal
            data-reveal-index={1}
          >
            <div className="learning-stat-top">
              <span>In progress</span>
              <Layers3 className="stat-symbol" size={22} aria-hidden="true" />
            </div>
            <strong>{dashboard.data.in_progress_courses}</strong>
            <p className="learning-stat-caption">
              Courses with lessons left to explore.
            </p>
          </div>
          <div
            className="stat surface learning-stat"
            data-reveal
            data-reveal-index={2}
          >
            <div className="learning-stat-top">
              <span>Completed</span>
              <CheckCircle2
                className="stat-symbol"
                size={22}
                aria-hidden="true"
              />
            </div>
            <strong>{dashboard.data.completed_courses}</strong>
            <p className="learning-stat-caption">
              Finished courses you can revisit.
            </p>
          </div>
        </div>
      )}
      <section
        className="learning-library"
        aria-labelledby="learning-library-heading"
      >
        <div className="section-heading learning-library-heading">
          <div>
            <p className="learning-section-kicker">YOUR PERSONAL LIBRARY</p>
            <h2 id="learning-library-heading">Your courses</h2>
          </div>
          <Link className="text-link" to="/courses">
            Explore catalog <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {courses.isPending ? (
          <Loading label="Loading your courses…" />
        ) : courses.isError ? (
          <ErrorPanel
            error={courses.error}
            retry={() => void courses.refetch()}
          />
        ) : (
          <>
            {courses.data.items.length === 0 ? (
              <div className="learning-empty-state" data-reveal>
                <div className="learning-empty-art" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <BookOpen size={48} strokeWidth={1} />
                  <i />
                </div>
                <Empty
                  title={
                    page === 1
                      ? 'Your learning journey starts here'
                      : 'No courses on this page'
                  }
                >
                  <p>
                    {page === 1
                      ? 'Explore the catalog and enroll in a course that interests you.'
                      : 'Go back to see your enrolled courses.'}
                  </p>
                  <Link className="button primary" to="/courses">
                    Browse courses
                  </Link>
                </Empty>
              </div>
            ) : (
              <div className="course-grid">
                {courses.data.items.map((c, index) => (
                  <article
                    className="course-card surface learning-course-card"
                    key={c.enrollment_id}
                    data-reveal
                    data-reveal-index={index}
                  >
                    <div className="learning-course-cover" data-level={c.level}>
                      <span>{c.level}</span>
                      <div aria-hidden="true">
                        <i />
                        <i />
                        <BookOpen size={40} strokeWidth={1} />
                      </div>
                    </div>
                    <div className="course-card-top">
                      <span className="course-icon">
                        <BookOpen aria-hidden="true" />
                      </span>
                      <Badge success={c.is_completed}>
                        {c.is_available
                          ? c.is_completed
                            ? 'Completed'
                            : 'In progress'
                          : 'Unavailable'}
                      </Badge>
                    </div>
                    <p className="category-label">{c.category || 'Course'}</p>
                    <h3>{c.title}</h3>
                    <p className="instructor">By {c.instructor_name}</p>
                    <p className="learning-enrollment-date">
                      Enrolled{' '}
                      {new Date(c.enrolled_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                    <Progress
                      completed={c.completed_lessons}
                      total={c.total_lessons}
                      percent={c.progress_percentage}
                      done={c.is_completed}
                    />
                    <div className="learning-card-bottom">
                      {c.is_available ? (
                        <Link
                          className="button secondary full-width"
                          to={`/learn/${c.course_id}`}
                        >
                          {c.is_completed
                            ? 'Review course'
                            : 'Continue learning'}
                          <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                      ) : (
                        <p className="small unavailable">
                          <LockKeyhole size={16} aria-hidden="true" />
                          This course is currently unavailable. Your progress is
                          saved.
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <Pagination
              page={page}
              total={courses.data.total}
              size={courses.data.page_size}
              onChange={setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}
export function LessonPage() {
  const { courseId = '' } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const course = useQuery({
    queryKey: ['student', user!.id, 'course', courseId],
    queryFn: ({ signal }) => api.studentCourse(courseId, signal),
  });
  const lessons = course.data?.modules.flatMap((m) => m.lessons) ?? [];
  const requested = params.get('lesson');
  const selected = lessons.find((l) => l.id === requested) ?? lessons[0];
  const lessonKey = ['student', user!.id, 'lesson', selected?.id];
  const lesson = useQuery({
    queryKey: lessonKey,
    queryFn: ({ signal }) => api.lesson(selected!.id, signal),
    enabled: !!selected,
  });
  const completion = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      completed ? api.incompleteLesson(id) : api.completeLesson(id),
    onSuccess: async (data, variables) => {
      client.setQueryData<StudentLessonRead>(
        ['student', user!.id, 'lesson', variables.id],
        (previous) =>
          previous
            ? {
                ...previous,
                is_completed: data.is_completed,
                completed_at: data.completed_at,
              }
            : previous,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['student', user!.id] }),
        client.invalidateQueries({ queryKey: ['author'] }),
        client.invalidateQueries({ queryKey: ['admin'] }),
      ]);
    },
  });
  const selectLesson = (id: string) => {
    completion.reset();
    setParams({ lesson: id });
  };
  if (course.isPending) return <Loading label="Loading your course…" />;
  if (course.isError)
    return (
      <ErrorPanel error={course.error} retry={() => void course.refetch()} />
    );
  const c = course.data;
  const index = lessons.findIndex((l) => l.id === selected?.id);
  const video = safeVideo(lesson.data?.video_url);
  return (
    <div className="lesson-experience">
      <Link to="/learning" className="back-link">
        ← My learning
      </Link>
      <header className="lesson-heading product-player-intro">
        <Atmosphere />
        <div className="lesson-course-heading">
          <p className="eyebrow">YOUR CLASSROOM</p>
          <h1>{c.title}</h1>
          <p className="lesson-course-context">
            {c.modules.length} modules <span aria-hidden="true">·</span>{' '}
            {c.total_lessons} lessons
          </p>
        </div>
        <Badge success={c.is_completed}>
          {c.is_completed ? 'Course completed' : 'In progress'}
        </Badge>
      </header>
      <div className="player-layout">
        <aside className="lesson-sidebar surface">
          <p className="player-sidebar-kicker">YOUR LEARNING PATH</p>
          <h2>Course content</h2>
          <Progress
            completed={c.completed_lessons}
            total={c.total_lessons}
            percent={c.progress_percentage}
            done={c.is_completed}
          />
          <nav aria-label="Course lessons">
            {c.modules.map((m) => (
              <div key={m.id} className="sidebar-module">
                <h3>
                  <span className="lesson-module-number">{m.position}.</span>
                  <span>{m.title}</span>
                </h3>
                <ol>
                  {m.lessons.map((l, lessonIndex) => (
                    <li key={l.id}>
                      <button
                        className={`lesson-nav ${l.id === selected?.id ? 'selected' : ''}`}
                        aria-current={
                          l.id === selected?.id ? 'page' : undefined
                        }
                        onClick={() => selectLesson(l.id)}
                      >
                        <span className="lesson-nav-index" aria-hidden="true">
                          {lessonIndex + 1}
                        </span>
                        <span className="lesson-nav-title">{l.title}</span>
                        {l.id === selected?.id && (
                          <ArrowRight size={15} aria-hidden="true" />
                        )}
                        {l.id === selected?.id && lesson.data?.is_completed && (
                          <Check size={16} aria-label="Completed" />
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </nav>
        </aside>
        <section className="lesson-content surface" aria-label="Lesson content">
          {!selected ? (
            <Empty title="No lessons available">
              <p>Check back when course content is available.</p>
            </Empty>
          ) : lesson.isPending ? (
            <Loading label="Loading lesson…" />
          ) : lesson.isError ? (
            <ErrorPanel
              error={lesson.error}
              retry={() => void lesson.refetch()}
            />
          ) : (
            <>
              <div className="section-heading">
                <div className="lesson-position-label">
                  <span className="lesson-sequence">
                    Lesson {index + 1} of {lessons.length}
                  </span>
                  <span className="lesson-module-context">
                    {lesson.data.module_title}
                  </span>
                </div>
                {lesson.data.is_completed && <Badge success>Completed</Badge>}
              </div>
              <h2>{lesson.data.title}</h2>
              <LessonVideo
                url={lesson.data.video_url}
                title={lesson.data.title}
              />
              <div className="lesson-text">
                {lesson.data.content ||
                  (video
                    ? 'Watch the video to complete this lesson.'
                    : 'This lesson has no text content.')}
              </div>
              {completion.isError && <ErrorPanel error={completion.error} />}
              <div className="completion-row">
                <button
                  className={`button ${lesson.data.is_completed ? 'secondary' : 'primary'}`}
                  disabled={completion.isPending}
                  onClick={() =>
                    completion.mutate({
                      id: lesson.data.id,
                      completed: lesson.data.is_completed,
                    })
                  }
                >
                  <CheckCircle2 size={18} aria-hidden="true" />
                  {completion.isPending
                    ? 'Saving progress…'
                    : lesson.data.is_completed
                      ? 'Mark as incomplete'
                      : 'Mark as complete'}
                </button>
                <span role="status" className="small muted">
                  {completion.isSuccess
                    ? 'Progress saved'
                    : 'Your progress saves to your account.'}
                </span>
              </div>
              <nav className="lesson-pagination" aria-label="Lesson navigation">
                <button
                  className="button secondary"
                  aria-label="Previous lesson"
                  disabled={index <= 0}
                  onClick={() => selectLesson(lessons[index - 1].id)}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  <span>
                    <span className="lesson-navigation-label">
                      Previous lesson
                    </span>
                    <span className="lesson-navigation-title">
                      {lessons[index - 1]?.title || 'Start of course'}
                    </span>
                  </span>
                </button>
                <button
                  className="button secondary"
                  aria-label="Next lesson"
                  disabled={index >= lessons.length - 1}
                  onClick={() => selectLesson(lessons[index + 1].id)}
                >
                  <span>
                    <span className="lesson-navigation-label">Next lesson</span>
                    <span className="lesson-navigation-title">
                      {lessons[index + 1]?.title || 'End of course'}
                    </span>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </nav>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

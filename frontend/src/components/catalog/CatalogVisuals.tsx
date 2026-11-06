import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CatalogAnchor } from './CatalogAnchor';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Layers3,
  MoveUpRight,
} from 'lucide-react';
import type { PublicCourseSummary } from '../../lib/types';
import '../../catalog.css';
import { ThemeTransition } from '../../theme/ThemeTransition';

export function CatalogHero({
  action,
  secondaryAction,
}: {
  action: ReactNode;
  secondaryAction: ReactNode;
}) {
  return (
    <section className="catalog-hero" aria-labelledby="catalog-hero-title">
      <div className="catalog-hero-pixels" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <ThemeTransition name="catalog" className="catalog-hero-inner">
        <div className="catalog-hero-copy" data-reveal>
          <p className="catalog-kicker">
            <span />A little curiosity. A whole new direction.
          </p>
          <h1 id="catalog-hero-title">
            Build the skills.
            <br />
            Shape <span>what’s next.</span>
          </h1>
          <p className="catalog-hero-description">
            Big ambitions start with a small step. Find your next course, make
            it your own, and keep moving forward.
          </p>
          <div className="catalog-hero-actions">
            {action}
            {secondaryAction}
          </div>
          <div className="catalog-hero-principles">
            <span>
              <BookOpen size={15} aria-hidden="true" />
              Learn at your pace
            </span>
            <span>
              <Check size={15} aria-hidden="true" />
              Progress that stays with you
            </span>
          </div>
        </div>
        <div className="catalog-sculpture" aria-hidden="true">
          <div className="catalog-orbit orbit-one" />
          <div className="catalog-orbit orbit-two" />
          <div className="catalog-sculpture-label">
            THE NEXT CHAPTER
            <br />
            <span>IS YOURS.</span>
          </div>
          <div className="catalog-path-object">
            <div className="catalog-path-shadow" />
            <div className="catalog-path-step step-one">
              <span />
            </div>
            <div className="catalog-path-step step-two">
              <span />
            </div>
            <div className="catalog-path-step step-three">
              <span />
            </div>
            <div className="catalog-path-step step-four">
              <MoveUpRight strokeWidth={1.2} />
            </div>
            <div className="catalog-path-spark" />
          </div>
          <span className="catalog-sculpture-coordinate">
            A NEW PERSPECTIVE
          </span>
        </div>
      </ThemeTransition>
      <div className="catalog-hero-bottom" aria-hidden="true">
        <span>FOLLOW YOUR CURIOSITY</span>
        <span>SCROLL TO EXPLORE ↓</span>
      </div>
    </section>
  );
}
function visualVariant(value: string) {
  let hash = 0;
  for (const character of value)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 4;
}
export function CatalogCourseCard({
  course,
  index,
}: {
  course: PublicCourseSummary;
  index: number;
}) {
  const variant = visualVariant(`${course.category}:${course.title}`);
  return (
    <article
      className={`catalog-course-card catalog-cover-${variant}`}
      data-reveal
      data-reveal-index={index}
    >
      <div className="catalog-course-cover" aria-hidden="true">
        <span className="catalog-cover-word">
          {course.category || 'Explore'}
        </span>
        <div className="catalog-cover-art">
          <i />
          <i />
          <i />
          <i />
        </div>
        <span className="catalog-cover-mark">
          <ArrowUpRight size={22} />
        </span>
      </div>
      <div className="catalog-course-body">
        <div className="catalog-course-tags">
          <span className="catalog-course-category">
            {course.category || 'Course'}
          </span>
          <span className="catalog-course-level">{course.level}</span>
        </div>
        <h3>
          <Link to={`/courses/${course.slug}`}>{course.title}</Link>
        </h3>
        <p className="catalog-course-description">
          {course.description ||
            'Discover the curriculum and take your next step.'}
        </p>
        <p className="catalog-course-instructor">
          By <strong>{course.instructor_name}</strong>
        </p>
        <div className="catalog-course-footer">
          <span>
            <Layers3 size={15} aria-hidden="true" />
            {course.module_count} modules <span aria-hidden="true">·</span>{' '}
            {course.lesson_count} lessons
          </span>
          <Link
            to={`/courses/${course.slug}`}
            className="catalog-course-arrow"
            aria-label={`View ${course.title}`}
          >
            <ArrowUpRight size={21} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
export function CatalogSkeletons({ count = 6 }: { count?: number }) {
  return (
    <div className="catalog-skeletons">
      <p className="sr-only" role="status">
        Finding courses…
      </p>
      <div className="catalog-grid" aria-hidden="true">
        {Array.from(
          { length: Math.max(1, Math.min(12, count)) },
          (_, index) => (
            <div className="catalog-course-card catalog-skeleton" key={index}>
              <div className="catalog-course-cover" />
              <div className="catalog-course-body">
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
export function CatalogSections() {
  return (
    <>
      <section
        className="catalog-how"
        id="how-it-works"
        aria-labelledby="catalog-how-title"
      >
        <div className="catalog-section-intro" data-reveal>
          <p className="catalog-section-kicker">A CLEAR PATH FORWARD</p>
          <h2 id="catalog-how-title">
            Less friction.
            <br />
            <span>More forward.</span>
          </h2>
          <p>
            From your first spark of interest to your next completed lesson.
            Keep your attention on what you came here to learn.
          </p>
        </div>
        <ol className="catalog-steps">
          <li data-reveal data-reveal-index={0}>
            <span className="catalog-step-number">01</span>
            <div>
              <h3>Find your starting point.</h3>
              <p>
                Explore the catalog. Review the curriculum and choose a course
                that speaks to your curiosity.
              </p>
            </div>
          </li>
          <li data-reveal data-reveal-index={1}>
            <span className="catalog-step-number">02</span>
            <div>
              <h3>Make space to learn.</h3>
              <p>
                Create a student account, enroll, and work through the lessons
                at your own pace.
              </p>
            </div>
          </li>
          <li data-reveal data-reveal-index={2}>
            <span className="catalog-step-number">03</span>
            <div>
              <h3>See yourself move forward.</h3>
              <p>
                Mark lessons complete and pick up where you left off. Your
                course progress stays in one place.
              </p>
            </div>
          </li>
        </ol>
      </section>
      <section
        data-reveal
        className="catalog-teach"
        id="for-instructors"
        aria-labelledby="catalog-teach-title"
      >
        <div>
          <p className="catalog-section-kicker">FOR THE KNOWLEDGE SHARERS</p>
          <h2 id="catalog-teach-title">
            You know something.
            <br />
            <span>Make it someone’s next step.</span>
          </h2>
          <p>
            Give your expertise a clear structure. Organize modules, build
            lessons, and publish when your course is ready.
          </p>
          <Link
            className="button catalog-teach-action"
            to="/instructor/courses"
          >
            Your instructor workspace
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
          <p className="catalog-teach-note">
            For accounts with instructor or administrator access.
          </p>
        </div>
        <div className="catalog-teach-art" aria-hidden="true">
          <span />
          <span />
          <span />
          <BookOpen size={72} strokeWidth={1} />
        </div>
      </section>
      <section
        data-reveal
        className="catalog-about"
        id="about"
        aria-labelledby="catalog-about-title"
      >
        <p className="catalog-section-kicker">THIS IS EDUFLOW</p>
        <h2 id="catalog-about-title">
          A little more clarity.
          <br />A lot more possibility.
        </h2>
        <p>
          A focused place to share knowledge and build skills. Real courses,
          clear learning paths, and room to keep growing.
        </p>
        <CatalogAnchor className="catalog-about-link" hash="#courses">
          Find your next course
          <ArrowRight size={18} aria-hidden="true" />
        </CatalogAnchor>
      </section>
    </>
  );
}

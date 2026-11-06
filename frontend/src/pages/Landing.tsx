import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Compass,
  Layers3,
  ListChecks,
  Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { Empty, ErrorPanel, Loading } from '../components/ui';
import { Atmosphere } from '../components/Atmosphere';
import { ThemeTransition } from '../theme/ThemeTransition';

export function LandingPage() {
  const { user } = useAuth();
  const featured = useQuery({
    queryKey: ['catalog', 'featured'],
    queryFn: ({ signal }) => api.catalog({ page: 1, page_size: 3 }, signal),
  });
  const destination = user
    ? user.role === 'student'
      ? '/learning'
      : user.role === 'admin'
        ? '/admin'
        : '/instructor'
    : '/register';
  return (
    <div className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <Atmosphere className="landing-pixels" />
        <ThemeTransition name="home">
          <p className="product-kicker">
            <Sparkles size={15} aria-hidden="true" /> A LITTLE CURIOSITY GOES A
            LONG WAY
          </p>
          <h1 id="landing-title" data-reveal>
            Your next chapter.
            <br />
            <em>Make it a good one.</em>
          </h1>
          <p className="landing-description" data-reveal>
            A place to follow your curiosity, build something new, and see how
            far you’ve come. Learning, with a little more flow.
          </p>
          <div className="actions">
            <Link className="button accent" to={destination}>
              {user ? 'Open your workspace' : 'Find your starting point'}
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
            <Link className="button hero-secondary" to="/courses">
              Explore courses
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <div className="landing-art" aria-hidden="true">
            <div className="landing-art-sheet sheet-back" />
            <div className="landing-art-sheet sheet-middle" />
            <div className="landing-art-book">
              <BookOpen size={56} strokeWidth={1.25} />
            </div>
            <span>DISCOVER · LEARN · GROW</span>
          </div>
        </ThemeTransition>
      </section>
      <section
        className="landing-featured product-section"
        aria-labelledby="featured-title"
      >
        <div className="section-heading" data-reveal>
          <div>
            <p className="product-kicker">OPEN A NEW DOOR</p>
            <h2 id="featured-title">A fresh perspective starts here.</h2>
          </div>
          <Link className="text-link" to="/courses">
            Explore all courses
            <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </div>
        {featured.isPending ? (
          <Loading label="Loading featured courses…" />
        ) : featured.isError ? (
          <ErrorPanel
            error={featured.error}
            retry={() => void featured.refetch()}
          />
        ) : featured.data.items.length === 0 ? (
          <Empty title="Something new is on its way">
            <p>Published courses will appear here when they’re ready.</p>
            <Link className="text-link" to="/courses">
              Visit the catalog
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Empty>
        ) : (
          <div className="featured-grid">
            {featured.data.items.map((c, index) => (
              <article
                data-reveal
                data-reveal-index={index}
                className={`featured-card surface featured-variant-${c.title.charCodeAt(0) % 3}`}
                key={c.id}
              >
                <div className="featured-cover" aria-hidden="true">
                  <span>{c.category || 'Discover'}</span>
                  <BookOpen size={72} strokeWidth={1} />
                </div>
                <div className="featured-body">
                  <div className="featured-tags">
                    <span>{c.category || 'Course'}</span>
                    <span className="badge">{c.level}</span>
                  </div>
                  <h3>
                    <Link to={`/courses/${c.slug}`}>{c.title}</Link>
                  </h3>
                  <p>
                    {c.description ||
                      'Explore the curriculum and take your next step.'}
                  </p>
                  <span className="featured-instructor">
                    By {c.instructor_name}
                  </span>
                  <div className="featured-bottom">
                    <span>
                      <Layers3 size={16} aria-hidden="true" />
                      {c.lesson_count} lessons
                    </span>
                    <Link
                      className="icon-button"
                      aria-label={`View ${c.title}`}
                      to={`/courses/${c.slug}`}
                    >
                      <ArrowUpRight size={19} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section
        id="how-it-works"
        className="landing-how product-section"
        aria-labelledby="landing-how-title"
      >
        <div data-reveal>
          <p className="product-kicker">LESS FRICTION. MORE FORWARD.</p>
          <h2 id="landing-how-title">
            A clear path.
            <br />
            <em>Your own pace.</em>
          </h2>
          <p>Spend your attention on what you came here to learn.</p>
        </div>
        <ol>
          {[
            {
              icon: Compass,
              title: 'Follow your curiosity.',
              text: 'Explore published courses and review the curriculum before choosing your next step.',
            },
            {
              icon: BookOpen,
              title: 'Make space to learn.',
              text: 'Enroll with a student account and work through the lessons at a pace that suits you.',
            },
            {
              icon: ListChecks,
              title: 'See yourself move forward.',
              text: 'Complete lessons, track your progress, and pick up where you left off.',
            },
          ].map(({ icon: Icon, title, text }, i) => (
            <li key={title} data-reveal data-reveal-index={i}>
              <span className="landing-step-icon">
                <Icon size={22} aria-hidden="true" />
              </span>
              <div>
                <span className="small muted">0{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section
        id="for-instructors"
        className="landing-teach product-section"
        aria-labelledby="landing-teach-title"
      >
        <div className="surface" data-reveal>
          <div>
            <p className="product-kicker">FOR THE KNOWLEDGE SHARERS</p>
            <h2 id="landing-teach-title">
              You know something.
              <br />
              <em>Make it someone’s next step.</em>
            </h2>
            <p>
              Give your expertise a clear structure. Build courses, organize
              lessons, and follow your learners’ progress.
            </p>
            <Link className="button primary" to="/instructor">
              Your instructor workspace
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
            <p className="small muted">
              For accounts with instructor or administrator access.
            </p>
          </div>
          <BookOpen
            className="landing-teach-symbol"
            size={120}
            strokeWidth={0.75}
            aria-hidden="true"
          />
        </div>
      </section>
      <section id="about" className="landing-about product-section" data-reveal>
        <p className="product-kicker">THIS IS EDUFLOW</p>
        <h2>
          A little more clarity.
          <br />
          <em>A lot more possibility.</em>
        </h2>
        <p>
          Real courses. Clear learning paths. One place to share what you know
          and build the skills you want.
        </p>
        <Link className="button accent" to={destination}>
          {user ? 'Continue your journey' : 'Get started'}
          <ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}

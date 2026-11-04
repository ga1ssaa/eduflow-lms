import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  GraduationCap,
  Menu,
} from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import type { Role } from './lib/types';
import { ErrorPanel, Loading } from './components/ui';
import { ThemeControl } from './theme/ThemeControl';
import { CatalogAnchor } from './components/catalog/CatalogAnchor';
import { CatalogPage, CoursePage } from './pages/Catalog';
import { AuthPage } from './pages/Auth';
import { LearningPage, LessonPage } from './pages/Learning';
import { WorkspacePage, ManagementPage } from './pages/Workspace';
import { OverviewPage } from './pages/Overview';
import { CourseEditorPage } from './pages/CourseEditor';
import { CurriculumPage } from './pages/Curriculum';
import {
  discardAuthoringChanges,
  getAuthoringDirty,
} from './components/authoring';
import './styles.css';

function Protected({
  roles,
  children,
}: {
  roles: Role[];
  children: ReactNode;
}) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading')
    return <Loading label="Checking your session…" />;
  if (auth.error)
    return (
      <ErrorPanel
        error={auth.error}
        retry={() => void auth.retry().catch(() => undefined)}
      />
    );
  if (!auth.user)
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  if (!roles.includes(auth.user.role))
    return (
      <section className="empty">
        <h1>This page is for a different role</h1>
        <p>
          You are signed in as {auth.user.role}. Choose your workspace to
          continue.
        </p>
        <Link
          className="button primary"
          to={
            auth.user.role === 'student'
              ? '/learning'
              : auth.user.role === 'admin'
                ? '/admin'
                : '/instructor'
          }
        >
          Go to my workspace
        </Link>
      </section>
    );
  return children;
}
function CatalogFrame({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return active ? (
    <div className="catalog-shell">{children}</div>
  ) : (
    <>{children}</>
  );
}
function Shell() {
  const auth = useAuth();
  const location = useLocation();
  const isCatalog = location.pathname === '/courses';
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!isCatalog || !location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    target?.scrollIntoView({ block: 'start' });
    if (target?.id === 'main') target.focus({ preventScroll: true });
  }, [isCatalog, location.hash, location.key]);
  useEffect(() => {
    if (!isCatalog) return;
    const update = () => setCompact(window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [isCatalog]);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const titles: Record<string, string> = {
      '/courses': 'Course catalog',
      '/learning': 'My learning',
      '/login': 'Sign in',
      '/register': 'Create account',
      '/instructor/courses': 'My courses',
      '/admin/courses': 'Course moderation',
      '/instructor': 'Instructor dashboard',
      '/admin': 'Admin dashboard',
      '/instructor/courses/new': 'Create course',
    };
    document.title = `${titles[location.pathname] ?? (location.pathname.startsWith('/learn/') ? 'Classroom' : 'Course')} · EduFlow`;
  }, [location.pathname]);
  const close = () => setOpen(false);
  const closeWithFocus = () => {
    setOpen(false);
    mobileTrigger.current?.focus();
  };
  const nav = isCatalog ? (
    <>
      <CatalogAnchor hash="#courses" onClick={close}>
        Explore Courses
      </CatalogAnchor>
      <CatalogAnchor hash="#how-it-works" onClick={close}>
        How It Works
      </CatalogAnchor>
      <CatalogAnchor hash="#for-instructors" onClick={close}>
        For Instructors
      </CatalogAnchor>
      <CatalogAnchor hash="#about" onClick={close}>
        About
      </CatalogAnchor>
    </>
  ) : (
    <>
      <NavLink to="/courses" onClick={close}>
        Catalog
      </NavLink>
      {auth.user?.role === 'student' && (
        <NavLink to="/learning" onClick={close}>
          My learning
        </NavLink>
      )}
      {auth.user && ['instructor', 'admin'].includes(auth.user.role) && (
        <>
          <NavLink to="/instructor" end onClick={close}>
            Overview
          </NavLink>
          <NavLink to="/instructor/courses" onClick={close}>
            My courses
          </NavLink>
        </>
      )}
      {auth.user?.role === 'admin' && (
        <NavLink to="/admin" onClick={close}>
          Administration
        </NavLink>
      )}
    </>
  );
  const logout = async () => {
    if (getAuthoringDirty()) {
      if (!window.confirm('Sign out and discard your unsaved changes?')) return;
      discardAuthoringChanges();
    }
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await auth.logout();
    } catch (e) {
      setLogoutError(e);
    } finally {
      setLoggingOut(false);
    }
  };
  return (
    <CatalogFrame active={isCatalog}>
      {isCatalog ? (
        <CatalogAnchor className="skip-link" hash="#main">
          Skip to content
        </CatalogAnchor>
      ) : (
        <a className="skip-link" href="#main">
          Skip to content
        </a>
      )}
      <header
        className={
          isCatalog
            ? `site-header catalog-page-header${compact ? ' is-compact' : ''}`
            : 'site-header'
        }
      >
        <div className="header-inner">
          <Link to="/courses" className="brand" aria-label="EduFlow home">
            <span className="brand-mark">
              <GraduationCap size={24} aria-hidden="true" />
            </span>
            EduFlow
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            {nav}
          </nav>
          <div className="header-actions">
            <ThemeControl />
            {loggingOut ? (
              <span className="small muted" role="status">
                Signing out…
              </span>
            ) : auth.user ? (
              <details
                className="account"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.currentTarget.open = false;
                    e.currentTarget.querySelector('summary')?.focus();
                  }
                }}
              >
                <summary
                  aria-label="Account menu"
                  className={isCatalog ? 'catalog-account-trigger' : undefined}
                >
                  <span className="avatar">
                    {auth.user.full_name
                      .split(/\s+/)
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </span>
                  {isCatalog && (
                    <ChevronDown
                      className="catalog-account-chevron"
                      size={16}
                      aria-hidden="true"
                    />
                  )}
                </summary>
                <div className="account-panel">
                  <strong>{auth.user.full_name}</strong>
                  <span>{auth.user.email}</span>
                  <span className="role-label">{auth.user.role}</span>
                  {isCatalog && (
                    <Link
                      className="catalog-role-link"
                      to={
                        auth.user.role === 'student'
                          ? '/learning'
                          : auth.user.role === 'admin'
                            ? '/admin'
                            : '/instructor'
                      }
                    >
                      Go to my workspace
                    </Link>
                  )}
                  <button
                    className="button secondary"
                    disabled={loggingOut}
                    onClick={() => void logout()}
                  >
                    {loggingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </details>
            ) : auth.status === 'loading' ? (
              <span className="small muted">Checking session…</span>
            ) : auth.error ? (
              <button
                className="button secondary"
                onClick={() => void auth.retry().catch(() => undefined)}
              >
                {auth.error.name === 'LogoutRevocationError'
                  ? 'Retry sign out'
                  : 'Retry session'}
              </button>
            ) : (
              <Link className="button primary" to="/login">
                Sign in
              </Link>
            )}
            {isCatalog && !auth.error && auth.status !== 'loading' && (
              <Link
                className="button catalog-start"
                to={
                  auth.user
                    ? auth.user.role === 'student'
                      ? '/learning'
                      : auth.user.role === 'admin'
                        ? '/admin'
                        : '/instructor'
                    : '/register'
                }
              >
                {auth.user ? 'Workspace' : 'Get Started'}{' '}
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
            )}
            <button
              ref={mobileTrigger}
              className="icon-button mobile-toggle"
              aria-label={open ? 'Close navigation' : 'Open navigation'}
              aria-expanded={open}
              aria-controls="mobile-navigation"
              onClick={() => setOpen(!open)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeWithFocus();
              }}
            >
              <Menu aria-hidden="true" />
            </button>
          </div>
        </div>
        {open && (
          <nav
            className="mobile-nav"
            id="mobile-navigation"
            aria-label="Mobile navigation"
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeWithFocus();
            }}
          >
            {nav}
            {isCatalog && (
              <Link
                onClick={close}
                to={
                  auth.user
                    ? auth.user.role === 'student'
                      ? '/learning'
                      : auth.user.role === 'admin'
                        ? '/admin'
                        : '/instructor'
                    : '/register'
                }
              >
                {auth.user ? 'Go to workspace' : 'Get Started'}
              </Link>
            )}
          </nav>
        )}
      </header>
      <main
        id="main"
        className={isCatalog ? 'catalog-main' : 'main-container'}
        tabIndex={-1}
      >
        {logoutError != null && (
          <ErrorPanel error={logoutError} retry={() => void logout()} />
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/courses" replace />} />
          <Route path="/courses" element={<CatalogPage />} />
          <Route path="/courses/:slug" element={<CoursePage />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage register />} />
          <Route
            path="/learning"
            element={
              <Protected roles={['student']}>
                <LearningPage />
              </Protected>
            }
          />
          <Route
            path="/learn/:courseId"
            element={
              <Protected roles={['student']}>
                <LessonPage />
              </Protected>
            }
          />
          <Route
            path="/instructor"
            element={
              <Protected roles={['instructor', 'admin']}>
                <OverviewPage />
              </Protected>
            }
          />
          <Route
            path="/instructor/courses/new"
            element={
              <Protected roles={['instructor', 'admin']}>
                <CourseEditorPage create />
              </Protected>
            }
          />
          <Route
            path="/instructor/courses/:courseId/edit"
            element={
              <Protected roles={['instructor', 'admin']}>
                <CourseEditorPage />
              </Protected>
            }
          />
          <Route
            path="/instructor/courses/:courseId/curriculum"
            element={
              <Protected roles={['instructor', 'admin']}>
                <CurriculumPage />
              </Protected>
            }
          />
          <Route
            path="/instructor/courses/:courseId/students"
            element={
              <Protected roles={['instructor', 'admin']}>
                <ManagementPage studentsOnly />
              </Protected>
            }
          />
          <Route
            path="/admin"
            element={
              <Protected roles={['admin']}>
                <OverviewPage admin />
              </Protected>
            }
          />
          <Route
            path="/instructor/courses"
            element={
              <Protected roles={['instructor', 'admin']}>
                <WorkspacePage />
              </Protected>
            }
          />
          <Route
            path="/instructor/courses/:courseId"
            element={
              <Protected roles={['instructor', 'admin']}>
                <ManagementPage />
              </Protected>
            }
          />
          <Route
            path="/admin/courses"
            element={
              <Protected roles={['admin']}>
                <WorkspacePage admin />
              </Protected>
            }
          />
          <Route
            path="/admin/courses/:courseId"
            element={
              <Protected roles={['admin']}>
                <ManagementPage admin />
              </Protected>
            }
          />
          <Route
            path="*"
            element={
              <section className="empty">
                <BookOpen aria-hidden="true" />
                <h1>Page not found</h1>
                <p>Let’s get you back to learning.</p>
                <Link className="button primary" to="/courses">
                  Browse courses
                </Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer className="site-footer">
        <span>EduFlow</span>
        <span>A clear path to your next skill.</span>
      </footer>
    </CatalogFrame>
  );
}
export default function App() {
  return <Shell />;
}

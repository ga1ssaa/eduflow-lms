import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import type { Role } from './lib/types';
import { ErrorPanel, Loading } from './components/ui';
import { Navbar } from './components/navigation/Navbar';
import { CatalogAnchor } from './components/catalog/CatalogAnchor';
import { CatalogPage, CoursePage } from './pages/Catalog';
import { LandingPage } from './pages/Landing';
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
import './product.css';
import './atmosphere.css';
import './reveal.css';
import { useScrollReveal } from './hooks/useScrollReveal';

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
  pageClass,
}: {
  active: boolean;
  pageClass: string;
  children: ReactNode;
}) {
  return active ? (
    <div className="catalog-shell">{children}</div>
  ) : (
    <div className={pageClass}>{children}</div>
  );
}
function Shell() {
  const auth = useAuth();
  const location = useLocation();
  const revealRef = useScrollReveal(location.pathname);
  const isCatalog = location.pathname === '/courses';
  const isLanding = location.pathname === '/';
  const pageClass = `product-shell ${isLanding ? 'discovery-shell landing-shell' : ['/login', '/register'].includes(location.pathname) ? 'discovery-shell auth-shell' : location.pathname.startsWith('/courses/') ? 'discovery-shell course-detail-shell' : 'workspace-shell'}`;
  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    target?.scrollIntoView({ block: 'start' });
    if (target?.id === 'main') target.focus({ preventScroll: true });
  }, [isCatalog, location.hash, location.key]);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const titles: Record<string, string> = {
      '/': 'Learn in flow',
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
    <CatalogFrame active={isCatalog} pageClass={pageClass}>
      {isCatalog ? (
        <CatalogAnchor className="skip-link" hash="#main">
          Skip to content
        </CatalogAnchor>
      ) : (
        <Link
          className="skip-link"
          to={{
            pathname: location.pathname,
            search: location.search,
            hash: '#main',
          }}
        >
          Skip to content
        </Link>
      )}
      <Navbar loggingOut={loggingOut} onLogout={() => void logout()} />
      <main
        ref={revealRef}
        id="main"
        className={isCatalog ? 'catalog-main' : 'main-container'}
        tabIndex={-1}
      >
        {logoutError != null && (
          <ErrorPanel error={logoutError} retry={() => void logout()} />
        )}
        <Routes>
          <Route path="/" element={<LandingPage />} />
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
        {!isCatalog && (
          <nav aria-label="Footer navigation">
            <Link to="/courses">Explore courses</Link>
            <Link
              to={
                auth.user
                  ? auth.user.role === 'student'
                    ? '/learning'
                    : auth.user.role === 'admin'
                      ? '/admin'
                      : '/instructor'
                  : '/login'
              }
            >
              {auth.user ? 'Your workspace' : 'Sign in'}
            </Link>
          </nav>
        )}
        <span>A clear path to your next skill.</span>
      </footer>
    </CatalogFrame>
  );
}
export default function App() {
  return <Shell />;
}

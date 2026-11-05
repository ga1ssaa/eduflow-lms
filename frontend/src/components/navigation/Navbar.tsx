import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, GraduationCap, Menu } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { ThemeControl } from '../../theme/ThemeControl';
import { CatalogAnchor } from '../catalog/CatalogAnchor';
import './navbar.css';

export function Navbar({
  loggingOut,
  onLogout,
}: {
  loggingOut: boolean;
  onLogout: () => void;
}) {
  const auth = useAuth();
  const location = useLocation();
  const isCatalog = location.pathname === '/courses';
  const [compact, setCompact] = useState(false);
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const update = () => setCompact(window.scrollY > 24);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  useEffect(() => {
    if (accountRef.current) accountRef.current.open = false;
  }, [location.pathname]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        accountRef.current?.open &&
        !accountRef.current.contains(event.target)
      )
        accountRef.current.open = false;
      if (!headerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  const close = () => setOpen(false);
  const closeWithFocus = () => {
    setOpen(false);
    mobileTrigger.current?.focus();
  };
  const workspace =
    auth.user?.role === 'student'
      ? '/learning'
      : auth.user?.role === 'admin'
        ? '/admin'
        : '/instructor';
  const sectionLink = (hash: `#${string}`, label: string) =>
    isCatalog ? (
      <CatalogAnchor hash={hash} onClick={close}>
        {label}
      </CatalogAnchor>
    ) : (
      <Link to={`/courses${hash}`} onClick={close}>
        {label}
      </Link>
    );
  const nav = (
    <>
      <NavLink to="/" end onClick={close}>
        Home
      </NavLink>
      {isCatalog ? (
        <CatalogAnchor
          hash="#courses"
          className="active"
          aria-current="page"
          onClick={close}
        >
          Explore Courses
        </CatalogAnchor>
      ) : (
        <NavLink to="/courses" onClick={close}>
          Explore Courses
        </NavLink>
      )}
      {!auth.user ? (
        <>
          {sectionLink('#how-it-works', 'How It Works')}
          {sectionLink('#for-instructors', 'For Instructors')}
          {sectionLink('#about', 'About')}
        </>
      ) : (
        <>
          {auth.user.role === 'student' && (
            <NavLink to="/learning" onClick={close}>
              My learning
            </NavLink>
          )}
          {['instructor', 'admin'].includes(auth.user.role) && (
            <>
              <NavLink to="/instructor" end onClick={close}>
                Overview
              </NavLink>
              <NavLink to="/instructor/courses" onClick={close}>
                My courses
              </NavLink>
            </>
          )}
          {auth.user.role === 'admin' && (
            <NavLink to="/admin" onClick={close}>
              Administration
            </NavLink>
          )}
        </>
      )}
    </>
  );
  return (
    <header
      ref={headerRef}
      className={`site-header floating-navbar catalog-page-header${compact ? ' is-compact' : ''}`}
    >
      <div className="header-inner">
        <Link to="/" className="brand" aria-label="EduFlow home">
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
            <span className="small muted navbar-session-status" role="status">
              Signing out…
            </span>
          ) : auth.user ? (
            <details
              ref={accountRef}
              className="account"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector('summary')?.focus();
                }
              }}
            >
              <summary
                aria-label="Account menu"
                className="catalog-account-trigger"
              >
                <span className="avatar">
                  {auth.user.full_name
                    .split(/\s+/)
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <ChevronDown
                  className="catalog-account-chevron"
                  size={16}
                  aria-hidden="true"
                />
              </summary>
              <div className="account-panel">
                <strong>{auth.user.full_name}</strong>
                <span>{auth.user.email}</span>
                <span className="role-label">{auth.user.role}</span>
                <Link className="catalog-role-link" to={workspace}>
                  Go to my workspace
                </Link>
                <button
                  className="button secondary"
                  disabled={loggingOut}
                  onClick={onLogout}
                >
                  Sign out
                </button>
              </div>
            </details>
          ) : auth.status === 'loading' ? (
            <span className="small muted navbar-session-status">
              Checking session…
            </span>
          ) : auth.error ? (
            <button
              className="button secondary navbar-sign-in"
              onClick={() => void auth.retry().catch(() => undefined)}
            >
              {auth.error.name === 'LogoutRevocationError'
                ? 'Retry sign out'
                : 'Retry session'}
            </button>
          ) : (
            <Link className="button navbar-sign-in sign-in" to="/login">
              Sign in
            </Link>
          )}
          {!loggingOut && !auth.error && auth.status !== 'loading' && (
            <Link
              className="button navbar-start catalog-start"
              to={auth.user ? workspace : '/register'}
            >
              {auth.user ? 'Workspace' : 'Get Started'}
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
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeWithFocus();
            }}
          >
            <Menu size={24} aria-hidden="true" />
          </button>
        </div>
      </div>
      {open && (
        <nav
          className="mobile-nav"
          id="mobile-navigation"
          aria-label="Mobile navigation"
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeWithFocus();
          }}
        >
          {nav}
          {!loggingOut && auth.status !== 'loading' && auth.error && (
            <button
              type="button"
              className="button navbar-sign-in"
              onClick={() => void auth.retry().catch(() => undefined)}
            >
              {auth.error.name === 'LogoutRevocationError'
                ? 'Retry sign out'
                : 'Retry session'}
            </button>
          )}
          {!loggingOut &&
            auth.status !== 'loading' &&
            !auth.error &&
            !auth.user && (
              <Link
                to="/login"
                className="button navbar-sign-in"
                onClick={close}
              >
                Sign in
              </Link>
            )}
          {!loggingOut && auth.status !== 'loading' && !auth.error && (
            <Link
              className="button navbar-start"
              to={auth.user ? workspace : '/register'}
              onClick={close}
            >
              {auth.user ? 'Go to workspace' : 'Get Started'}
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}

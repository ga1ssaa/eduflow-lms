import { Component, type ReactNode } from 'react';
import { BookOpen, Home, ShieldCheck, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import './page-fallback.css';

export function PageFallback({
  kind,
  retry,
}: {
  kind: 'not-found' | 'forbidden' | 'unexpected';
  retry?: () => void;
}) {
  const { user } = useAuth();
  const workspace =
    user?.role === 'student'
      ? '/learning'
      : user?.role === 'admin'
        ? '/admin'
        : '/instructor';
  const forbidden = kind === 'forbidden';
  const missing = kind === 'not-found';
  const Icon = forbidden ? ShieldCheck : BookOpen;
  return (
    <section className="fallback-page surface" aria-labelledby="fallback-title">
      <span className="fallback-code">
        {forbidden ? '403' : missing ? '404' : 'Something went wrong'}
      </span>
      <Icon
        className="fallback-symbol"
        size={40}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <h1 id="fallback-title">
        {forbidden
          ? 'This page is for a different role'
          : missing
            ? 'Page not found'
            : 'Let’s try that again'}
      </h1>
      <p>
        {forbidden
          ? `You are signed in as ${user?.role ?? 'a different role'}. Choose your workspace to continue.`
          : missing
            ? 'This chapter is missing. Let’s get you back to learning.'
            : 'We couldn’t display this page. Please try again, or return to the course catalog.'}
      </p>
      <div className="actions">
        {retry && (
          <button type="button" className="button primary" onClick={retry}>
            <RefreshCw size={16} aria-hidden="true" />
            Try again
          </button>
        )}
        {forbidden && user ? (
          <Link className="button primary" to={workspace}>
            Go to my workspace
          </Link>
        ) : (
          <Link
            className={`button ${retry ? 'secondary' : 'primary'}`}
            to="/courses"
          >
            Browse courses
          </Link>
        )}
        <Link className="button secondary" to="/">
          <Home size={16} aria-hidden="true" />
          Return Home
        </Link>
      </div>
    </section>
  );
}

/** Render failures never expose React stacks or discard the surrounding session. */
export class PageErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <PageFallback
        kind="unexpected"
        retry={() => this.setState({ failed: false })}
      />
    ) : (
      this.props.children
    );
  }
}

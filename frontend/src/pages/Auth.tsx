import '../pages.css';
import '../auth-pages.css';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Eye, EyeOff, ArrowUpRight } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { isApiError } from '../lib/client';
import { safeReturn } from '../components/ui';
import { Atmosphere } from '../components/Atmosphere';
export function AuthPage({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  const [params] = useSearchParams();
  const destination = safeReturn(params.get('returnTo'));
  const [pending, setPending] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setErrors({});
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const full_name = String(form.get('full_name') ?? '').trim();
    if (
      register &&
      (!/[\p{L}]/u.test(password) || !/[^\p{L}\s]/u.test(password))
    ) {
      setErrors({
        password: 'Include a letter and a non-space number or symbol.',
      });
      return;
    }
    setPending(true);
    try {
      if (register) await auth.register({ email, password, full_name });
      else await auth.login({ email, password });
    } catch (error) {
      if (isApiError(error)) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else setMessage('Unable to connect. Please try again.');
    } finally {
      setPending(false);
    }
  };
  if (auth.user)
    return (
      <Navigate
        to={
          destination === '/learning' && auth.user.role !== 'student'
            ? auth.user.role === 'admin'
              ? '/admin'
              : '/instructor'
            : destination
        }
        replace
      />
    );
  return (
    <div className="auth-layout">
      <section className="auth-intro" aria-labelledby="auth-editorial-title">
        <Atmosphere className="auth-pixels" />
        <div className="auth-editorial-copy">
          <h1 id="auth-editorial-title">
            Your next chapter.
            <em>Keep it going.</em>
          </h1>
          <p className="auth-editorial-description">
            One place for your courses, your progress, and the skills you’re
            building. A little curiosity can take you a long way.
          </p>
          <div className="auth-note">
            <BookOpen size={22} strokeWidth={1.5} aria-hidden="true" />
            <p>
              A clear path.
              <br />
              <strong>Your own pace.</strong>
            </p>
          </div>
        </div>
        <div className="auth-visual" aria-hidden="true">
          <span />
          <span />
          <span />
          <ArrowUpRight strokeWidth={1} />
        </div>
      </section>
      <section className="auth-card" aria-labelledby="auth-form-title">
        <div
          className="auth-form-content"
          onFocusCapture={(event) => {
            event.currentTarget
              .getAnimations?.()
              .forEach((animation) => animation.finish());
          }}
        >
          <h2 id="auth-form-title">
            {register ? 'Create your account' : 'Welcome back.'}
          </h2>
          <p className="muted">
            {register
              ? 'Start your learning journey with a student account.'
              : 'Continue learning right where you left off.'}
          </p>
          <form
            onSubmit={submit}
            aria-label={register ? 'Create account' : 'Sign in'}
          >
            {register && (
              <label>
                <span>Full name</span>
                <input
                  name="full_name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  aria-invalid={!!errors.full_name}
                  aria-describedby={
                    errors.full_name ? 'full_name-error' : undefined
                  }
                />
                {errors.full_name && (
                  <span id="full_name-error" className="field-error">
                    {errors.full_name}
                  </span>
                )}
              </label>
            )}
            <label>
              <span>Email address</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                maxLength={254}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <span id="email-error" className="field-error">
                  {errors.email}
                </span>
              )}
            </label>
            <label>
              <span>Password</span>
              <div className="auth-password-control">
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  name="password"
                  autoComplete={register ? 'new-password' : 'current-password'}
                  required
                  minLength={register ? 12 : 1}
                  maxLength={128}
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    register
                      ? `password-help${errors.password ? ' password-error' : ''}`
                      : errors.password
                        ? 'password-error'
                        : undefined
                  }
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  aria-label={
                    passwordVisible ? 'Hide password' : 'Show password'
                  }
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </div>
              {register && (
                <span className="field-help" id="password-help">
                  12–128 characters, with a letter and a non-space number or
                  symbol.
                </span>
              )}
              <span id="password-error" className="field-error">
                {errors.password}
              </span>
            </label>
            {message && (
              <p role="alert" className="form-error">
                {message}
              </p>
            )}
            <button
              className="button primary full-width"
              disabled={pending}
              type="submit"
            >
              {pending
                ? register
                  ? 'Creating account…'
                  : 'Signing in…'
                : register
                  ? 'Create account'
                  : 'Sign in'}
            </button>
          </form>
          <p className="auth-switch">
            {register ? 'Already have an account? ' : 'New to EduFlow? '}
            <Link
              className="text-link"
              to={`${register ? '/login' : '/register'}?returnTo=${encodeURIComponent(destination)}`}
            >
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

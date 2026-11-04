import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { isApiError } from '../lib/client';
import { safeReturn } from '../components/ui';
export function AuthPage({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = safeReturn(params.get('returnTo'));
  const [pending, setPending] = useState(false);
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
      navigate(destination, { replace: true });
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
              ? '/admin/courses'
              : '/instructor/courses'
            : destination
        }
        replace
      />
    );
  return (
    <div className="auth-layout">
      <section className="auth-intro">
        <span className="course-icon large">
          <BookOpen size={32} aria-hidden="true" />
        </span>
        <p className="eyebrow">YOUR LEARNING, IN FLOW</p>
        <h1>
          {register
            ? 'A fresh chapter starts here.'
            : 'Welcome back to your next chapter.'}
        </h1>
        <p>
          One place for your courses, your progress, and the skills you’re
          building.
        </p>
        <div className="auth-note">
          <span className="accent-line" />
          <p>
            Small steps.
            <br />
            <strong>Lasting progress.</strong>
          </p>
        </div>
      </section>
      <section className="auth-card surface">
        <h2>{register ? 'Create your account' : 'Sign in to EduFlow'}</h2>
        <p className="muted">
          {register
            ? 'Start your learning journey with a student account.'
            : 'Pick up right where you left off.'}
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
            <input
              type="password"
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
      </section>
    </div>
  );
}

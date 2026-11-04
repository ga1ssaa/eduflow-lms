import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { isApiError } from '../lib/client';

export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {children && <div className="heading-description">{children}</div>}
    </div>
  );
}
export function Loading({
  label = 'Loading your content…',
}: {
  label?: string;
}) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}
export function ErrorPanel({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const status = isApiError(error) ? error.status : 0;
  const heading =
    status === 404
      ? 'This content is unavailable'
      : status === 403
        ? 'You don’t have access to this page'
        : status === 401
          ? 'Your session needs attention'
          : status === 409
            ? 'This change could not be completed'
            : 'We couldn’t complete that request';
  const detail =
    status === 404
      ? 'It may no longer be available, or you may need to enroll first.'
      : status === 403
        ? 'Your current account does not have permission for this action.'
        : isApiError(error)
          ? error.message
          : 'Check your connection and try again.';
  return (
    <div className="feedback error" role="alert">
      <AlertCircle size={22} aria-hidden="true" />
      <div>
        <h2>{heading}</h2>
        <p>{detail}</p>
        <div className="actions">
          {retry && (
            <button className="button secondary" onClick={retry}>
              <RefreshCw size={16} aria-hidden="true" />
              Try again
            </button>
          )}
          <Link to="/courses" className="text-link">
            Browse courses
          </Link>
        </div>
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <BookOpen size={32} aria-hidden="true" />
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
export function Badge({
  children,
  success = false,
}: {
  children: ReactNode;
  success?: boolean;
}) {
  return (
    <span className={`badge ${success ? 'success' : ''}`}>
      {success && <CheckCircle2 size={14} aria-hidden="true" />}
      {children}
    </span>
  );
}
export function Progress({
  completed,
  total,
  percent,
  done,
}: {
  completed: number;
  total: number;
  percent: number;
  done: boolean;
}) {
  return (
    <div className="progress-block">
      <div className="progress-label">
        <span>
          {done ? 'Completed' : `${completed} of ${total} lessons complete`}
        </span>
        <strong>{percent}%</strong>
      </div>
      <progress
        max={100}
        value={Math.max(0, Math.min(100, percent))}
        aria-label={`${completed} of ${total} lessons completed`}
      />
    </div>
  );
}
export function usePage() {
  const [params, setParams] = useSearchParams();
  const parsed = Number(params.get('page') ?? 1);
  const page =
    Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1000000
      ? parsed
      : 1;
  const setPage = (next: number) =>
    setParams((previous) => {
      const copy = new URLSearchParams(previous);
      copy.set('page', String(next));
      return copy;
    });
  return { params, setParams, page, setPage };
}
export function Pagination({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (next: number) => void;
}) {
  if (total === 0 && page === 1) return null;
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        {total} {total === 1 ? 'result' : 'results'} · Page {page} of {pages}
      </span>
      <div className="actions">
        <button
          className="button secondary"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Previous
        </button>
        <button
          className="button secondary"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Next
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
export function safeReturn(value: string | null, fallback = '/learning') {
  return value &&
    value.length <= 2048 &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32) &&
    !/^\/(login|register)(?:[/?#]|$)/.test(value)
    ? value
    : fallback;
}
export function safeVideo(value: string | null | undefined) {
  try {
    const url = new URL(value ?? '');
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

import '../pages.css';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, FileText, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { ErrorPanel, Loading, PageHeading } from '../components/ui';
import { WorkspacePage } from './Workspace';

export function OverviewPage({ admin = false }: { admin?: boolean }) {
  const { user } = useAuth();
  const base = admin ? 'admin' : 'author';
  const list = admin ? api.adminCourses : api.instructorCourses;
  // Reuse the first overview page for its total; two bounded count requests
  // provide global status totals without downloading every course or per-course stats.
  const overview = useQuery({
    queryKey: [base, user!.id, 'courses', { page: 1, page_size: 12 }],
    queryFn: ({ signal }) => list({ page: 1, page_size: 12 }, signal),
  });
  const published = useQuery({
    queryKey: [base, user!.id, 'count', 'published'],
    queryFn: ({ signal }) =>
      list({ status: 'published', page_size: 1 }, signal),
  });
  const draft = useQuery({
    queryKey: [base, user!.id, 'count', 'draft'],
    queryFn: ({ signal }) => list({ status: 'draft', page_size: 1 }, signal),
  });
  const failed = [overview, published, draft].find((q) => q.isError);
  return (
    <>
      <div className="product-page-intro overview-page-intro">
        <div>
          <p className="product-identity">
            <span aria-hidden="true">
              {user!.full_name
                .split(/\s+/)
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </span>
            {user!.full_name} ·{' '}
            {admin ? 'Administration' : 'Instructor workspace'}
          </p>
          <PageHeading
            eyebrow={admin ? 'ADMINISTRATION' : 'INSTRUCTOR DASHBOARD'}
            title={`Welcome back, ${user!.full_name.split(' ')[0]}.`}
          >
            <p>
              {admin
                ? 'Review course availability and keep the learning catalog ready for students.'
                : 'Shape your next course and see how your teaching is reaching learners.'}
            </p>
          </PageHeading>
        </div>
        <Link
          className="button primary"
          to={admin ? '/admin/courses' : '/instructor/courses/new'}
        >
          {admin ? 'Manage courses' : 'Create course'}
          <ArrowUpRight size={17} aria-hidden="true" />
        </Link>
      </div>
      {failed ? (
        <ErrorPanel
          error={failed.error}
          retry={() => {
            void overview.refetch();
            void published.refetch();
            void draft.refetch();
          }}
        />
      ) : overview.isPending || published.isPending || draft.isPending ? (
        <Loading label="Loading course overview…" />
      ) : (
        <div className="stats-grid" aria-label="Course totals">
          <div className="stat surface" data-reveal data-reveal-index={0}>
            <BookOpen className="stat-symbol" size={22} aria-hidden="true" />
            <span>Total courses</span>
            <strong>{overview.data?.total}</strong>
          </div>
          <div className="stat surface" data-reveal data-reveal-index={1}>
            <CheckCircle2
              className="stat-symbol"
              size={22}
              aria-hidden="true"
            />
            <span>Published courses</span>
            <strong>{published.data?.total}</strong>
          </div>
          <div className="stat surface" data-reveal data-reveal-index={2}>
            <FileText className="stat-symbol" size={22} aria-hidden="true" />
            <span>Draft courses</span>
            <strong>{draft.data?.total}</strong>
          </div>
        </div>
      )}
      {!admin && (
        <p className="overview-note">
          Enrollment counts and completion statistics are available for each
          course.{' '}
          <Link className="text-link" to="/instructor/courses">
            View course statistics
          </Link>
        </p>
      )}
      <div className="section-heading" data-reveal>
        <h2>{admin ? 'Moderation overview' : 'Course overview'}</h2>
      </div>
      <WorkspacePage admin={admin} dashboard />
    </>
  );
}

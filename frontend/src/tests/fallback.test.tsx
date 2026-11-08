import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PageErrorBoundary, PageFallback } from '../components/PageFallback';
import { ErrorPanel } from '../components/ui';
import { MutationError } from '../components/authoring';
import { ApiError } from '../lib/client';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'student' } }),
}));

describe('safe recovery presentation', () => {
  it('provides real Home/catalog destinations for missing pages', () => {
    render(
      <MemoryRouter>
        <PageFallback kind="not-found" />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Return Home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(
      screen.getByRole('link', { name: 'Browse courses' }),
    ).toHaveAttribute('href', '/courses');
  });
  it('preserves the role-specific recovery destination', () => {
    render(
      <MemoryRouter>
        <PageFallback kind="forbidden" />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('link', { name: 'Go to my workspace' }),
    ).toHaveAttribute('href', '/learning');
    expect(screen.getByText('403')).toBeVisible();
  });
  it('recovers from a render failure without printing internal error text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let broken = true;
    function Content() {
      if (broken) throw new Error('private-render-detail');
      return <p>Recovered page</p>;
    }
    try {
      render(
        <MemoryRouter>
          <PageErrorBoundary>
            <Content />
          </PageErrorBoundary>
        </MemoryRouter>,
      );
      expect(
        screen.queryByText(/private-render-detail/),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Let’s try that again' }),
      ).toBeVisible();
      broken = false;
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(screen.getByText('Recovered page')).toBeVisible();
    } finally {
      log.mockRestore();
    }
  });
  it.each([500, 503])(
    'sanitizes server %s details in request and mutation errors',
    (status) => {
      const error = new ApiError(status, 'private-database-detail');
      render(
        <MemoryRouter>
          <ErrorPanel error={error} />
          <MutationError error={error} />
        </MemoryRouter>,
      );
      expect(
        screen.queryByText('private-database-detail'),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByText(
          'The service is temporarily unavailable. Please try again shortly.',
        ),
      ).toHaveLength(2);
    },
  );
  it('retains actionable conflict feedback and retry', async () => {
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <ErrorPanel
          error={
            new ApiError(409, 'Courses with enrollments cannot be deleted')
          }
          retry={retry}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('Courses with enrollments cannot be deleted'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

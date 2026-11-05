import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCoursePage } from '../lib/types';

const { catalog } = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { catalog } }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetModules();
  catalog.mockReset();
  vi.stubGlobal('BroadcastChannel', undefined);
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

const featured: PublicCoursePage = {
  page: 1,
  page_size: 3,
  total: 40,
  items: Array.from({ length: 3 }, (_, index) => ({
    id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    slug: `featured-${index + 1}`,
    title: `Featured course ${index + 1}`,
    description: 'Real public course summary.',
    category: 'Development',
    level: 'beginner',
    instructor_name: 'Featured Instructor',
    module_count: 1,
    lesson_count: 2,
    published_at: '2026-11-05T00:00:00Z',
  })),
};

async function renderLanding() {
  const { LandingPage } = await import('../pages/Landing');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('landing featured-course contracts', () => {
  it('requests only a three-course preview and preserves canonical slug links', async () => {
    catalog.mockResolvedValueOnce(featured);
    await renderLanding();
    await screen.findByRole('heading', { name: 'Featured course 1' });
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(catalog.mock.calls[0][0]).toEqual({ page: 1, page_size: 3 });
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(
      screen.getByRole('link', { name: 'Featured course 1' }),
    ).toHaveAttribute('href', '/courses/featured-1');
    expect(
      screen.getByRole('link', { name: 'View Featured course 1' }),
    ).toHaveAttribute('href', '/courses/featured-1');
    expect(
      screen.getByRole('link', { name: 'Find your starting point' }),
    ).toHaveAttribute('href', '/register');
    expect(screen.queryByText(/\d+ courses available/)).not.toBeInTheDocument();
  });

  it('shows an honest empty state without fabricated course cards or statistics', async () => {
    catalog.mockResolvedValueOnce({ ...featured, items: [], total: 0 });
    await renderLanding();
    expect(
      await screen.findByRole('heading', {
        name: 'Something new is on its way',
      }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(
      screen.getByRole('link', { name: 'Visit the catalog' }),
    ).toHaveAttribute('href', '/courses');
    expect(screen.queryByText(/\d+ courses available/)).not.toBeInTheDocument();
  });

  it('recovers an unavailable preview with explicit retry and keeps landing CTAs usable', async () => {
    catalog
      .mockRejectedValueOnce(new Error('Preview unavailable'))
      .mockResolvedValueOnce(featured);
    await renderLanding();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(
      screen.getByRole('link', { name: 'Explore courses' }),
    ).toHaveAttribute('href', '/courses');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3));
    expect(catalog.mock.calls.map(([params]) => params)).toEqual([
      { page: 1, page_size: 3 },
      { page: 1, page_size: 3 },
    ]);
  });
});

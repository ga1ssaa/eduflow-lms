import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCoursePage } from '../lib/types';

const { catalog } = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { catalog } }));
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetModules();
  catalog.mockReset();
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal('IntersectionObserver', undefined);
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

function data(page = 1, total = 18): PublicCoursePage {
  return {
    page,
    page_size: 9,
    total,
    items: Array.from({ length: 9 }, (_, index) => {
      const number = (page - 1) * 9 + index + 1;
      return {
        id: `30000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
        slug: `test-catalog-${number}`,
        title: `Test catalog ${number}`,
        description: 'Published learning content.',
        category: 'Engineering',
        level: 'beginner',
        instructor_name: 'Test Instructor',
        module_count: 1,
        lesson_count: 2,
        published_at: '2026-11-04T00:00:00Z',
      };
    }),
  };
}
async function renderCatalog(path = '/courses') {
  const { CatalogPage } = await import('../pages/Catalog');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  function Location() {
    return (
      <output data-testid="catalog-location">{useLocation().search}</output>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <CatalogPage />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
function listing() {
  return within(
    screen.getByRole('region', { name: 'Curiosity looks good on you.' }),
  );
}

describe('catalog interaction and truthful feedback', () => {
  it('offers manual pagination without IntersectionObserver and keeps earlier cards', async () => {
    catalog.mockResolvedValueOnce(data()).mockResolvedValueOnce(data(2));
    await renderCatalog();
    await screen.findByRole('heading', { name: 'Test catalog 1' });
    expect(listing().getAllByRole('article')).toHaveLength(9);
    await userEvent.click(
      screen.getByRole('button', { name: 'Load more courses' }),
    );
    await screen.findByRole('heading', { name: 'Test catalog 18' });
    expect(listing().getAllByRole('article')).toHaveLength(18);
    expect(
      screen.getByRole('heading', { name: 'Test catalog 1' }),
    ).toBeInTheDocument();
    expect(catalog.mock.calls.map(([params]) => params.page)).toEqual([1, 2]);
  });

  it('applies a level immediately while preserving filters and resetting an obsolete page parameter', async () => {
    catalog.mockResolvedValueOnce(data()).mockResolvedValueOnce(data(1, 9));
    await renderCatalog(
      '/courses?search=Data&category=Engineering&level=beginner&page=8',
    );
    await screen.findByRole('heading', { name: 'Test catalog 1' });
    await userEvent.selectOptions(
      screen.getByLabelText('Level'),
      'intermediate',
    );
    await waitFor(() => expect(catalog).toHaveBeenCalledTimes(2));
    expect(catalog.mock.calls[1][0]).toEqual({
      search: 'Data',
      category: 'Engineering',
      level: 'intermediate',
      page: 1,
      page_size: 9,
    });
    const params = new URLSearchParams(
      screen.getByTestId('catalog-location').textContent ?? '',
    );
    expect(Object.fromEntries(params)).toEqual({
      search: 'Data',
      category: 'Engineering',
      level: 'intermediate',
    });
  });

  it('debounces search and lazily loads real category values without a submit button', async () => {
    catalog.mockImplementation(async (params) => {
      if (params.page_size === 100) {
        const result = data(1, 2);
        return {
          ...result,
          page_size: 100,
          items: [
            { ...result.items[0], category: 'Engineering' },
            { ...result.items[1], category: 'Design' },
          ],
        };
      }
      return data();
    });
    await renderCatalog('/courses?level=beginner&page=8');
    await screen.findByRole('heading', { name: 'Test catalog 1' });
    expect(
      screen.queryByRole('button', { name: 'Find courses' }),
    ).not.toBeInTheDocument();
    expect(
      catalog.mock.calls.some(([params]) => params.page_size === 100),
    ).toBe(false);
    await userEvent.type(screen.getByLabelText('Search courses'), 'Data');
    expect(catalog).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(catalog).toHaveBeenCalledTimes(2));
    expect(catalog.mock.calls[1][0]).toEqual({
      search: 'Data',
      category: undefined,
      level: 'beginner',
      page: 1,
      page_size: 9,
    });
    const category = screen.getByRole('combobox', { name: 'Category' });
    await userEvent.click(category);
    await screen.findByRole('option', { name: 'Design' });
    await userEvent.selectOptions(category, 'Design');
    await waitFor(() =>
      expect(catalog.mock.calls.at(-1)?.[0]).toEqual({
        search: 'Data',
        category: 'Design',
        level: 'beginner',
        page: 1,
        page_size: 9,
      }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear filters' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('catalog-location')).toHaveTextContent(/^$/),
    );
    expect(screen.getByLabelText('Search courses')).toHaveValue('');
    expect(category).toHaveValue('');
  });

  it('shows an initial failure without inventing an available-course count', async () => {
    catalog.mockRejectedValueOnce(new Error('Unavailable'));
    await renderCatalog();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Course total unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ courses available/)).not.toBeInTheDocument();
    expect(listing().queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('labels retained cards after refresh failure, hides the old total, and retries explicitly', async () => {
    catalog.mockResolvedValueOnce(data());
    const client = await renderCatalog();
    await screen.findByText('18 courses available');
    catalog.mockRejectedValueOnce(new Error('Refresh unavailable'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['catalog'] });
    });
    await screen.findByRole('alert');
    expect(screen.queryByText('18 courses available')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Previously loaded results are shown below/),
    ).toBeInTheDocument();
    expect(listing().getAllByRole('article')).toHaveLength(9);
    catalog.mockResolvedValueOnce(data(1, 27));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('27 courses available')).toBeInTheDocument();
    expect(
      screen.queryByText(/Previously loaded results are shown below/),
    ).not.toBeInTheDocument();
  });

  it('retries a failed next page through the dedicated action without dropping loaded cards', async () => {
    catalog
      .mockResolvedValueOnce(data())
      .mockRejectedValueOnce(new Error('Next page unavailable'));
    await renderCatalog();
    await screen.findByText('18 courses available');
    await userEvent.click(
      screen.getByRole('button', { name: 'Load more courses' }),
    );
    await screen.findByRole('alert');
    expect(listing().getAllByRole('article')).toHaveLength(9);
    expect(screen.queryByText('18 courses available')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    catalog.mockResolvedValueOnce(data(2));
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry loading more' }),
    );
    await screen.findByRole('heading', { name: 'Test catalog 18' });
    expect(listing().getAllByRole('article')).toHaveLength(18);
    expect(catalog.mock.calls.map(([params]) => params.page)).toEqual([
      1, 2, 2,
    ]);
  });
});

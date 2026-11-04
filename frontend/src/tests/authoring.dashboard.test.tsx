import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAuthoringCourse } from './authoring.fixtures';
import {
  admin,
  instructor,
  jsonResponse,
  requestDetails,
  tokenResponse,
} from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

describe('authoring overview counts', () => {
  it.each([false, true])(
    'uses server totals and a bounded three list requests rather than per-course statistics (admin=%s)',
    async (adminView) => {
      const requests: URL[] = [];
      const items = Array.from({ length: 12 }, (_, index) => {
        const course = makeAuthoringCourse({
          id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          title: `Overview course ${index + 1}`,
        });
        return Object.fromEntries(
          Object.entries(course).filter(([key]) => key !== 'modules'),
        );
      });
      const prefix = `/api/v1/${adminView ? 'admin' : 'instructor'}/courses`;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const { path } = requestDetails(input, init);
          if (path.endsWith('/auth/refresh')) return tokenResponse();
          if (path.endsWith('/users/me'))
            return jsonResponse(adminView ? admin : instructor);
          const url = new URL(
            input instanceof Request ? input.url : String(input),
            'http://localhost',
          );
          requests.push(url);
          if (path !== prefix)
            throw new Error(`Unexpected per-course request ${path}`);
          const status = url.searchParams.get('status');
          return jsonResponse({
            items: status ? [items[0]] : items,
            total: status === 'published' ? 80 : status === 'draft' ? 20 : 100,
            page: 1,
            page_size: status ? 1 : 12,
          });
        }),
      );
      const { default: App } = await import('../App');
      const { AuthProvider } = await import('../auth/AuthProvider');
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      });
      render(
        <QueryClientProvider client={client}>
          <AuthProvider>
            <MemoryRouter
              initialEntries={[adminView ? '/admin' : '/instructor']}
            >
              <App />
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>,
      );
      await waitFor(() =>
        expect(
          screen.getByText('Total courses').parentElement,
        ).toHaveTextContent('100'),
      );
      expect(
        screen.getByText('Published courses').parentElement,
      ).toHaveTextContent('80');
      expect(screen.getByText('Draft courses').parentElement).toHaveTextContent(
        '20',
      );
      await waitFor(() =>
        expect(
          screen.getAllByRole('link', { name: 'Review course' }),
        ).toHaveLength(12),
      );
      expect(requests).toHaveLength(3);
      expect(
        requests.filter(
          (url) => url.searchParams.get('status') === 'published',
        ),
      ).toHaveLength(1);
      expect(
        requests.filter((url) => url.searchParams.get('status') === 'draft'),
      ).toHaveLength(1);
      expect(
        requests.filter((url) => url.searchParams.get('page_size') === '1'),
      ).toHaveLength(2);
    },
  );
});

import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import type { PublicCoursePage, PublicCourseSummary } from '../lib/types';
import { useCatalogFeed, useCatalogSentinel } from '../hooks/useCatalogFeed';
import type { CatalogSentinelOptions } from '../hooks/useCatalogFeed';
import { deferred } from './fixtures';

vi.mock('../lib/api', () => ({ api: { catalog: vi.fn() } }));
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.mocked(api.catalog).mockReset();
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

function course(index: number): PublicCourseSummary {
  return {
    id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    slug: `catalog-course-${index}`,
    title: `Catalog course ${index}`,
    description: 'Public course summary.',
    category: 'Engineering',
    level: 'beginner',
    instructor_name: 'Catalog Instructor',
    module_count: 1,
    lesson_count: 2,
    published_at: '2026-11-04T00:00:00Z',
  };
}
function page(
  number: number,
  start = (number - 1) * 9 + 1,
  total = 18,
): PublicCoursePage {
  return {
    items: Array.from({ length: 9 }, (_, index) => course(start + index)),
    total,
    page: number,
    page_size: 9,
  };
}
type Filters = Parameters<typeof useCatalogFeed>[0];
function mountFeed(filters: Filters = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...renderHook(({ filters }) => useCatalogFeed(filters), {
      initialProps: { filters },
      wrapper,
    }),
  };
}

describe('catalog feed contracts', () => {
  it('hides an unverified count while offline pagination is paused and resumes the same page online', async () => {
    vi.mocked(api.catalog)
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(2));
    const { result } = mountFeed();
    await waitFor(() => expect(result.current.courses).toHaveLength(9));
    let pending: Promise<unknown> | undefined;
    try {
      act(() => {
        onlineManager.setOnline(false);
        pending = result.current.loadMore();
      });
      await waitFor(() => expect(result.current.query.isPaused).toBe(true));
      expect(result.current.total).toBeUndefined();
      expect(result.current.hasCurrentCount).toBe(false);
      expect(result.current.courses).toHaveLength(9);
      expect(result.current.query.isError).toBe(false);
      act(() => {
        void result.current.loadMore();
      });
      expect(api.catalog).toHaveBeenCalledTimes(1);
      await act(async () => {
        onlineManager.setOnline(true);
        await pending;
      });
      await waitFor(() => expect(result.current.courses).toHaveLength(18));
      expect(
        vi.mocked(api.catalog).mock.calls.map(([params]) => params?.page),
      ).toEqual([1, 2]);
      expect(result.current.hasCurrentCount).toBe(true);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('requests only nine first-page records with all current filters', async () => {
    vi.mocked(api.catalog).mockResolvedValueOnce(page(1));
    const filters = {
      search: 'Data',
      category: 'Engineering',
      level: 'beginner' as const,
    };
    const { result } = mountFeed(filters);
    await waitFor(() => expect(result.current.courses).toHaveLength(9));
    expect(api.catalog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.catalog).mock.calls[0][0]).toEqual({
      ...filters,
      page: 1,
      page_size: 9,
    });
    expect(result.current.total).toBe(18);
    expect(result.current.hasCurrentCount).toBe(true);
  });

  it('deduplicates overlapping IDs and simultaneous load-more requests', async () => {
    const next = deferred<PublicCoursePage>();
    vi.mocked(api.catalog)
      .mockResolvedValueOnce(page(1, 1, 25))
      .mockReturnValueOnce(next.promise);
    const { result } = mountFeed({ category: 'Engineering' });
    await waitFor(() => expect(result.current.courses).toHaveLength(9));
    act(() => {
      void result.current.loadMore();
      void result.current.loadMore();
    });
    await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(2));
    expect(result.current.courses).toHaveLength(9);
    await act(async () => {
      next.resolve(page(2, 9, 25));
    });
    await waitFor(() => expect(result.current.courses).toHaveLength(17));
    expect(new Set(result.current.courses.map((item) => item.id)).size).toBe(
      17,
    );
    expect(vi.mocked(api.catalog).mock.calls[1][0]).toEqual({
      category: 'Engineering',
      page: 2,
      page_size: 9,
    });
    expect(api.catalog).toHaveBeenCalledTimes(2);
  });

  it('resets to page one when filters change and never carries the prior filter’s cards', async () => {
    vi.mocked(api.catalog)
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(2))
      .mockResolvedValueOnce(page(1, 101, 9));
    const { result, rerender } = mountFeed({
      search: 'Data',
      category: 'Engineering',
      level: 'beginner',
    });
    await waitFor(() => expect(result.current.courses).toHaveLength(9));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.courses).toHaveLength(18));
    rerender({
      filters: { search: 'Data', category: 'Design', level: 'intermediate' },
    });
    await waitFor(() =>
      expect(result.current.courses[0]?.id).toBe(course(101).id),
    );
    expect(result.current.courses).toHaveLength(9);
    expect(vi.mocked(api.catalog).mock.calls[2][0]).toEqual({
      search: 'Data',
      category: 'Design',
      level: 'intermediate',
      page: 1,
      page_size: 9,
    });
  });

  it('does not report a course count on initial failure', async () => {
    vi.mocked(api.catalog).mockRejectedValueOnce(
      new Error('Catalog unavailable'),
    );
    const { result } = mountFeed();
    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.courses).toEqual([]);
    expect(result.current.total).toBeUndefined();
    expect(result.current.hasCurrentCount).toBe(false);
    expect(result.current.hasPreviousResults).toBe(false);
  });

  it('labels retained results as previous after refetch failure and restores the count on retry', async () => {
    vi.mocked(api.catalog).mockResolvedValueOnce(page(1, 1, 20));
    const { result, client } = mountFeed();
    await waitFor(() => expect(result.current.hasCurrentCount).toBe(true));
    vi.mocked(api.catalog).mockRejectedValueOnce(
      new Error('Refresh unavailable'),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ['catalog'] });
    });
    await waitFor(() => expect(result.current.query.isRefetchError).toBe(true));
    expect(result.current.courses).toHaveLength(9);
    expect(result.current.hasPreviousResults).toBe(true);
    expect(result.current.hasCurrentCount).toBe(false);
    expect(result.current.total).toBeUndefined();
    vi.mocked(api.catalog).mockResolvedValueOnce(page(1, 1, 21));
    await act(async () => {
      await result.current.query.refetch();
    });
    await waitFor(() => expect(result.current.total).toBe(21));
    expect(result.current.hasCurrentCount).toBe(true);
    expect(result.current.hasPreviousResults).toBe(false);
  });

  it('retries the failed next page without skipping it or replacing loaded cards', async () => {
    vi.mocked(api.catalog)
      .mockResolvedValueOnce(page(1))
      .mockRejectedValueOnce(new Error('Next page unavailable'));
    const { result } = mountFeed({ search: 'Data' });
    await waitFor(() => expect(result.current.courses).toHaveLength(9));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() =>
      expect(result.current.query.isFetchNextPageError).toBe(true),
    );
    expect(result.current.courses).toHaveLength(9);
    expect(result.current.total).toBeUndefined();
    expect(result.current.hasPreviousResults).toBe(true);
    vi.mocked(api.catalog).mockResolvedValueOnce(page(2));
    await act(async () => {
      await result.current.loadMore();
    });
    await waitFor(() => expect(result.current.courses).toHaveLength(18));
    expect(
      vi.mocked(api.catalog).mock.calls.map(([params]) => params?.page),
    ).toEqual([1, 2, 2]);
    expect(result.current.total).toBe(18);
  });

  it('does not show a prior filter’s results when the new filter fails', async () => {
    vi.mocked(api.catalog)
      .mockResolvedValueOnce(page(1))
      .mockRejectedValueOnce(new Error('New filter unavailable'));
    const { result, rerender } = mountFeed({ search: 'Old' });
    await waitFor(() => expect(result.current.courses).toHaveLength(9));
    rerender({ filters: { search: 'New' } });
    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.courses).toEqual([]);
    expect(result.current.hasPreviousResults).toBe(false);
    expect(result.current.total).toBeUndefined();
  });
});

describe('catalog observer scheduling', () => {
  function observerDouble() {
    const callbacks: IntersectionObserverCallback[] = [];
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    return {
      callbacks,
      disconnect,
      observe,
      enter: () =>
        callbacks[0](
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
    };
  }
  function Sentinel(options: CatalogSentinelOptions) {
    const ref = useCatalogSentinel(options);
    return <div ref={ref} data-testid="catalog-sentinel" />;
  }

  it('shares repeated visible events and does not automatically drain pages on fetch completion', async () => {
    const observer = observerDouble();
    const pending = deferred<void>();
    const fetchNextPage = vi.fn().mockReturnValue(pending.promise);
    const options = {
      enabled: true,
      isFetching: false,
      isFetchNextPageError: false,
      fetchNextPage,
    };
    const view = render(<Sentinel {...options} />);
    expect(observer.observe).toHaveBeenCalledOnce();
    act(() => {
      observer.enter();
      observer.enter();
    });
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    view.rerender(<Sentinel {...options} isFetching />);
    await act(async () => {
      pending.resolve();
    });
    view.rerender(<Sentinel {...options} />);
    expect(observer.callbacks).toHaveLength(1);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    act(() => {
      observer.enter();
    });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('does not auto-retry a failed next page or fetch while another request is active', () => {
    const observer = observerDouble();
    const fetchNextPage = vi.fn().mockResolvedValue(undefined);
    const options = {
      enabled: true,
      isFetching: true,
      isFetchNextPageError: false,
      fetchNextPage,
    };
    const view = render(<Sentinel {...options} />);
    act(() => {
      observer.enter();
    });
    view.rerender(
      <Sentinel {...options} isFetching={false} isFetchNextPageError />,
    );
    act(() => {
      observer.enter();
    });
    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it('works without IntersectionObserver so manual recovery remains possible', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const fetchNextPage = vi.fn();
    expect(() =>
      render(
        <Sentinel
          enabled
          isFetching={false}
          isFetchNextPageError={false}
          fetchNextPage={fetchNextPage}
        />,
      ),
    ).not.toThrow();
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});

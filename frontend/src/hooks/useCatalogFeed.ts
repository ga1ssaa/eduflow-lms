import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Level, PublicCourseSummary } from '../lib/types';

export interface CatalogFilters {
  search?: string;
  category?: string;
  level?: Level;
}

const PAGE_SIZE = 9;

export function useCatalogFeed(filters: CatalogFilters) {
  const query = useInfiniteQuery({
    queryKey: ['catalog', 'infinite', filters],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      api.catalog(
        { ...filters, page: pageParam, page_size: PAGE_SIZE },
        signal,
      ),
    getNextPageParam: (lastPage) => {
      if (
        lastPage.items.length === 0 ||
        lastPage.page * lastPage.page_size >= lastPage.total
      )
        return undefined;
      return lastPage.page + 1;
    },
    // Recovery is explicit; an unavailable API must not cause repeated auto-loads.
    retry: false,
  });

  const courses = useMemo(() => {
    const unique = new Map<string, PublicCourseSummary>();
    for (const page of query.data?.pages ?? []) {
      for (const course of page.items) {
        if (!unique.has(course.id)) unique.set(course.id, course);
      }
    }
    return [...unique.values()];
  }, [query.data]);

  const latestPage = query.data?.pages.at(-1);
  const hasCurrentCount =
    query.isSuccess &&
    !query.isError &&
    !query.isRefetchError &&
    !query.isFetchNextPageError &&
    !query.isRefetching &&
    !query.isPaused &&
    latestPage !== undefined;
  const total = hasCurrentCount ? latestPage.total : undefined;

  const { hasNextPage, isFetching, isPaused, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetching || isPaused) return;
    // Repeated clicks/observer events share the active fetch instead of restarting it.
    return fetchNextPage({ cancelRefetch: false });
  }, [hasNextPage, isFetching, isPaused, fetchNextPage]);

  return {
    query,
    courses,
    total,
    hasCurrentCount,
    hasPreviousResults: courses.length > 0 && !hasCurrentCount,
    loadMore,
  };
}

export interface CatalogSentinelOptions {
  enabled: boolean;
  isFetching: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown> | undefined;
}

export function useCatalogSentinel(options: CatalogSentinelOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const latestOptions = useRef(options);
  const pending = useRef(false);

  useEffect(() => {
    latestOptions.current = options;
  }, [options]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (
      !options.enabled ||
      !target ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        const current = latestOptions.current;
        if (
          !entries.some((entry) => entry.isIntersecting) ||
          !current.enabled ||
          current.isFetching ||
          current.isFetchNextPageError ||
          pending.current
        )
          return;
        pending.current = true;
        void Promise.resolve(current.fetchNextPage())
          .catch(() => undefined)
          .finally(() => {
            pending.current = false;
          });
      },
      { rootMargin: '400px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
    // Keep the observer through fetch-state changes: a visible sentinel must not
    // trigger another page merely because the previous fetch finished.
  }, [options.enabled]);

  return sentinelRef;
}

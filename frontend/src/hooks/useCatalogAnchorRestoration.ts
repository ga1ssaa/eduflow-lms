import { useCallback, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const lowerSections = new Set(['how-it-works', 'for-instructors', 'about']);
const scrollKeys = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
  'Enter',
  'Tab',
]);

interface Pagination {
  pageCount: number;
  hasNextPage: boolean;
  fetchingNextPage: boolean;
  blocked: boolean;
}

/** Keep one hash landing through its next catalog page, never later browsing. */
export function useCatalogAnchorRestoration(
  layout: string,
  fetching: boolean,
  { pageCount, hasNextPage, fetchingNextPage, blocked }: Pagination,
) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const previous = useRef<typeof location | null>(null);
  const intent = useRef<{
    target: HTMLElement;
    pageCount: number;
    initial: boolean;
    paginating: boolean;
  } | null>(null);
  const cancel = useCallback(() => {
    intent.current = null;
  }, []);

  useLayoutEffect(() => {
    const oldLocation = previous.current;
    const navigated = oldLocation?.key !== location.key;
    if (navigated) {
      cancel();
      previous.current = location;
      // Filters retain the hash; changing them is not a new anchor request.
      const changedFilters =
        oldLocation?.pathname === location.pathname &&
        oldLocation.search !== location.search &&
        navigationType !== 'POP';
      const id = location.hash.slice(1);
      const target = document.getElementById(id);
      if (!changedFilters && lowerSections.has(id) && target)
        intent.current = {
          target,
          pageCount: Math.max(1, pageCount),
          initial: pageCount === 0,
          paginating: fetchingNextPage,
        };
    }
    const pending = intent.current;
    if (!pending) return;
    if (!pending.target.isConnected) {
      cancel();
      return;
    }
    const initialResult = pending.initial && !fetching;
    if (initialResult) pending.initial = false;
    pending.paginating ||= fetchingNextPage;
    const appended = pageCount > pending.pageCount;
    // Observer delivery/query notification may arrive after any number of idle
    // frames. Keep a dormant token for one next-page opportunity, not a timer.
    // App owns the initial scroll; successful unrelated refetches do not repair.
    if (
      !navigated &&
      (initialResult || pending.paginating || appended || blocked)
    ) {
      const margin =
        Number.parseFloat(getComputedStyle(pending.target).scrollMarginTop) ||
        0;
      if (Math.abs(pending.target.getBoundingClientRect().top - margin) > 1)
        pending.target.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    // A fast response can skip the intermediate fetching render. Page count
    // still closes the same opportunity, including error/offline settlement.
    if (
      appended ||
      blocked ||
      (!fetching && (pending.paginating || !hasNextPage))
    )
      cancel();
  }, [
    location,
    navigationType,
    layout,
    fetching,
    pageCount,
    hasNextPage,
    fetchingNextPage,
    blocked,
    cancel,
  ]);

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key)) cancel();
    };
    const options = { capture: true, passive: true };
    for (const event of [
      'wheel',
      'touchmove',
      'pointerdown',
      'click',
      'focusin',
    ])
      window.addEventListener(event, cancel, options);
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancel();
      previous.current = null;
      for (const event of [
        'wheel',
        'touchmove',
        'pointerdown',
        'click',
        'focusin',
      ])
        window.removeEventListener(event, cancel, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [cancel]);
}

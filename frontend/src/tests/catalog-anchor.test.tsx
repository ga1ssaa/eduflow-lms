import { act, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalogAnchorRestoration } from '../hooks/useCatalogAnchorRestoration';

let target: HTMLElement;
let top: number;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const scroll = vi.fn();

type Pagination = Parameters<typeof useCatalogAnchorRestoration>[2];
function Example({
  layout = 'nine',
  fetching = true,
  pagination = {
    pageCount: 1,
    hasNextPage: true,
    fetchingNextPage: fetching,
    blocked: false,
  },
}: {
  layout?: string;
  fetching?: boolean;
  pagination?: Pagination;
}) {
  useCatalogAnchorRestoration(layout, fetching, pagination);
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/courses?category=Design#how-it-works')}>
        Anchor
      </button>
      <button onClick={() => navigate('/courses?category=Other#how-it-works')}>
        Filter
      </button>
      <button onClick={() => navigate('/courses#about')}>About</button>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}

function tree(layout: string, fetching: boolean, pagination?: Pagination) {
  return (
    <StrictMode>
      <MemoryRouter initialEntries={['/courses?category=Design#how-it-works']}>
        <Example layout={layout} fetching={fetching} pagination={pagination} />
      </MemoryRouter>
    </StrictMode>
  );
}

function paint() {
  act(() => {
    const pending = [...frames];
    frames.clear();
    pending.forEach(([, callback]) => callback(0));
  });
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  top = 120;
  scroll.mockReset().mockImplementation(() => {
    top = 120;
  });
  target = document.createElement('section');
  target.id = 'how-it-works';
  target.style.scrollMarginTop = '120px';
  target.scrollIntoView = scroll;
  vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
    () => ({ top }) as DOMRect,
  );
  document.body.append(target);
});
afterEach(() => target.remove());

describe('bounded catalog anchor restoration', () => {
  it('repairs appended cards and skeleton removal before paint without changing focus', () => {
    const view = render(tree('nine+skeletons', true));
    expect(scroll).not.toHaveBeenCalled(); // App retains the initial scroll.
    const focused = document.activeElement;
    top = 1323;
    view.rerender(tree('eighteen', false));
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      block: 'start',
      behavior: 'instant',
    });
    expect(top).toBe(120);
    expect(document.activeElement).toBe(focused);
  });

  it('retains one late observer opportunity beyond idle frames, then retires on its result', () => {
    const view = render(tree('nine', false));
    for (let frame = 0; frame < 8; frame++) paint();
    expect(frames.size).toBe(0); // No polling or assumed IO-delivery deadline.
    top = 1300;
    view.rerender(tree('same-page-background-update', false));
    expect(scroll).not.toHaveBeenCalled();
    paint();
    view.rerender(tree('nine+skeletons', true));
    paint();
    paint();
    top = 1500;
    view.rerender(tree('eighteen', false));
    expect(scroll).toHaveBeenCalledTimes(2); // Loading and final result geometry.
    paint();
    paint();
    top = 1700;
    view.rerender(tree('later-background-update', false));
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(top).toBe(1700);
  });

  it('repairs a fast page append even without an intermediate fetching render', () => {
    const view = render(tree('nine', false));
    for (let frame = 0; frame < 8; frame++) paint();
    top = 4700;
    view.rerender(
      tree('eighteen', false, {
        pageCount: 2,
        hasNextPage: false,
        fetchingNextPage: false,
        blocked: false,
      }),
    );
    expect(scroll).toHaveBeenCalledOnce();
    expect(top).toBe(120);
    top = 1500;
    view.rerender(tree('later-background-update', false));
    expect(top).toBe(1500);
    expect(scroll).toHaveBeenCalledOnce();
  });

  it('keeps the next-page opportunity after the initial page finishes loading', () => {
    const view = render(
      tree('initial', true, {
        pageCount: 0,
        hasNextPage: false,
        fetchingNextPage: false,
        blocked: false,
      }),
    );
    top = 500;
    view.rerender(tree('nine', false));
    expect(top).toBe(120);
    for (let frame = 0; frame < 8; frame++) paint();
    top = 4700;
    view.rerender(
      tree('eighteen', false, {
        pageCount: 2,
        hasNextPage: false,
        fetchingNextPage: false,
        blocked: false,
      }),
    );
    expect(top).toBe(120);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it('ignores a same-page background refetch while awaiting pagination', () => {
    const view = render(tree('nine', false));
    top = 1400;
    view.rerender(
      tree('background-refetch', true, {
        pageCount: 1,
        hasNextPage: true,
        fetchingNextPage: false,
        blocked: false,
      }),
    );
    view.rerender(tree('background-finished', false));
    expect(scroll).not.toHaveBeenCalled();
    expect(top).toBe(1400);
  });

  it.each(['error', 'paused'])(
    'retires a late %s result without a pagination render',
    (status) => {
      const view = render(tree('nine', false));
      top = 1400;
      view.rerender(
        tree(status, false, {
          pageCount: 1,
          hasNextPage: true,
          fetchingNextPage: false,
          blocked: true,
        }),
      );
      expect(top).toBe(120);
      top = 1500;
      view.rerender(tree('background-recovery', false));
      expect(top).toBe(1500);
      expect(scroll).toHaveBeenCalledOnce();
    },
  );

  it.each(['wheel', 'touchmove', 'pointerdown', 'click', 'focusin'])(
    '%s gives viewport ownership to the user during a pending request',
    (event) => {
      const view = render(tree('nine+skeletons', true));
      fireEvent(window, new Event(event));
      top = 1400;
      view.rerender(tree('eighteen', false));
      expect(scroll).not.toHaveBeenCalled();
      expect(top).toBe(1400);
    },
  );

  it.each(['PageDown', 'ArrowUp', ' ', 'Enter', 'Tab'])(
    '%s cancels correction, including keyboard Load More activation',
    (key) => {
      const view = render(tree('nine+skeletons', true));
      fireEvent.keyDown(window, { key });
      top = 1400;
      view.rerender(tree('eighteen', false));
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  it('does not cancel for ordinary scroll events from browser anchoring or repair', () => {
    const view = render(tree('nine+skeletons', true));
    fireEvent.scroll(window);
    top = 1400;
    view.rerender(tree('eighteen', false));
    expect(scroll).toHaveBeenCalledOnce();
  });

  it('does not rearm for filter changes that preserve the hash', () => {
    const view = render(tree('nine+skeletons', true));
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    top = 1400;
    view.rerender(tree('new-filter-results', false));
    expect(scroll).not.toHaveBeenCalled();
  });

  it('ignores a former target on navigation and rearms a fresh Back landing', () => {
    const view = render(tree('nine+skeletons', true));
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    top = 1400;
    view.rerender(tree('eighteen', true));
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    view.rerender(tree('eighteen+updated-count', false));
    expect(scroll).toHaveBeenCalledOnce();
  });

  it('ends after error/paused layout settles and cleans frames/listeners on unmount', () => {
    const view = render(tree('nine+skeletons', true));
    const remove = vi.spyOn(window, 'removeEventListener');
    top = 1400;
    view.rerender(tree('error-panel', false));
    expect(scroll).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    view.unmount();
    expect(frames.size).toBe(0);
    for (const event of [
      'wheel',
      'touchmove',
      'pointerdown',
      'click',
      'focusin',
    ])
      expect(remove).toHaveBeenCalledWith(event, expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });
});

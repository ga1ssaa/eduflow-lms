import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CatalogCourseCard } from '../components/catalog/CatalogVisuals';
import type { PublicCourseSummary } from '../lib/types';
import { useScrollReveal } from '../hooks/useScrollReveal';

const course: PublicCourseSummary = {
  id: '40000000-0000-4000-8000-000000000001',
  slug: 'visible-course',
  title: 'Visible learning',
  description: 'A public course description.',
  category: 'Engineering',
  level: 'beginner',
  instructor_name: 'Learning Instructor',
  module_count: 1,
  lesson_count: 2,
  published_at: '2026-11-04T00:00:00Z',
};
function showCard() {
  function SharedRevealPage() {
    const root = useScrollReveal('catalog-card');
    return (
      <main ref={root}>
        <CatalogCourseCard course={course} index={0} />
      </main>
    );
  }
  return render(
    <MemoryRouter>
      <SharedRevealPage />
    </MemoryRouter>,
  );
}

describe('catalog card visibility and motion', () => {
  it('keeps a usable course link visible without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    showCard();
    expect(screen.getByRole('article')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Visible learning' }),
    ).toHaveAttribute('href', '/courses/visible-course');
    expect(screen.getByRole('article')).toHaveAttribute(
      'data-reveal-state',
      'revealed',
    );
  });

  it('does not create a reveal observer when reduced motion is preferred', () => {
    const constructor = vi.fn();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor() {
          constructor();
        }
      },
    );
    showCard();
    expect(constructor).not.toHaveBeenCalled();
    expect(screen.getByRole('article')).toBeVisible();
    expect(screen.getByRole('article')).toHaveAttribute(
      'data-reveal-state',
      'revealed',
    );
  });

  it('uses the shared observed-to-revealed lifecycle and unobserves after entering', () => {
    let notify: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    const unobserve = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = vi.fn();
        unobserve = unobserve;
        disconnect = disconnect;
      },
    );
    const view = showCard();
    expect(screen.getByRole('article')).toBeVisible();
    expect(screen.getByRole('article')).toHaveAttribute(
      'data-reveal-state',
      'observed',
    );
    act(() => {
      notify?.(
        [
          {
            isIntersecting: true,
            target: screen.getByRole('article'),
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByRole('article')).toHaveAttribute(
      'data-reveal-state',
      'revealing',
    );
    expect(unobserve).toHaveBeenCalledWith(screen.getByRole('article'));
    const event = new Event('animationend', { bubbles: true });
    Object.defineProperty(event, 'animationName', {
      value: 'scroll-reveal-enter',
    });
    fireEvent(screen.getByRole('article'), event);
    expect(screen.getByRole('article')).toHaveAttribute(
      'data-reveal-state',
      'revealed',
    );
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

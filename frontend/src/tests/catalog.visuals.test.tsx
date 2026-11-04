import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CatalogCourseCard } from '../components/catalog/CatalogVisuals';
import type { PublicCourseSummary } from '../lib/types';

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
  return render(
    <MemoryRouter>
      <CatalogCourseCard course={course} index={0} />
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
    expect(screen.getByRole('article')).not.toHaveClass('catalog-card-reveal');
  });

  it('does not create a reveal observer when reduced motion is preferred', () => {
    const constructor = vi.fn();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
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
    expect(screen.getByRole('article')).not.toHaveClass('catalog-card-reveal');
  });

  it('leaves content visible before entry and disconnects the observer after revealing it', () => {
    let notify: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    showCard();
    expect(screen.getByRole('article')).toBeVisible();
    expect(screen.getByRole('article')).not.toHaveClass('catalog-card-reveal');
    act(() => {
      notify?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByRole('article')).toHaveClass('catalog-card-reveal');
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

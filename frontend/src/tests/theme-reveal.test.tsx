import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useScrollReveal } from '../hooks/useScrollReveal';

function Page() {
  const ref = useScrollReveal('theme-coordination');
  return (
    <main ref={ref}>
      <section data-reveal data-testid="active">
        Entering content
      </section>
      <section data-reveal data-testid="waiting">
        Later content
      </section>
    </main>
  );
}
afterEach(() => {
  delete document.documentElement.dataset.themeTransition;
  vi.useRealTimers();
});
it('finishes an active card entrance and keeps new intersections visible during a theme scene', () => {
  vi.useFakeTimers();
  let notify!: IntersectionObserverCallback;
  const unobserve = vi.fn();
  const observer = { observe: vi.fn(), unobserve, disconnect: vi.fn() };
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = observer.observe;
      unobserve = observer.unobserve;
      disconnect = observer.disconnect;
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
    },
  );
  render(<Page />);
  const active = screen.getByTestId('active'),
    waiting = screen.getByTestId('waiting');
  const enter = (target: Element) =>
    notify(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  act(() => enter(active));
  expect(active).toHaveAttribute('data-reveal-state', 'revealing');
  act(() => {
    document.documentElement.dataset.themeTransition = 'sunrise';
    document.dispatchEvent(new CustomEvent('eduflow:theme-transition-start'));
  });
  expect(active).toHaveAttribute('data-reveal-state', 'revealed');
  expect(waiting).toHaveAttribute('data-reveal-state', 'observed');
  act(() => enter(waiting));
  expect(waiting).toHaveAttribute('data-reveal-state', 'revealed');
  expect(unobserve).toHaveBeenCalledWith(active);
  expect(unobserve).toHaveBeenCalledWith(waiting);
  act(() => vi.advanceTimersByTime(1000));
  expect(active).toHaveAttribute('data-reveal-state', 'revealed');
});

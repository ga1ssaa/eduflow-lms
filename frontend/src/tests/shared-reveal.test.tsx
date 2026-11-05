import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollReveal } from '../hooks/useScrollReveal';

class ObservedIntersections {
  static instances: ObservedIntersections[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(private notify: IntersectionObserverCallback) {
    ObservedIntersections.instances.push(this);
  }
  enter(target: Element) {
    this.notify(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}
function motionPreference(initial = false) {
  const callbacks = new Set<() => void>();
  const media = {
    matches: initial,
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      callbacks.add(listener);
    }),
    removeEventListener: vi.fn((_name: string, listener: () => void) => {
      callbacks.delete(listener);
    }),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  return {
    media,
    change(matches: boolean) {
      act(() => {
        media.matches = matches;
        callbacks.forEach((callback) => callback());
      });
    },
  };
}
function Page({
  children,
  pageKey = 'first',
}: {
  children: ReactNode;
  pageKey?: string;
}) {
  const root = useScrollReveal(pageKey);
  return (
    <>
      <header data-reveal data-testid="fixed-header">
        Navigation
      </header>
      <main ref={root}>{children}</main>
    </>
  );
}
function animationEnd(element: HTMLElement, name: string) {
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: name });
  fireEvent(element, event);
}
beforeEach(() => {
  ObservedIntersections.instances = [];
  vi.stubGlobal('IntersectionObserver', ObservedIntersections);
  motionPreference();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('shared scroll reveal lifecycle', () => {
  it('keeps below-fold targets eligible after StrictMode effect replay and ignores the disposed observer', () => {
    render(
      <StrictMode>
        <Page>
          <section data-reveal data-testid="target">
            Below-fold content
          </section>
        </Page>
      </StrictMode>,
    );
    const target = screen.getByTestId('target');
    expect(target).toHaveAttribute('data-reveal-state', 'observed');
    expect(ObservedIntersections.instances).toHaveLength(2);
    const old = ObservedIntersections.instances[0];
    const current = ObservedIntersections.instances[1];
    expect(old.disconnect).toHaveBeenCalled();
    act(() => {
      old.enter(target);
    });
    expect(target).toHaveAttribute('data-reveal-state', 'observed');
    act(() => {
      current.enter(target);
    });
    expect(target).toHaveAttribute('data-reveal-state', 'revealing');
  });

  it('keeps observed content visible and applies 80ms stagger with a 400ms cap', () => {
    render(
      <Page>
        {[0, 1, 5, 20, -1].map((index) => (
          <section
            key={index}
            data-reveal
            data-reveal-index={index}
            data-testid={`target-${index}`}
          >
            Content {index}
          </section>
        ))}
      </Page>,
    );
    expect(ObservedIntersections.instances).toHaveLength(1);
    for (const [index, delay] of [
      [0, 0],
      [1, 80],
      [5, 400],
      [20, 400],
      [-1, 0],
    ]) {
      const target = screen.getByTestId(`target-${index}`);
      expect(target).toBeVisible();
      expect(target).toHaveAttribute('data-reveal-state', 'observed');
      expect(target.style.getPropertyValue('--reveal-delay')).toBe(
        `${delay}ms`,
      );
    }
    expect(screen.getByTestId('fixed-header')).not.toHaveAttribute(
      'data-reveal-state',
    );
  });

  it('animates once, unobserves on entry and finishes only its own animation event', () => {
    render(
      <Page>
        <section data-reveal data-testid="target">
          <span data-testid="child">Content</span>
        </section>
      </Page>,
    );
    const target = screen.getByTestId('target');
    const observer = ObservedIntersections.instances[0];
    act(() => {
      observer.enter(target);
    });
    expect(target).toHaveAttribute('data-reveal-state', 'revealing');
    expect(observer.unobserve).toHaveBeenCalledWith(target);
    animationEnd(target, 'unrelated-animation');
    expect(target).toHaveAttribute('data-reveal-state', 'revealing');
    animationEnd(screen.getByTestId('child'), 'scroll-reveal-enter');
    expect(target).toHaveAttribute('data-reveal-state', 'revealing');
    animationEnd(target, 'scroll-reveal-enter');
    expect(target).toHaveAttribute('data-reveal-state', 'revealed');
    act(() => {
      observer.enter(target);
    });
    expect(target).toHaveAttribute('data-reveal-state', 'revealed');
  });

  it('reveals keyboard-focused content immediately instead of fading an active control', () => {
    render(
      <Page>
        <section data-reveal data-testid="target">
          <a href="#next">Focus this link</a>
        </section>
      </Page>,
    );
    const target = screen.getByTestId('target');
    act(() => {
      screen.getByRole('link').focus();
    });
    expect(target).toHaveAttribute('data-reveal-state', 'revealed');
    act(() => {
      ObservedIntersections.instances[0].enter(target);
    });
    expect(target).toHaveAttribute('data-reveal-state', 'revealed');
  });

  it('keeps all content visible without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(
      <Page>
        <section data-reveal data-testid="target">
          Fallback content
        </section>
      </Page>,
    );
    expect(screen.getByTestId('target')).toBeVisible();
    expect(screen.getByTestId('target')).toHaveAttribute(
      'data-reveal-state',
      'revealed',
    );
  });

  it('skips animation and observers for an initial reduced-motion preference', () => {
    motionPreference(true);
    render(
      <Page>
        <section data-reveal data-testid="target">
          Reduced motion content
        </section>
      </Page>,
    );
    expect(ObservedIntersections.instances).toHaveLength(0);
    expect(screen.getByTestId('target')).toHaveAttribute(
      'data-reveal-state',
      'revealed',
    );
    expect(screen.getByTestId('target')).toBeVisible();
  });

  it('finishes pending animations on a runtime preference change and reveals only new nodes after re-enabling motion', async () => {
    const preference = motionPreference();
    const view = render(
      <Page>
        <section data-reveal data-testid="old">
          Original
        </section>
      </Page>,
    );
    const old = screen.getByTestId('old');
    act(() => {
      ObservedIntersections.instances[0].enter(old);
    });
    preference.change(true);
    expect(old).toHaveAttribute('data-reveal-state', 'revealed');
    expect(ObservedIntersections.instances[0].disconnect).toHaveBeenCalled();
    preference.change(false);
    view.rerender(
      <Page>
        <section data-reveal data-testid="old">
          Original
        </section>
        <section data-reveal data-testid="new">
          New
        </section>
      </Page>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('new')).toHaveAttribute(
        'data-reveal-state',
        'observed',
      ),
    );
    expect(old).toHaveAttribute('data-reveal-state', 'revealed');
  });

  it('registers asynchronously inserted targets once and cleans removed targets', async () => {
    const view = render(
      <Page>
        <section key="first" data-reveal data-testid="first">
          First
        </section>
      </Page>,
    );
    const observer = ObservedIntersections.instances[0];
    const first = screen.getByTestId('first');
    view.rerender(
      <Page>
        <section key="first" data-reveal data-testid="first">
          First
        </section>
        <section key="second" data-reveal data-testid="second">
          Second
        </section>
      </Page>,
    );
    await waitFor(() =>
      expect(observer.observe).toHaveBeenCalledWith(
        screen.getByTestId('second'),
      ),
    );
    expect(ObservedIntersections.instances).toHaveLength(1);
    expect(
      observer.observe.mock.calls.filter(([element]) => element === first),
    ).toHaveLength(1);
    view.rerender(
      <Page>
        <section key="second" data-reveal data-testid="second">
          Second
        </section>
      </Page>,
    );
    await waitFor(() =>
      expect(first).toHaveAttribute('data-reveal-state', 'revealed'),
    );
    expect(observer.unobserve).toHaveBeenCalledWith(first);
  });

  it('does not animate forms, input ancestors or nested targets', () => {
    render(
      <Page>
        <section data-reveal data-testid="outer">
          <article data-reveal data-testid="nested">
            Nested
          </article>
        </section>
        <form data-reveal data-testid="form">
          <input aria-label="Form input" />
        </form>
        <section data-reveal data-testid="input-parent">
          <textarea aria-label="Reading notes" />
        </section>
      </Page>,
    );
    const observer = ObservedIntersections.instances[0];
    expect(observer.observe).toHaveBeenCalledExactlyOnceWith(
      screen.getByTestId('outer'),
    );
    for (const id of ['nested', 'form', 'input-parent'])
      expect(screen.getByTestId(id)).toHaveAttribute(
        'data-reveal-state',
        'revealed',
      );
  });

  it('cleans observers, listeners and animation timers without leaving hidden content', () => {
    vi.useFakeTimers();
    const preference = motionPreference();
    const view = render(
      <Page>
        <section data-reveal data-testid="target">
          Content
        </section>
      </Page>,
    );
    const target = screen.getByTestId('target');
    const root = target.closest('main')!;
    const remove = vi.spyOn(root, 'removeEventListener');
    const observer = ObservedIntersections.instances[0];
    act(() => {
      observer.enter(target);
    });
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(preference.media.removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
    expect(remove).toHaveBeenCalledWith('focusin', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('animationend', expect.any(Function));
    expect(target).toHaveAttribute('data-reveal-state', 'revealed');
    act(() => {
      observer.enter(target);
    });
    expect(target).toHaveAttribute('data-reveal-state', 'revealed');
  });

  it('finishes the previous route before observing new DOM targets on a page-key change', () => {
    const view = render(
      <Page pageKey="a">
        <section data-reveal data-testid="old">
          Old
        </section>
      </Page>,
    );
    const old = screen.getByTestId('old');
    const oldObserver = ObservedIntersections.instances[0];
    act(() => {
      oldObserver.enter(old);
    });
    view.rerender(
      <Page pageKey="b">
        <section data-reveal data-testid="old">
          Old
        </section>
        <section data-reveal data-testid="new">
          New
        </section>
      </Page>,
    );
    expect(old).toHaveAttribute('data-reveal-state', 'revealed');
    expect(oldObserver.disconnect).toHaveBeenCalled();
    expect(screen.getByTestId('new')).toHaveAttribute(
      'data-reveal-state',
      'observed',
    );
    expect(ObservedIntersections.instances).toHaveLength(2);
    act(() => {
      oldObserver.enter(old);
    });
    expect(old).toHaveAttribute('data-reveal-state', 'revealed');
  });
});

import { useEffect, useRef } from 'react';

const targetSelector = '[data-reveal]';
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const themeMotionEvent = 'eduflow:theme-transition-start';

/** Content stays visible until an intersection starts its one-time entrance. */
export function useScrollReveal(pageKey: string) {
  const container = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = container.current;
    if (!root) return;

    const media = window.matchMedia?.(reducedMotionQuery);
    const targets = new Set<HTMLElement>();
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    let observer: IntersectionObserver | undefined;
    let disposed = false;

    const finish = (element: HTMLElement) => {
      observer?.unobserve(element);
      const timer = timers.get(element);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(element);
      element.dataset.revealState = 'revealed';
    };

    const getObserver = () => {
      if (!observer && typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          (entries) => {
            if (disposed) return;
            for (const entry of entries) {
              const element = entry.target as HTMLElement;
              if (
                !entry.isIntersecting ||
                element.dataset.revealState !== 'observed'
              )
                continue;
              if (
                media?.matches ||
                document.documentElement.hasAttribute(
                  'data-theme-transition',
                ) ||
                element.contains(document.activeElement)
              ) {
                finish(element);
                continue;
              }
              observer?.unobserve(element);
              element.dataset.revealState = 'revealing';
              // Animation events are not guaranteed in background tabs or tests.
              const delay = Number.parseInt(
                element.style.getPropertyValue('--reveal-delay'),
                10,
              );
              timers.set(
                element,
                setTimeout(() => finish(element), delay + 700),
              );
            }
          },
          { threshold: 0.12 },
        );
      }
      return observer;
    };

    const register = (element: HTMLElement) => {
      if (targets.has(element)) return;
      targets.add(element);
      const rawIndex = Number(element.dataset.revealIndex ?? 0);
      const index = Number.isFinite(rawIndex)
        ? Math.max(0, Math.floor(rawIndex))
        : 0;
      element.style.setProperty(
        '--reveal-delay',
        `${Math.min(index * 80, 400)}ms`,
      );

      const parentTarget = element.parentElement?.closest(targetSelector);
      if (
        element.dataset.revealState === 'revealed' ||
        (parentTarget && root.contains(parentTarget)) ||
        element.closest('form') ||
        element.querySelector(
          'input, textarea, select, [contenteditable="true"]',
        ) ||
        element.contains(document.activeElement) ||
        media?.matches
      ) {
        finish(element);
        return;
      }
      const intersection = getObserver();
      if (!intersection) {
        finish(element);
        return;
      }
      element.dataset.revealState = 'observed';
      intersection.observe(element);
    };

    const discover = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches(targetSelector)) register(node);
      node.querySelectorAll<HTMLElement>(targetSelector).forEach(register);
    };

    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      let element = event.target.closest<HTMLElement>(targetSelector);
      while (element && root.contains(element)) {
        finish(element);
        element =
          element.parentElement?.closest<HTMLElement>(targetSelector) ?? null;
      }
    };
    const onAnimationEnd = (event: AnimationEvent) => {
      if (
        event.animationName === 'scroll-reveal-enter' &&
        event.target instanceof HTMLElement
      )
        finish(event.target);
    };
    const onMotionChange = () => {
      if (!media?.matches) return;
      observer?.disconnect();
      targets.forEach(finish);
    };
    const onThemeMotion = () => {
      targets.forEach((element) => {
        if (element.dataset.revealState === 'revealing') finish(element);
      });
    };

    discover(root);
    const mutations =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver((records) => {
            for (const record of records) record.addedNodes.forEach(discover);
            for (const element of targets) {
              if (!root.contains(element)) {
                finish(element);
                targets.delete(element);
              }
            }
          });
    mutations?.observe(root, { childList: true, subtree: true });
    root.addEventListener('focusin', onFocus);
    root.addEventListener('animationend', onAnimationEnd);
    document.addEventListener(themeMotionEvent, onThemeMotion);
    if (media?.addEventListener)
      media.addEventListener('change', onMotionChange);
    else media?.addListener?.(onMotionChange);

    return () => {
      disposed = true;
      mutations?.disconnect();
      observer?.disconnect();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      // Strict Mode replays effects: unseen targets must remain observable.
      targets.forEach((element) => {
        if (element.dataset.revealState === 'revealing')
          element.dataset.revealState = 'revealed';
      });
      targets.clear();
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('animationend', onAnimationEnd);
      document.removeEventListener(themeMotionEvent, onThemeMotion);
      if (media?.removeEventListener)
        media.removeEventListener('change', onMotionChange);
      else media?.removeListener?.(onMotionChange);
    };
  }, [pageKey]);

  return container;
}

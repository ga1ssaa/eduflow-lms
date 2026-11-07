import { useEffect, useState, type RefObject } from 'react';

const sectionKeys = ['how-it-works', 'for-instructors', 'about'] as const;
type SectionKey = 'home' | 'courses' | (typeof sectionKeys)[number];

/** Read stationary document sections; never move the page or update history. */
export function useScrollSpy(
  pathname: string,
  capsule: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const fallback =
    pathname === '/' ? 'home' : pathname === '/courses' ? 'courses' : null;
  const [active, setActive] = useState<{
    pathname: string;
    key: SectionKey;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !fallback) return;
    const main = document.querySelector('main');
    if (!main) return;
    const sections = sectionKeys.flatMap((key) => {
      const element = main.querySelector<HTMLElement>(`section#${key}`);
      return element ? [{ key, element }] : [];
    });
    let frame: number | undefined;
    let disposed = false;
    const update = () => {
      frame = undefined;
      if (disposed) return;
      // Match anchor landing offsets and measure only the capsule, not an open
      // mobile menu. Hero carrier transforms are deliberately never inspected.
      const line = Math.max(
        capsule.current?.getBoundingClientRect().bottom ?? 0,
        ...sections.map(
          ({ element }) =>
            Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0,
        ),
      );
      const measured = sections.map(({ key, element }) => ({
        key,
        rect: element.getBoundingClientRect(),
      }));
      let key: SectionKey = fallback;
      for (const section of measured) {
        if (section.rect.height > 0 && section.rect.top <= line + 1)
          key = section.key;
      }
      // A short final section may never reach the activation line above the
      // footer. It still becomes current when the user reaches the page end.
      const about = measured.find((section) => section.key === 'about');
      const height = document.documentElement.scrollHeight;
      if (
        height > window.innerHeight &&
        window.scrollY + window.innerHeight >= height - 1 &&
        about &&
        about.rect.height > 0 &&
        about.rect.top < window.innerHeight &&
        about.rect.bottom > 0
      )
        key = 'about';
      setActive((previous) =>
        previous?.pathname === pathname && previous.key === key
          ? previous
          : { pathname, key },
      );
    };
    const schedule = () => {
      if (disposed || frame !== undefined) return;
      if (typeof window.requestAnimationFrame === 'function')
        frame = window.requestAnimationFrame(update);
      else update();
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(schedule);
    observer?.observe(main);
    if (capsule.current) observer?.observe(capsule.current);
    sections.forEach(({ element }) => observer?.observe(element));
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    main.addEventListener('animationend', schedule);
    schedule();
    return () => {
      disposed = true;
      if (frame !== undefined) window.cancelAnimationFrame?.(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      main.removeEventListener('animationend', schedule);
    };
  }, [pathname, fallback, capsule, enabled]);

  return enabled && fallback
    ? active?.pathname === pathname
      ? active.key
      : fallback
    : null;
}

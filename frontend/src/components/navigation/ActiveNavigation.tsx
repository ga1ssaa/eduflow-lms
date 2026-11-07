import { useLayoutEffect, useRef, type ComponentProps } from 'react';

/** Decoration only: selection and navigation remain owned by Navbar. */
export function ActiveNavigation({
  children,
  ...props
}: ComponentProps<'nav'>) {
  const container = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const nav = container.current!;
    const highlight = indicator.current!;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const active = nav.querySelector<HTMLAnchorElement>('a.active');
      const bounds = nav.getBoundingClientRect();
      const target = active?.getBoundingClientRect();
      if (!target?.width || !target.height || !bounds.width) {
        delete nav.dataset.indicatorReady;
        return;
      }
      // Use the scrollable padding box, including mobile menu scroll offsets.
      highlight.style.transform = `translate3d(${target.left - bounds.left + nav.scrollLeft - nav.clientLeft}px, ${target.top - bounds.top + nav.scrollTop - nav.clientTop}px, 0)`;
      highlight.style.width = `${target.width}px`;
      highlight.style.height = `${target.height}px`;
      nav.dataset.indicatorReady = 'true';
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    observer?.observe(nav);
    nav.querySelectorAll('a').forEach((link) => observer?.observe(link));
    window.addEventListener('resize', measure);
    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  return (
    <nav {...props} ref={container}>
      <span
        ref={indicator}
        className="nav-active-indicator"
        aria-hidden="true"
      />
      {children}
    </nav>
  );
}

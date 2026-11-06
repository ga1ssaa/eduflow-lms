import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  getThemeSnapshot,
  registerThemeHero,
  subscribeTheme,
  THEME_TRANSITION_DURATION,
  type ThemeScene,
} from './theme-transition-controller';
import { createThemeSceneAtmosphere } from './theme-scene-atmosphere';
import './theme-transition.css';

type Point = { x: number; y: number };
type Curve = [Point, Point, Point, Point];
function bezier(
  from: Point,
  first: Point,
  second: Point,
  to: Point,
  t: number,
): Point {
  const remaining = 1 - t;
  return {
    x:
      remaining ** 3 * from.x +
      3 * remaining ** 2 * t * first.x +
      3 * remaining * t ** 2 * second.x +
      t ** 3 * to.x,
    y:
      remaining ** 3 * from.y +
      3 * remaining ** 2 * t * first.y +
      3 * remaining * t ** 2 * second.y +
      t ** 3 * to.y,
  };
}
function smooth(progress: number) {
  const bounded = Math.max(0, Math.min(1, progress));
  return (1 - Math.cos(Math.PI * bounded)) / 2;
}
function curveLength(curve: Curve) {
  let length = 0;
  let previous = curve[0];
  for (let index = 1; index <= 64; index++) {
    const point = bezier(...curve, index / 64);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}
function place(element: HTMLElement, point: Point, opacity: number) {
  element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
  element.style.opacity = String(opacity);
}
function restoreStyle(element: HTMLElement, previous: string | null) {
  if (previous === null) element.removeAttribute('style');
  else element.setAttribute('style', previous);
}

/** The actual, upright Hero travels at full size; no app snapshot or decorative substitute. */
export function ThemeTransition({
  children,
  className = '',
  name,
}: {
  children: ReactNode;
  className?: string;
  name: 'home' | 'catalog';
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const carrier = useRef<HTMLDivElement>(null);
  const { scene } = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeSnapshot,
  );
  useLayoutEffect(() => {
    if (!wrapper.current) return;
    return registerThemeHero({
      element: wrapper.current,
      start: (next: ThemeScene) => {
        const placeholder = wrapper.current;
        const content = carrier.current;
        if (!placeholder || !content)
          throw new Error('Hero composition is unavailable');
        const rest = content.getBoundingClientRect();
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        const gap = 32;
        const exit = {
          x: viewport.width + gap - rest.left,
          y: viewport.height + gap - rest.top,
        };
        const sunriseStart = {
          x: -gap - rest.right,
          y: viewport.height + gap - rest.top,
        };
        const previousWrapperStyle = placeholder.getAttribute('style');
        const previousCarrierStyle = content.getAttribute('style');
        const previousPhase = placeholder.getAttribute('data-hero-phase');
        // Preserve the approved incoming path and easing with 8% faster shared pacing.
        const incomingCurve: Curve = [
          sunriseStart,
          { x: sunriseStart.x * 0.92, y: sunriseStart.y * 0.52 },
          { x: sunriseStart.x * 0.38, y: sunriseStart.y * 0.02 },
          { x: 0, y: 0 },
        ];
        const incomingDuration =
          (THEME_TRANSITION_DURATION * (1 - 0.18)) / 1.08;
        // Reflect the entry's displacement into a setting arc, retaining its
        // gentle start and speed profile rather than accelerating a short exit.
        const outgoingCurve = incomingCurve.map((point) => ({
          x: ((point.x - sunriseStart.x) / -sunriseStart.x) * exit.x,
          y: ((sunriseStart.y - point.y) / sunriseStart.y) * exit.y,
        })) as Curve;
        // Reverse the reflected geometry so the exit sweeps right before
        // descending, while retaining the existing arc-length timing below.
        const descendingCurve = [...outgoingCurve].reverse().map((point) => ({
          x: exit.x - point.x,
          y: exit.y - point.y,
        })) as Curve;
        const outgoingDuration =
          incomingDuration *
          (curveLength(outgoingCurve) / curveLength(incomingCurve));
        const duration = outgoingDuration + incomingDuration;
        const handoffAt = outgoingDuration / duration;
        let atmosphere:
          ReturnType<typeof createThemeSceneAtmosphere> | undefined;
        let handedOff = false;
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return;
          cleaned = true;
          try {
            atmosphere?.cleanup();
          } finally {
            restoreStyle(placeholder, previousWrapperStyle);
            restoreStyle(content, previousCarrierStyle);
            if (previousPhase === null)
              placeholder.removeAttribute('data-hero-phase');
            else placeholder.setAttribute('data-hero-phase', previousPhase);
          }
        };
        try {
          atmosphere = createThemeSceneAtmosphere(next, placeholder, handoffAt);
          // Keep the normal-flow footprint while the same DOM travels in viewport space.
          placeholder.style.height = `${rest.height}px`;
          Object.assign(content.style, {
            position: 'fixed',
            left: `${rest.left}px`,
            top: `${rest.top}px`,
            width: `${rest.width}px`,
            height: `${rest.height}px`,
            zIndex: '5',
          });
          placeholder.dataset.heroPhase = 'outgoing';
          place(content, { x: 0, y: 0 }, 1);
          return {
            duration,
            handoffAt,
            prepareHandoff: () => {
              place(content, exit, 0);
              const bounds = content.getBoundingClientRect();
              handedOff =
                bounds.left > window.innerWidth + 24 &&
                bounds.top > window.innerHeight + 24;
              return handedOff;
            },
            render: (progress: number) => {
              atmosphere?.render(progress);
              placeholder.style.setProperty(
                '--hero-scene-progress',
                String(progress),
              );
              if (!handedOff) {
                placeholder.dataset.heroPhase = 'outgoing';
                const t = smooth(progress / handoffAt);
                place(content, bezier(...descendingCurve, t), 1);
              } else {
                placeholder.dataset.heroPhase = 'incoming';
                const t = smooth((progress - handoffAt) / (1 - handoffAt));
                place(
                  content,
                  bezier(...incomingCurve, t),
                  Math.min(1, t / 0.12),
                );
              }
            },
            cleanup,
          };
        } catch (error) {
          cleanup();
          throw error;
        }
      },
    });
  }, []);
  return (
    <div
      ref={wrapper}
      className="theme-hero-orbit"
      data-theme-hero={name}
      data-hero-orbit={scene?.direction}
      data-hero-scene-id={scene?.id}
    >
      <div ref={carrier} className="theme-hero-carrier" data-hero-carrier>
        <div className={`theme-hero-face ${className}`.trim()} data-hero-face>
          {children}
        </div>
      </div>
    </div>
  );
}

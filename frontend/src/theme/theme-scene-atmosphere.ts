import type { EffectiveTheme, ThemeScene } from './theme-transition-controller';

function restoreStyle(element: HTMLElement, previous: string | null) {
  if (previous === null) element.removeAttribute('style');
  else element.setAttribute('style', previous);
}

/** Read the existing catalog ray mask without changing the document's theme. */
function catalogRayMask(section: HTMLElement) {
  const probe = document.createElement('div');
  probe.dataset.theme = 'dark';
  probe.dataset.sceneTheme = 'dark';
  Object.assign(probe.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  const shell = document.createElement('div');
  shell.className = 'catalog-shell';
  const hero = document.createElement('section');
  hero.className = 'catalog-hero';
  shell.append(hero);
  probe.append(shell);
  section.append(probe);
  try {
    return window.getComputedStyle(hero, '::after').maskImage;
  } finally {
    probe.remove();
  }
}

/** Only gradient recipes and static decorative pixels/rays are replicated. */
export function createThemeSceneAtmosphere(
  scene: ThemeScene,
  hero: HTMLElement,
  handoffAt: number,
) {
  const section = hero.closest<HTMLElement>('.landing-hero, .catalog-hero');
  const app = document.getElementById('root');
  const shell = hero.closest<HTMLElement>('.catalog-shell, .product-shell');
  if (!section || !app || !shell)
    throw new Error(
      'The theme scene requires an existing Hero and application root',
    );
  const catalog = section.classList.contains('catalog-hero');
  const bounds = section.getBoundingClientRect();
  const pageBounds = shell.getBoundingClientRect();
  const initialScrollY = window.scrollY;
  const documentBackgrounds: { element: HTMLElement; top: number }[] = [];
  const staticDecor = section.querySelector<HTMLElement>(
    catalog ? '.catalog-hero-pixels' : '.atmosphere-decoration',
  );
  const rayMask = catalog ? catalogRayMask(section) : '';
  const originals = [
    app,
    shell,
    section,
    ...(staticDecor ? [staticDecor] : []),
  ];
  const styles = originals.map(
    (element) => [element, element.getAttribute('style')] as const,
  );
  const wasMuted = section.classList.contains('theme-scene-background-muted');
  const canvas = document.createElement('div');
  canvas.dataset.themeSceneAtmosphere = String(scene.id);
  canvas.dataset.sceneDirection = scene.direction;
  canvas.dataset.sceneHandoff = String(handoffAt);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.inert = true;
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    userSelect: 'none',
    contain: 'strict',
  });
  const sourceTheme: EffectiveTheme =
    scene.destination === 'light' ? 'dark' : 'light';
  const makeLayer = (theme: EffectiveTheme, role: 'source' | 'destination') => {
    const layer = document.createElement('div');
    layer.className = `theme-scene-atmosphere${catalog ? ' catalog-shell' : ''}`;
    layer.dataset.sceneTheme = theme;
    layer.dataset.themeSceneLayer = role;
    layer.style.setProperty(
      '--atmosphere-floor',
      catalog && theme === 'light' ? 'var(--surface)' : 'var(--bg)',
    );
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      background: 'var(--atmosphere-floor)',
    });
    // Keep the full page's lighting in document space, independently of the
    // travelling Hero. Its colors use the existing source/destination reveal.
    const pageBackground = document.createElement('div');
    pageBackground.dataset.themeScenePage = '';
    Object.assign(pageBackground.style, {
      position: 'absolute',
      left: `${pageBounds.left}px`,
      top: `${pageBounds.top}px`,
      width: `${pageBounds.width}px`,
      height: `${pageBounds.height}px`,
      background: 'var(--atmosphere-page)',
    });
    const continuation = document.createElement('div');
    continuation.dataset.themeSceneContinuation = '';
    Object.assign(continuation.style, {
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      zIndex: '0',
    });
    documentBackgrounds.push(
      { element: pageBackground, top: pageBounds.top },
      { element: continuation, top: bounds.top },
    );
    const gradient = document.createElement('div');
    gradient.dataset.themeSceneGradient = '';
    Object.assign(gradient.style, {
      position: 'absolute',
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      overflow: 'hidden',
      backgroundImage: 'var(--atmosphere-discovery)',
    });
    documentBackgrounds.push({ element: gradient, top: bounds.top });
    if (staticDecor) {
      const decor = staticDecor.cloneNode(true) as HTMLElement;
      decor.removeAttribute('id');
      decor
        .querySelectorAll('[id]')
        .forEach((node) => node.removeAttribute('id'));
      Object.assign(decor.style, {
        position: 'absolute',
        inset: '0',
        zIndex: '0',
        visibility: 'visible',
        pointerEvents: 'none',
      });
      gradient.append(decor);
    }
    if (catalog && theme === 'dark') {
      const rays = document.createElement('span');
      rays.dataset.themeSceneRays = '';
      Object.assign(rays.style, {
        position: 'absolute',
        inset: '14% 0 0',
        pointerEvents: 'none',
        backgroundImage: 'var(--atmosphere-rays)',
        maskImage: rayMask,
      });
      gradient.append(rays);
    }
    layer.append(pageBackground, continuation, gradient);
    canvas.append(layer);
    return layer;
  };
  const source = makeLayer(sourceTheme, 'source');
  const destination = makeLayer(scene.destination, 'destination');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    canvas.remove();
    styles.forEach(([element, previous]) => restoreStyle(element, previous));
    if (!wasMuted) section.classList.remove('theme-scene-background-muted');
  };
  const render = (value: number) => {
    if (cleaned) return;
    const progress = Math.max(0, Math.min(1, value));
    const reveal = progress * progress * (3 - 2 * progress);
    const angle = scene.direction === 'sunrise' ? 45 : 135;
    const edge = -10 + reveal * 120;
    const scrollOffset = initialScrollY - window.scrollY;
    for (const { element, top } of documentBackgrounds) {
      element.style.top = `${top + scrollOffset}px`;
    }
    for (const element of [canvas, source, destination]) {
      element.style.setProperty('--theme-scene-progress', String(progress));
      element.style.setProperty('--theme-scene-mask-progress', String(reveal));
      element.dataset.sceneProgress = String(progress);
    }
    destination.style.maskImage =
      progress === 0
        ? 'linear-gradient(transparent, transparent)'
        : progress === 1
          ? 'linear-gradient(#000, #000)'
          : `linear-gradient(${angle}deg, #000 ${edge - 10}%, transparent ${edge + 10}%)`;
  };
  try {
    // Keep all real foreground above these background-only states.
    Object.assign(app.style, { position: 'relative', zIndex: '1' });
    shell.style.background = 'transparent';
    section.style.background = 'transparent';
    section.classList.add('theme-scene-background-muted');
    if (staticDecor) staticDecor.style.visibility = 'hidden';
    render(0);
    document.body.prepend(canvas);
  } catch (error) {
    cleanup();
    throw error;
  }
  return { render, cleanup };
}

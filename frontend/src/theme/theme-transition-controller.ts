export type ThemePreference = 'light' | 'dark' | 'system';
export type EffectiveTheme = 'light' | 'dark';
export interface ThemeScene {
  id: number;
  destination: EffectiveTheme;
  direction: 'sunrise' | 'sunset';
}
export interface ThemeSnapshot {
  preference: ThemePreference;
  /** Latest requested destination, including an in-progress orbit. */
  effective: EffectiveTheme;
  /** Theme currently applied to the document. */
  applied: EffectiveTheme;
  scene: ThemeScene | null;
}
export interface ThemeHeroRegistration {
  element: HTMLElement;
  start: (scene: ThemeScene) => ThemeHeroTransition;
}
export interface ThemeHeroTransition {
  render: (progress: number) => void;
  duration?: number;
  handoffAt: number;
  prepareHandoff: () => boolean;
  cleanup: () => void;
}

export const THEME_TRANSITION_DURATION = 1600;
export const THEME_TRANSITION_START = 'eduflow:theme-transition-start';
const storageKey = 'eduflow-theme';
const listeners = new Set<() => void>();
let snapshot: ThemeSnapshot = {
  preference: 'system',
  effective: 'light',
  applied: 'light',
  scene: null,
};
let initialized = false;
let listening = false;
let darkMedia: MediaQueryList | undefined;
let motionMedia: MediaQueryList | undefined;
let generation = 0;
let deadline: ReturnType<typeof setTimeout> | undefined;
let frame: number | undefined;
let transition: ThemeHeroTransition | undefined;
let handedOff = false;
let sceneProgress = 0;
let hero: (ThemeHeroRegistration & { token: symbol }) | undefined;
let runningHero: symbol | undefined;
let sceneScrollOrigin: { x: number; y: number } | undefined;
let sceneViewportSize: { width: number; height: number } | undefined;

function normalizePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
function media(query: string) {
  try {
    return window.matchMedia?.(query);
  } catch {
    return undefined;
  }
}
function readPreference(): ThemePreference {
  try {
    return normalizePreference(localStorage.getItem(storageKey));
  } catch {
    return 'system';
  }
}
function resolveTheme(preference: ThemePreference): EffectiveTheme {
  return preference === 'system'
    ? darkMedia?.matches
      ? 'dark'
      : 'light'
    : preference;
}
function applyTheme(theme: EffectiveTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
function publish(next: ThemeSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
function clearMotion() {
  generation++;
  window.removeEventListener('scroll', onSceneScroll);
  sceneScrollOrigin = undefined;
  sceneViewportSize = undefined;
  clearTimeout(deadline);
  deadline = undefined;
  if (frame !== undefined) window.cancelAnimationFrame(frame);
  frame = undefined;
  const previousTransition = transition;
  transition = undefined;
  handedOff = false;
  sceneProgress = 0;
  runningHero = undefined;
  delete document.documentElement.dataset.themeTransition;
  try {
    previousTransition?.cleanup?.();
  } catch {
    // Restoring one visual driver must not prevent the latest theme settling.
  }
}
function settleLatest() {
  clearMotion();
  applyTheme(snapshot.effective);
  publish({ ...snapshot, applied: snapshot.effective, scene: null });
}
function cancelIfViewportChanged() {
  if (
    (sceneScrollOrigin &&
      (window.scrollX !== sceneScrollOrigin.x ||
        window.scrollY !== sceneScrollOrigin.y)) ||
    (sceneViewportSize &&
      (window.innerWidth !== sceneViewportSize.width ||
        window.innerHeight !== sceneViewportSize.height))
  ) {
    settleLatest();
    return true;
  }
  return false;
}
function onSceneScroll() {
  cancelIfViewportChanged();
}
export function commitThemeHandoff(id: number) {
  if (snapshot.scene?.id !== id || generation !== id || handedOff) return;
  const plan = transition;
  if (!plan || sceneProgress < plan.handoffAt) return;
  try {
    if (!plan.prepareHandoff()) {
      settleLatest();
      return;
    }
  } catch {
    settleLatest();
    return;
  }
  if (generation !== id) return;
  handedOff = true;
  const destination = snapshot.scene.destination;
  applyTheme(destination);
  publish({ ...snapshot, applied: destination });
}
export function completeThemeTransition(id: number) {
  if (snapshot.scene?.id !== id || generation !== id) return;
  settleLatest();
}
function visibleHero(registration: ThemeHeroRegistration) {
  const { element } = registration;
  if (!element.isConnected) return false;
  try {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse'
    );
  } catch {
    return false;
  }
}
function beginMotion(destination: EffectiveTheme) {
  const registration = hero;
  if (
    motionMedia?.matches ||
    !registration ||
    !visibleHero(registration) ||
    typeof window.requestAnimationFrame !== 'function' ||
    typeof window.cancelAnimationFrame !== 'function'
  ) {
    settleLatest();
    return;
  }
  const id = ++generation;
  const scene: ThemeScene = {
    id,
    destination,
    direction: destination === 'light' ? 'sunrise' : 'sunset',
  };
  runningHero = registration.token;
  sceneScrollOrigin = { x: window.scrollX, y: window.scrollY };
  sceneViewportSize = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  window.addEventListener('scroll', onSceneScroll, { passive: true });
  document.documentElement.dataset.themeTransition = scene.direction;
  publish({ ...snapshot, scene });
  document.dispatchEvent(
    new CustomEvent(THEME_TRANSITION_START, { detail: scene }),
  );
  if (generation !== id) return;
  try {
    const plan = registration.start(scene);
    if (generation !== id) {
      plan.cleanup();
      return;
    }
    transition = plan;
    const duration = plan.duration ?? THEME_TRANSITION_DURATION;
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(plan.handoffAt) ||
      plan.handoffAt <= 0 ||
      plan.handoffAt >= 1
    ) {
      settleLatest();
      return;
    }
    if (cancelIfViewportChanged()) return;
    plan.render(0);
    if (generation !== id) return;
    const startedAt = performance.now();
    const renderFrame = (timestamp: number) => {
      if (generation !== id) return;
      frame = undefined;
      if (cancelIfViewportChanged()) return;
      const progress = Math.max(
        0,
        Math.min(1, (timestamp - startedAt) / duration),
      );
      sceneProgress = progress;
      try {
        if (progress >= plan.handoffAt && !handedOff) commitThemeHandoff(id);
        if (generation !== id) return;
        plan.render(progress);
      } catch {
        if (generation === id) settleLatest();
        return;
      }
      if (generation !== id) return;
      if (progress === 1) completeThemeTransition(id);
      else frame = window.requestAnimationFrame(renderFrame);
    };
    frame = window.requestAnimationFrame(renderFrame);
    // Failure recovery only; every visual element follows the same RAF progress.
    deadline = setTimeout(() => completeThemeTransition(id), duration * 2);
  } catch {
    if (generation === id) settleLatest();
  }
}
function changePreference(preference: ThemePreference, persist: boolean) {
  initializeThemeTransition();
  if (persist) {
    try {
      localStorage.setItem(storageKey, preference);
    } catch {
      // In-memory selection remains usable when browser storage is blocked.
    }
  }
  const effective = resolveTheme(preference);
  if (effective === snapshot.effective) {
    publish({ ...snapshot, preference });
    return;
  }
  // Cancel the old orbit without committing a superseded destination.
  clearMotion();
  const requestGeneration = generation;
  publish({ ...snapshot, preference, effective, scene: null });
  if (generation !== requestGeneration || snapshot.effective !== effective)
    return;
  if (effective === snapshot.applied) {
    applyTheme(effective);
    return;
  }
  beginMotion(effective);
}
const onSystemChange = () => {
  if (snapshot.preference === 'system') changePreference('system', false);
};
const onMotionChange = () => {
  if (motionMedia?.matches && snapshot.scene) settleLatest();
};
const onViewportChange = () => {
  cancelIfViewportChanged();
};
const onStorage = (event: StorageEvent) => {
  if (event.key === storageKey || event.key === null)
    changePreference(normalizePreference(event.newValue), false);
};
function addMediaListener(
  query: MediaQueryList | undefined,
  callback: () => void,
) {
  if (query?.addEventListener) query.addEventListener('change', callback);
  else query?.addListener?.(callback);
}
function removeMediaListener(
  query: MediaQueryList | undefined,
  callback: () => void,
) {
  if (query?.removeEventListener) query.removeEventListener('change', callback);
  else query?.removeListener?.(callback);
}
function attachListeners() {
  if (listening) return;
  listening = true;
  addMediaListener(motionMedia, onMotionChange);
  addMediaListener(darkMedia, onSystemChange);
  window.addEventListener('storage', onStorage);
  window.addEventListener('resize', onViewportChange);
}
function detachListeners() {
  if (!listening) return;
  listening = false;
  removeMediaListener(motionMedia, onMotionChange);
  removeMediaListener(darkMedia, onSystemChange);
  window.removeEventListener('storage', onStorage);
  window.removeEventListener('resize', onViewportChange);
}

/** Correct initial palette, without startup animation or asynchronous app gating. */
export function initializeThemeTransition() {
  if (initialized) return;
  initialized = true;
  darkMedia = media('(prefers-color-scheme: dark)');
  motionMedia = media('(prefers-reduced-motion: reduce)');
  const preference = readPreference();
  const effective = resolveTheme(preference);
  snapshot = { preference, effective, applied: effective, scene: null };
  applyTheme(effective);
}
export function getThemeSnapshot() {
  initializeThemeTransition();
  return snapshot;
}
export function subscribeTheme(listener: () => void) {
  initializeThemeTransition();
  listeners.add(listener);
  attachListeners();
  if (
    snapshot.preference === 'system' &&
    resolveTheme('system') !== snapshot.effective
  )
    changePreference('system', false);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && !hero) detachListeners();
  };
}
export function setThemePreference(preference: ThemePreference) {
  changePreference(normalizePreference(preference), true);
}
/** Registers the existing hero group; registration never initiates motion. */
export function registerThemeHero(registration: ThemeHeroRegistration) {
  initializeThemeTransition();
  if (snapshot.scene) settleLatest();
  const token = Symbol('theme-hero');
  hero = { ...registration, token };
  attachListeners();
  return () => {
    if (hero?.token !== token) return;
    if (runningHero === token) settleLatest();
    hero = undefined;
    if (listeners.size === 0) detachListeners();
  };
}
/** Document/HMR cleanup; route cleanup is scoped to its registration token. */
export function disposeThemeTransition() {
  settleLatest();
  detachListeners();
  listeners.clear();
  hero = undefined;
  initialized = false;
  darkMedia = undefined;
  motionMedia = undefined;
}
if (import.meta.hot) import.meta.hot.dispose(disposeThemeTransition);

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// Vitest aliases window to its worker global. Node 24 also defines Web Storage,
// so explicitly use the real jsdom realm rather than Node's file-backed storage.
const browserWindow = (globalThis as unknown as { jsdom: { window: Window } })
  .jsdom.window;

beforeEach(() => {
  vi.stubGlobal('localStorage', browserWindow.localStorage);
  vi.stubGlobal('sessionStorage', browserWindow.sessionStorage);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  browserWindow.localStorage.clear();
  browserWindow.sessionStorage.clear();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

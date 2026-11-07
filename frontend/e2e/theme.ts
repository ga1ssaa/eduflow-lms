import type { Page } from '@playwright/test';

const controlledPages = new WeakSet<Page>();

/** Control test time, never production duration; browser input remains real. */
export async function installSceneClock(page: Page) {
  if (controlledPages.has(page)) await page.clock.resume();
  else {
    await page.clock.install();
    controlledPages.add(page);
  }
}
export async function pauseSceneClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 128));
}
export function hasSceneClock(page: Page) {
  return controlledPages.has(page);
}

/** Choose a real preference through the shared icon menu, without writing browser state. */
export async function chooseTheme(page: Page, theme: string) {
  const labels: Record<string, string> = {
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  };
  const label = labels[theme];
  if (!label) throw new Error(`Unsupported theme preference: ${theme}`);
  await page.getByRole('button', { name: 'Color theme', exact: true }).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

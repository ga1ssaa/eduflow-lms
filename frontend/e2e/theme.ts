import type { Page } from '@playwright/test';

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

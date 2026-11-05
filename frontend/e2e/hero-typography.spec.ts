import { expect, test, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chooseTheme } from './theme';

async function typography(heading: Locator) {
  return heading.evaluate(async (element) => {
    await document.fonts.ready;
    const rect = element.getBoundingClientRect();
    const round = (value: number) => Math.round(value * 100) / 100;
    const style = (target: Element) => {
      const computed = getComputedStyle(target);
      return {
        family: computed.fontFamily,
        weight: computed.fontWeight,
        style: computed.fontStyle,
        size: computed.fontSize,
        lineHeight: computed.lineHeight,
        spacing: computed.letterSpacing,
        align: computed.textAlign,
      };
    };
    // Character ranges catch wrapping changes that a heading's outer box misses.
    const lines: { text: string; x: number; y: number; right: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      for (let offset = 0; offset < (node.textContent?.length ?? 0); offset++) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const box = range.getBoundingClientRect();
        if (!box.height) continue;
        const y = round(box.top - rect.top);
        const previous = lines.at(-1);
        if (previous?.y === y) {
          previous.text += node.textContent![offset];
          previous.right = round(box.right - rect.left);
        } else {
          lines.push({
            text: node.textContent![offset],
            x: round(box.left - rect.left),
            y,
            right: round(box.right - rect.left),
          });
        }
      }
    }
    const emphasis = element.querySelector('span, em');
    return {
      heading: style(element),
      emphasis: emphasis ? style(emphasis) : null,
      width: round(rect.width),
      height: round(rect.height),
      lines,
      color: getComputedStyle(element).color,
      emphasisColor: emphasis ? getComputedStyle(emphasis).color : null,
    };
  });
}

for (const width of [320, 375, 768, 1440]) {
  test(`catalog serif headline matches across themes at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/courses');
    const heading = page.locator('#catalog-hero-title');
    await expect(heading).toHaveText('Build the skills.Shape what’s next.');
    const snapshots = [];
    for (const theme of ['light', 'dark']) {
      await chooseTheme(page, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      snapshots.push(await typography(heading));
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
    const [light, dark] = snapshots;
    expect({ ...light, color: null, emphasisColor: null }).toEqual({
      ...dark,
      color: null,
      emphasisColor: null,
    });
    expect(light.heading.family).toBe('Georgia, "Times New Roman", serif');
    expect(light.heading.weight).toBe('400');
    expect(light.heading.style).toBe('normal');
    expect(light.emphasis?.style).toBe('italic');
    expect(light.heading.align).toBe('center');
    const expectedSize =
      width <= 540
        ? Math.min(60, Math.max(44, width * 0.118))
        : Math.min(88, Math.max(60, width * 0.06));
    expect(parseFloat(light.heading.size)).toBeCloseTo(expectedSize, 2);
    expect(parseFloat(light.heading.lineHeight)).toBeCloseTo(
      expectedSize * (width <= 540 ? 1.08 : 1.07),
      2,
    );
    expect(parseFloat(light.heading.spacing)).toBe(width <= 540 ? -1.8 : -3);
    expect(light.lines.length).toBeGreaterThanOrEqual(2);
    // Geometry recorded from the approved dark hero before this change.
    const baseline = {
      320: { width: 272, height: 142.546875 },
      375: { width: 327, height: 143.34375 },
      768: { width: 704, height: 128.375 },
      1440: { width: 850, height: 184.90625 },
    }[width]!;
    expect(dark.width).toBeCloseTo(baseline.width, 1);
    expect(dark.height).toBeCloseTo(baseline.height, 1);
    await testInfo.attach(`catalog-typography-${width}`, {
      body: JSON.stringify({ light, dark }, null, 2),
      contentType: 'application/json',
    });
    const screenshotDirectory = join(
      process.cwd(),
      'test-results',
      'hero-typography',
    );
    await mkdir(screenshotDirectory, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await chooseTheme(page, theme);
      await page.screenshot({
        path: join(screenshotDirectory, `catalog-hero-${width}-${theme}.png`),
      });
    }

    // Home is a separate hero and must retain its existing typography.
    await page.goto('/');
    const home = page.locator('.landing-hero h1');
    await expect(home).toBeVisible();
    await chooseTheme(page, 'light');
    const homeLight = await typography(home);
    await chooseTheme(page, 'dark');
    const homeDark = await typography(home);
    expect({ ...homeLight, color: null, emphasisColor: null }).toEqual({
      ...homeDark,
      color: null,
      emphasisColor: null,
    });
  });
}

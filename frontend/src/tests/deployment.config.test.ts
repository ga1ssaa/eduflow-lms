import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('vercel.json.example', 'utf8'));

describe('Vercel deployment template', () => {
  it('proxies the unchanged API prefix before the SPA fallback', () => {
    expect(config.rewrites[0]).toEqual({
      source: '/api/v1/:path*',
      destination: 'https://replace-with-render-host.invalid/api/v1/:path*',
    });
    const fallback = new RegExp(`^${config.rewrites[1].source}$`);
    for (const path of ['/login', '/learning', '/courses/python']) {
      expect(fallback.test(path)).toBe(true);
    }
    for (const path of ['/api', '/api/v1/health', '/api/unknown']) {
      expect(fallback.test(path)).toBe(false);
    }
    expect(config.rewrites[1].destination).toBe('/index.html');
  });

  it('disables proxy caching, including authenticated responses', () => {
    expect(config.headers).toEqual([
      {
        source: '/api/v1/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'CDN-Cache-Control', value: 'no-store' },
          { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
          { key: 'x-vercel-enable-rewrite-caching', value: '0' },
        ],
      },
    ]);
  });
});
